/**
 * Schema Weaver Migration Engine - Migration Executor
 * https://schemaweaver.vivekmind.com/
 */
import { TransactionManager } from './transaction-manager.js';
import { LockManager } from './lock-manager.js';
import { LockConflictDetector } from './lock-conflict-detector.js';
import { ProgressTracker } from './progress-tracker.js';
import { DriftDetector } from './drift-detector.js';
import { CrashRecovery } from '../recovery/crash-recovery.js';
import { NonTransactionalQueue } from './non-transactional-queue.js';
import { RollbackGenerator } from '../storage/rollback-generator.js';
import { MigrationStateMachine } from '../state-machine/migration-state-machine.js';
import os from 'os';
import { splitSqlStatements, sanitizeSavepointName } from './sql-splitter.js';
import { isDDLTransactionalInPG } from '../ddl-generator/pg-version.js';
import {
  ExecutionError,
  PreCheckFailedError,
  MigrationConflictError,
  VersionIncompatibilityError,
  DriftDetectedError,
  LockAcquisitionError,
} from '../errors.js';
import {
  MIGRATION_STATUS,
  RISK_LEVELS,
  mapExecutorStatusToDb,
} from '../constants.js';

/**
 * Sanitize a string to remove potential credentials.
 * SECURITY: Prevents credential exposure in logs and error messages.
 */
function sanitizeCredentials(str) {
  if (!str || typeof str !== 'string') return str;
  
  let result = str;
  
  // URI format: postgresql://user:password@host:port/database
  result = result.replace(
    /(postgresql?:\/\/[^:]+:)([^@]+)(@)/gi,
    '$1***$3'
  );
  
  // Key-value format: password=secret
  result = result.replace(
    /(\bpassword\s*=\s*)([^\s,;]+)/gi,
    '$1***'
  );
  
  // Also handle pwd, passwd variations
  result = result.replace(
    /(\bpwd\s*=\s*)([^\s,;]+)/gi,
    '$1***'
  );
  
  // Handle pass= variations
  result = result.replace(
    /(\bpass\s*=\s*)([^\s,;]+)/gi,
    '$1***'
  );
  
  return result;
}

/**
 * Extract structured error information from a PostgreSQL error.
 * The pg driver puts all PG error fields on the Error object.
 * SECURITY: Sanitizes credential-like patterns from error messages.
 */
export function extractPgError(error) {
  // Sanitize message to prevent credential exposure
  const rawMessage = error.message || 'Unknown error';
  const message = sanitizeCredentials(rawMessage);
  
  return {
    message,
    code: error.code || 'UNKNOWN',
    severity: error.severity || 'ERROR',
    detail: error.detail ? sanitizeCredentials(error.detail) : null,
    hint: error.hint ? sanitizeCredentials(error.hint) : null,
    schema: error.schema || null,
    table: error.table || null,
    column: error.column || null,
    datatype: error.datatype || null,
    constraint: error.constraint || null,
    position: error.position || null,
    where: error.where ? sanitizeCredentials(error.where) : null,
    isPgError: !!error.code && /^[0-9A-Z]{5}$/.test(error.code),
  };
}

/**
 * Classify PostgreSQL error code for recovery decisions.
 */
export function classifyPgError(errorCode) {
  if (!errorCode || typeof errorCode !== 'string') {
    return { category: 'unknown', recoverable: false, action: 'abort' };
  }

  const prefix = errorCode.substring(0, 2);

  const CLASSIFICATION = {
    '42': {
      '42P01': { category: 'undefined_object', recoverable: false, action: 'skip_if_drop' },
      '42P07': { category: 'duplicate_object', recoverable: false, action: 'skip' },
      '42P06': { category: 'duplicate_schema', recoverable: false, action: 'skip' },
      '42701': { category: 'duplicate_column', recoverable: false, action: 'skip' },
      '42710': { category: 'duplicate_object', recoverable: false, action: 'skip' },
      '42723': { category: 'duplicate_function', recoverable: false, action: 'skip' },
      '42P16': { category: 'invalid_schema', recoverable: false, action: 'abort' },
      '42P09': { category: 'ambiguous_alias', recoverable: false, action: 'abort' },
      '42501': { category: 'insufficient_privilege', recoverable: false, action: 'abort' },
      'default': { category: 'syntax_or_access', recoverable: false, action: 'abort' },
    },
    '23': {
      '23505': { category: 'unique_violation', recoverable: false, action: 'abort' },
      '23503': { category: 'foreign_key_violation', recoverable: false, action: 'abort' },
      '23514': { category: 'check_violation', recoverable: false, action: 'abort' },
      '23502': { category: 'not_null_violation', recoverable: false, action: 'abort' },
      'default': { category: 'integrity', recoverable: false, action: 'abort' },
    },
    '53': {
      '53100': { category: 'disk_full', recoverable: false, action: 'abort' },
      '54000': { category: 'too_many_columns', recoverable: false, action: 'abort' },
      'default': { category: 'insufficient_resources', recoverable: false, action: 'abort' },
    },
    '54': { category: 'program_limit', recoverable: false, action: 'abort' },
    '58': { category: 'system_error', recoverable: true, action: 'retry' },
    '40': {
      '40001': { category: 'serialization_failure', recoverable: true, action: 'retry' },
      '40P01': { category: 'deadlock', recoverable: true, action: 'retry' },
      'default': { category: 'tx_integrity', recoverable: false, action: 'abort' },
    },
    '55': {
      '55006': { category: 'object_in_use', recoverable: true, action: 'wait_retry' },
      'default': { category: 'object_not_prerequisite', recoverable: false, action: 'abort' },
    },
    '57': {
      '57P03': { category: 'cannot_connect_now', recoverable: true, action: 'wait_retry' },
      '57P04': { category: 'database_dropped', recoverable: false, action: 'abort' },
      'default': { category: 'lock_not_available', recoverable: true, action: 'wait_retry' },
    },
    '25': {
      '25P02': { category: 'in_failed_tx', recoverable: false, action: 'abort' },
      'default': { category: 'invalid_tx_state', recoverable: false, action: 'abort' },
    },
    '08': { category: 'connection_error', recoverable: true, action: 'retry' },
    '0A': { category: 'feature_not_supported', recoverable: false, action: 'abort' },
    '0B': { category: 'invalid_tx_init', recoverable: false, action: 'abort' },
    'F0': { category: 'config_error', recoverable: false, action: 'abort' },
    'HV': { category: 'fdw_error', recoverable: false, action: 'abort' },
    'P0': { category: 'plpgsql_error', recoverable: false, action: 'abort' },
    'XX': { category: 'internal_error', recoverable: false, action: 'abort' },
  };

  const prefixLookup = CLASSIFICATION[prefix];
  if (prefixLookup) {
    if (typeof prefixLookup === 'object') {
      const fullCodeLookup = prefixLookup[errorCode];
      if (fullCodeLookup) {
        return fullCodeLookup;
      }
      if (prefixLookup.default) {
        return prefixLookup.default;
      }
    }
    return prefixLookup;
  }

  return { category: 'unknown', recoverable: false, action: 'abort' };
}

/**
 * Detect SQL statements that cannot run inside a transaction.
 */
export function isNonTransactionalSQL(sql, step = {}) {
  if (step.isTransactional === false) return true;
  if (step.isConcurrent === true) return true;

  if (!sql || typeof sql !== 'string') return false;

  // Check via centralized DDL type registry if step has ddlStrategy
  if (step.ddlStrategy && isDDLTransactionalInPG(step.ddlStrategy, step.pgVersionNum) === false) {
    return true;
  }

  const normalizedSql = sql.trim().toUpperCase();

  // CONCURRENTLY index operations — never transactional
  if (/\b(CREATE|DROP|REINDEX)\s+INDEX\s+CONCURRENTLY\b/i.test(sql)) {
    return true;
  }

  // ALTER TYPE ... ADD VALUE — transactional since PG12 (standalone)
  if (/\bALTER\s+TYPE\s+.*\bADD\s+VALUE\b/i.test(sql)) {
    const pgVer = step.pgVersionNum ||
      (step.pgVersion ? parseFloat(step.pgVersion) * 10000 : 140000);
    return !isDDLTransactionalInPG('ALTER_TYPE_ADD_VALUE', pgVer);
  }

  // DETACH PARTITION <name> CONCURRENTLY — never transactional (PG17+)
  if (/\bDETACH\s+PARTITION\s+.+?\s+CONCURRENTLY\b/i.test(sql)) {
    return true;
  }

  // VACUUM — never transactional (except VACUUM ANALYZE)
  if (/\bVACUUM\b/i.test(normalizedSql) &&
      !normalizedSql.includes('ANALYZE') &&
      !normalizedSql.startsWith('ANALYZE')) {
    return true;
  }

  // CLUSTER — never transactional
  if (/\bCLUSTER\b/i.test(normalizedSql) && !/\bCLUSTERED\b/.test(normalizedSql)) {
    return true;
  }

  // CREATE DATABASE / DROP DATABASE — never transactional
  if (/\bCREATE\s+DATABASE\b/i.test(normalizedSql) || /\bDROP\s+DATABASE\b/i.test(normalizedSql)) {
    return true;
  }

  return false;
}

/**
 * Detect PostgreSQL server version.
 */
async function detectPgVersion(pool) {
  try {
    const result = await pool.query('SELECT version()');
    const versionString = result.rows[0].version;
    const match = versionString.match(/PostgreSQL\s+(\d+)(?:\.(\d+))?/);
    if (match) {
      return `${match[1]}.${match[2] || '0'}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} ExecutionConfig
 * @property {boolean} [dryRun=false]
 * @property {number} [timeout=300000]
 * @property {boolean} [continueOnError=false]
 * @property {boolean} [snapshotBefore=true]
 * @property {boolean} [verifyAfter=true]
 * @property {string} [lockTimeout='5s']
 * @property {string} [statementTimeout='30s']
 * @property {number} [lockKey] - Advisory lock key
 */

export class MigrationExecutor {
  pgVersion = null;
  connectionId = null;
  static MIN_POOL_SIZE = 3;
  _executionLock = null;

  /**
   * Validate pool has sufficient connections for migration
   * @param {import('pg').Pool} pool
   * @returns {{ valid: boolean, message?: string }}
   */
  static validatePool(pool) {
    if (!pool) {
      return { valid: false, message: 'Pool is required' };
    }
    
    const poolSize = pool.options?.max || pool.totalCount || 10;
    if (poolSize < MigrationExecutor.MIN_POOL_SIZE) {
      return { 
        valid: false, 
        message: `Pool size ${poolSize} is too small. Minimum ${MigrationExecutor.MIN_POOL_SIZE} connections required for safe migration execution.`
      };
    }
    
    return { valid: true };
  }

  /**
   * @param {import('pg').Pool} pool
   * @param {import('../introspection/index.js').Introspector} introspector
   * @param {import('../storage/migration-table.js').MigrationTable} storage
   * @param {ExecutionConfig} [config]
   */
  constructor(pool, introspector, storage, config = {}) {
    this.pool = pool;
    this.introspector = introspector;
    this.storage = storage;
    this.connectionId = config.connectionId || null;

    const poolValidation = MigrationExecutor.validatePool(pool);
    if (!poolValidation.valid) {
      console.warn('[MigrationExecutor] Pool validation warning:', poolValidation.message);
    }

    if (!this.connectionId) {
      console.warn(
        '[MigrationExecutor] No connectionId provided. ' +
        'Migrations will not be scoped to a database and will use fallback lock key.'
      );
    }

    this.config = {
      dryRun: config.dryRun || false,
      timeout: config.timeout || 300000,
      continueOnError: config.continueOnError || false,
      snapshotBefore: config.snapshotBefore !== false,
      verifyAfter: config.verifyAfter !== false,
      lockTimeout: config.lockTimeout || '5s',
      statementTimeout: config.statementTimeout || '30s',
      lockStatementTimeout: config.lockStatementTimeout || '15s',
      checkpointInterval: Number.isFinite(Number(config.checkpointInterval))
        ? Math.max(0, Number(config.checkpointInterval))
        : 0,
      lockHeartbeatInterval: config.lockHeartbeatInterval || 30000,
      lockMode: ['blocking', 'try', 'queue'].includes(config.lockMode) ? config.lockMode : 'blocking',
      heartbeatMethod: config.heartbeatMethod === 'application' ? 'application' : 'database',
      continueOnLockLoss: config.continueOnLockLoss || false,
      concurrentDdlMode: ['off', 'warn', 'block'].includes(config.concurrentDdlMode)
        ? config.concurrentDdlMode
        : 'warn',
      concurrentDdlLongQuerySeconds: config.concurrentDdlLongQuerySeconds || 30,
    };

    this.txManager = new TransactionManager(pool);
    this.lockManager = new LockManager(pool, { connectionId: this.connectionId });
    this.lockConflictDetector = new LockConflictDetector(pool);
    this.progressTracker = new ProgressTracker();
    this.driftDetector = new DriftDetector();
    this.crashRecovery = new CrashRecovery(pool, introspector, storage);
    this.stateMachine = storage.stateMachine || new MigrationStateMachine(pool);
    this._nonTxQueue = new NonTransactionalQueue();

    this.state = 'idle';
    this.executedSteps = [];
    this.intents = [];
    this.snapshots = { before: null, after: null };
    this.migrationRecord = null;
    this._heartbeatTimer = null;
    this._reconciledConnections = new Set();
  }

  async reconcileIfNeeded(connectionId) {
    const cid = connectionId || this.connectionId;
    if (!cid || this._reconciledConnections.has(cid)) {
      return null;
    }

    try {
      const result = await this.crashRecovery.reconcile(cid);
      this._reconciledConnections.add(cid);
      
      if (result.reconciled?.length > 0 || result.failed?.length > 0 || result.manualReview?.length > 0) {
        this.emitProgress({
          type: 'reconciliation_complete',
          connectionId: cid,
          reconciled: result.reconciled?.length || 0,
          failed: result.failed?.length || 0,
          manualReview: result.manualReview?.length || 0,
          durationMs: result.durationMs,
        });
      }
      
      return result;
    } catch (error) {
      console.warn(`[MigrationExecutor] Reconciliation failed for ${cid}: ${error.message}`);
      return null;
    }
  }

  /**
   * Execute a migration plan
   * @param {import('../types/migration.js').MigrationPlan} plan
   * @param {import('../types/execution.js').ExecutionOptions} [options]
   * @returns {Promise<import('../types/migration.js').MigrationResult>}
   */
  async execute(plan, options = {}) {
    if (this._executionLock !== null) {
      throw new Error(
        `Migration already in progress on this executor. ` +
        `State: ${this.state}. Wait for completion or use a new MigrationExecutor instance.`
      );
    }
    
    const startTime = Date.now();
    const connectionId = options.connectionId || this.connectionId;
    const mergedConfig = { ...this.config, ...options, connectionId };

    this._executionLock = this._executeInternal(plan, mergedConfig, startTime);
    
    try {
      return await this._executionLock;
    } finally {
      this._executionLock = null;
    }
  }

  async _executeInternal(plan, mergedConfig, startTime) {
    const connectionId = mergedConfig.connectionId;
    
    const result = {
      migrationId: null,
      status: MIGRATION_STATUS.RUNNING,
      stepsCompleted: 0,
      stepsSkipped: 0,
      stepsFailed: 0,
      stepsTotal: plan.steps?.length || 0,
      success: true,
      errors: [],
      warnings: [],
      intents: [],
      startedAt: new Date(startTime).toISOString(),
      connectionId,
    };

    try {
      this.state = 'running';
      this.intents = [];
      this.executedSteps = [];

      this.emitProgress({ type: 'execution_start', planId: plan.id, timestamp: new Date().toISOString(), connectionId });

      this.pgVersion = await detectPgVersion(this.pool);

      await this.preflightCheck(plan, mergedConfig);

      if (mergedConfig.autoReconcile !== false) {
        await this.reconcileIfNeeded(connectionId);
      }

      const lockKey = this.lockManager.computeLockKey(connectionId);
      mergedConfig.lockKey = String(lockKey);

      const detectedSteps = this._detectNonTransactionalSteps(plan.steps || [], result);
      const phases = this.groupStepsByPhase(detectedSteps);
      const phaseOrder = Object.keys(phases).map(Number).sort((a, b) => a - b);

      const planWithLock = {
        ...plan,
        lockKey: String(lockKey),
      };

      // 1. Create the record as 'pending' BEFORE taking the lock so the
      //    gatekeeper check runs against the full active-status set.
      this.migrationRecord = await this.storage.createRecord(planWithLock, connectionId);
      result.migrationId = this.migrationRecord?.id || this.migrationRecord?.migration_id || plan.id;
      const recordId = this.migrationRecord?.id || this.migrationRecord?.migration_id;

      // 2. pending -> acquiring_lock
      await this.stateMachine.transition(recordId, 'acquiring_lock', {
        reason: 'lock_acquisition_started',
      });

      // 3. Acquire the advisory lock. On failure, fail the record and bail.
      try {
        await this.acquireAdvisoryLock({ ...mergedConfig, lockKey });
      } catch (lockError) {
        try {
          await this.storage.failRecord(recordId, lockError, []);
        } catch (failError) {
          console.error('[CRITICAL] Failed to mark record as failed after lock error:', failError.message);
        }
        throw lockError;
      }

      this._startLockHeartbeat({ ...mergedConfig, lockKey });

      const lockInfo = this.lockManager.locks.get(lockKey);
      const lockPid = lockInfo?.client?.connection?.processID || null;

      // 4. acquiring_lock -> running (lock held, heartbeat cadence recorded)
      await this.storage.activateRecord(recordId, {
        executorPid: process.pid,
        executorHostname: os.hostname(),
        heartbeatIntervalMs: mergedConfig.lockHeartbeatInterval || 30000,
        lockPid,
        phaseCount: phaseOrder.length,
        stepCount: plan.steps?.length || 0,
      });

      if (mergedConfig.snapshotBefore) {
        try {
          this.snapshots.before = await this.captureSnapshot();
        } catch (snapshotError) {
          console.error('[MigrationExecutor] Snapshot capture failed:', snapshotError.message);
          result.warnings.push({
            message: `Snapshot capture failed: ${snapshotError.message}. Proceeding without before-snapshot.`,
            severity: 'medium',
          });
          this.snapshots.before = null;
        }
      }

      for (const phaseNum of phaseOrder) {
        this._assertLockStillHeld();
        const phaseSteps = phases[phaseNum];
        await this.updateHeartbeat({ phase: phaseNum });
        await this.executePhase(phaseNum, phaseSteps, mergedConfig, result);
        await this._writeCheckpoint(mergedConfig, result, phaseNum, null);
      }

      // Execute queued non-transactional steps (CIC, VACUUM, ...) ONLY after
      // all transactional phases have committed, so a failed migration never
      // leaves orphaned non-tx objects behind.
      if (!this._nonTxQueue.isEmpty) {
        await this.updateHeartbeat({ phase: -1 });
        await this._executeNonTxQueue(mergedConfig, result);
        await this._writeCheckpoint(mergedConfig, result, 'non_tx_queue', null);
      }

      if (result.stepsFailed === 0) {
        result.status = mergedConfig.dryRun ? MIGRATION_STATUS.DRY_RUN_SUCCESS : MIGRATION_STATUS.COMPLETED;
        result.success = true;
      } else if (mergedConfig.continueOnError && result.stepsCompleted > 0) {
        result.status = mergedConfig.dryRun ? MIGRATION_STATUS.DRY_RUN_FAILURE : MIGRATION_STATUS.PARTIALLY_APPLIED;
        result.success = false;
      } else {
        result.status = mergedConfig.dryRun ? MIGRATION_STATUS.DRY_RUN_FAILURE : MIGRATION_STATUS.FAILED;
        result.success = false;
      }
      this.finalResultStatus = result.status;

      // 5. running -> verifying (post-flight verification)
      await this.stateMachine.transition(recordId, 'verifying', {
        reason: 'post_flight_verification',
      });

      if (mergedConfig.verifyAfter && !mergedConfig.dryRun) {
        await this.postflightVerify(plan, mergedConfig);
      }

      if (mergedConfig.snapshotBefore && !mergedConfig.dryRun) {
        this.snapshots.after = await this.captureSnapshot();
      }

      // 6. verifying -> completing (finalizing record)
      await this.stateMachine.transition(recordId, 'completing', {
        reason: 'finalizing_record',
      });

      await this.completeMigrationRecord();

      this._stopLockHeartbeat();
      await this.releaseAdvisoryLock();

      this.state = 'completed';

      return this.buildResult(plan, result.status.toLowerCase(), startTime, result);

    } catch (error) {
      this.state = 'failed';
      this._stopLockHeartbeat();
      
      const recordId = this.migrationRecord?.id || this.migrationRecord?.migration_id;
      if (recordId) {
        try {
          await this.storage.failRecord(recordId, error, this.executedSteps);
        } catch (failRecordError) {
          console.error('[CRITICAL] Failed to mark migration as failed:', failRecordError.message);
        }
      }
      
      let recoveryInfo = null;
      try {
        recoveryInfo = await this.handleFailure(error, plan);
      } catch (recoveryError) {
        console.error('[CRITICAL] handleFailure() error:', recoveryError.message);
        await this.lockManager.release().catch(() => {});
        recoveryInfo = { state: 'recovery_failed', error: recoveryError.message };
      }
      
      result.status = 'FAILED';
      result.success = false;
      result.errors.push({
        message: error.message,
        code: error.code || 'UNKNOWN',
        recovery: recoveryInfo,
      });
      const failedPhase = result.errors?.[0]?.step || this.executedSteps?.[this.executedSteps.length - 1];
      const phaseNum = failedPhase?.phase || 0;
      const phaseName = this.getPhaseName(phaseNum) || 'initialization';
      const stepId = failedPhase?.stepId || 'unknown';
      // Intentional concurrency rejections must surface as-is so callers can
      // discriminate them from internal execution failures.
      if (error instanceof MigrationConflictError) {
        throw error;
      }
      throw new ExecutionError(
        `Migration ${plan.id} failed at phase ${phaseNum || '?'} "${phaseName}" step "${stepId}"` +
        `: ${error.message}${failedPhase?.sql ? `\nSQL: ${failedPhase.sql.substring(0, 300)}` : ''}`,
        { cause: error, recovery: recoveryInfo, result }
      );
    } finally {
      this._stopLockHeartbeat();
      if (this.lockManager.isLocked) {
        try {
          await this.lockManager.release();
        } catch (releaseError) {
          console.error('[CRITICAL] Lock release failed in finally block:', releaseError.message);
        }
      }
      
      this.state = 'idle';
      this.intents = [];
      this.executedSteps = [];
      this.migrationRecord = null;
      this.snapshots = { before: null, after: null };
      this._nonTxQueue.clear();
    }
  }

  /**
   * Detect and fix non-transactional step classification
   */
  _detectNonTransactionalSteps(steps, result) {
    return steps.map(step => {
      const pgVersionInt = step.pgVersionNum || (this.pgVersion ? parseFloat(this.pgVersion) * 10000 : 140000);
      const detectedNonTx = isNonTransactionalSQL(step.sql || '', {
        ...step,
        pgVersion: step.pgVersion || this.pgVersion,
        pgVersionNum: pgVersionInt,
        ddlStrategy: step.ddlStrategy || (step.isConcurrent ? 'CREATE_INDEX_CONCURRENTLY' : null),
      });

      if (detectedNonTx && step.isTransactional !== false) {
        result.warnings.push({
          step: step.id,
          message: `Step was marked as transactional but contains non-transactional SQL. Automatically moved to non-transactional execution.`,
          severity: 'high',
        });
        return { ...step, isTransactional: false };
      }

      if (!detectedNonTx && step.isTransactional === false) {
        result.warnings.push({
          step: step.id,
          message: `Step is marked non-transactional but SQL appears transaction-safe.`,
          severity: 'low',
        });
      }

      return step;
    });
  }

  /**
   * Start lock heartbeat timer
   * Uses database-level lock verification to detect if lock was lost due to
   * connection issues or manual termination.
   */
  _startLockHeartbeat(config) {
    this._stopLockHeartbeat();
    this._lockHeartbeatConfig = config;
    if (config.lockHeartbeatInterval > 0) {
      this._heartbeatTimer = setInterval(async () => {
        try {
          await this._performHeartbeatCheck(config);
        } catch (error) {
          console.error('[MigrationExecutor] Heartbeat check failed:', error.message);
          this._handleLockLost(error);
        }
      }, config.lockHeartbeatInterval);
    }
  }

  /**
   * Perform a heartbeat check by querying the database for lock status.
   * This is more reliable than in-memory checks because it detects if
   * the connection was silently dropped or the lock was terminated.
   *
   * heartbeatMethod 'database' (default) verifies via pg_locks that the
   * lock is still held by THIS backend (pg_backend_pid on the lock client);
   * 'application' uses the fast in-memory check.
   */
  async _performHeartbeatCheck(config) {
    const lockKey = config.lockKey || this.lockManager.lockId;

    let held = false;
    try {
      held = await this.lockManager.heartbeat(lockKey, {
        method: config.heartbeatMethod || this.config.heartbeatMethod || 'database',
      });
    } catch (error) {
      held = false;
    }

    if (!held) {
      this.emitProgress({
        type: 'error',
        message: 'Advisory lock lost during migration.',
        severity: 'critical',
        lockKey,
        executedSteps: this.executedSteps.length,
      });
      
      throw new LockAcquisitionError(
        `Advisory lock ${lockKey} lost during migration. ` +
        `This can happen if: (1) the database connection was recycled, ` +
        `(2) the backend was terminated manually, ` +
        `or (3) a connection pool timeout occurred. ` +
        `Migration state: ${this.state}. ` +
        `Completed steps: ${this.executedSteps.length}. ` +
        `To recover: Check the migration history table for status, ` +
        `verify the current database state with introspection, ` +
        `and re-run if necessary.`,
        { 
          lockId: lockKey, 
          connectionId: this.connectionId,
          state: this.state,
          executedSteps: this.executedSteps.length,
          lastExecutedStep: this.executedSteps[this.executedSteps.length - 1]?.stepId || null,
        }
      );
    }
  }

  /**
   * Check if lock is held by self (in-memory check)
   */
  isHeldBySelf(lockKey) {
    return this.lockManager.isHeldBySelf(lockKey);
  }

  /**
   * Handle lock lost during migration
   * Sets state to 'lock_lost', stops heartbeat, and stores recovery information
   */
  _handleLockLost(error) {
    this.state = 'lock_lost';
    this._lockLostError = error;
    this._stopLockHeartbeat();
    
    this.emitProgress({
      type: 'lock_lost',
      message: error.message,
      severity: 'critical',
      recovery: error.details,
    });
  }

  /**
   * Abort the migration if the heartbeat detected lock loss.
   * Throws the stored LockAcquisitionError so the phase loop stops and the
   * migration is marked failed (reconcilable by crash-recovery).
   */
  _assertLockStillHeld() {
    if (this.state === 'lock_lost') {
      throw this._lockLostError || new LockAcquisitionError(
        'Advisory lock lost during migration',
        { connectionId: this.connectionId }
      );
    }
  }

  /**
   * Stop lock heartbeat timer
   */
  _stopLockHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Persist an execution checkpoint every `checkpointInterval` completed
   * steps (0 = disabled, the default). Best-effort: a failed checkpoint
   * write never breaks the migration — it emits a progress event instead.
   *
   * The checkpoint records the current phase cursor plus the list of
   * completed step ids so crash recovery can resume precisely without
   * scanning the execution log.
   */
  async _writeCheckpoint(config, result, phaseNum, stepId) {
    const interval = Number(config.checkpointInterval || 0);
    if (!interval || interval <= 0) return;

    const recordId = this.migrationRecord?.id || this.migrationRecord?.migration_id;
    if (!recordId) return;

    if (result.stepsCompleted % interval !== 0) return;

    const checkpoint = {
      phase: phaseNum,
      stepId: stepId || null,
      stepsCompleted: result.stepsCompleted,
      stepsFailed: result.stepsFailed,
      stepsTotal: result.stepsTotal,
      completedSteps: this.executedSteps
        .filter(s => s.status === 'completed')
        .map(s => s.stepId),
      at: new Date().toISOString(),
    };

    try {
      await this.storage.updateHeartbeat(recordId, { phase: phaseNum, stepId: stepId || null });
      if (typeof this.storage.writeCheckpoint === 'function') {
        await this.storage.writeCheckpoint(recordId, checkpoint);
      }
      this.emitProgress({
        type: 'checkpoint',
        ...checkpoint,
      });
    } catch (error) {
      this.emitProgress({
        type: 'checkpoint_error',
        error: error.message,
      });
    }
  }

  /**
   * Record step intent before execution
   */
  _recordIntent(step, status = 'INTENT') {
    const intent = {
      stepId: step.id,
      phase: step.phase,
      changeType: step.changeType,
      objectType: step.objectType,
      objectKey: step.objectKey,
      objectName: step.objectName,
      sql: step.sql,
      isTransactional: step.isTransactional !== false,
      preCheck: step.preCheck || false,
      recoverySql: step.recoverySql || null,
      undoSql: step.undoSql || step.rollbackSql || null,
      recordedAt: new Date().toISOString(),
      status,
    };
    this.intents.push(intent);
    return intent;
  }

  /**
   * Update intent after execution
   */
  _updateIntent(intent, updates) {
    Object.assign(intent, updates);
    return intent;
  }

  /**
   * Group steps by their phase number
   * @param {Array} steps
   * @returns {Object<number, Array>}
   */
  groupStepsByPhase(steps) {
    const phases = {};
    for (const step of steps) {
      const phase = step.phase || 10;
      if (!phases[phase]) phases[phase] = [];
      phases[phase].push(step);
    }
    return phases;
  }

  /**
   * Execute all steps in a phase
   * @param {number} phaseNum
   * @param {Array} steps
   * @param {ExecutionConfig} config
   * @param {Object} result
   */
  async executePhase(phaseNum, steps, config, result) {
    const phaseName = this.getPhaseName(phaseNum);

    this.emitProgress({
      type: 'phase_start',
      phase: phaseNum,
      phaseName,
      stepCount: steps.length,
    });

    if (config.concurrentDdlMode && config.concurrentDdlMode !== 'off') {
      await this._detectConcurrentDdl(phaseNum, phaseName, config, result);
    }

    const transactional = steps.filter(s => s.isTransactional !== false);
    const nonTransactional = steps.filter(s => s.isTransactional === false);

    if (transactional.length > 0) {
      await this.executeInTransaction(transactional, phaseNum, config, result);
    }

    // Non-transactional steps are QUEUED, not executed here. They run only
    // after every transactional phase has committed (see _executeNonTxQueue).
    for (const step of nonTransactional) {
      this._nonTxQueue.enqueue(step);
      this.emitProgress({
        type: 'step_queued',
        phase: phaseNum,
        phaseName,
        stepId: step.id,
        sql: step.sql,
        reason: 'Non-transactional step queued for post-commit execution',
      });
    }

    this.emitProgress({
      type: 'phase_complete',
      phase: phaseNum,
      phaseName,
    });
  }

  /**
   * Concurrent-DDL monitoring for a phase (config.concurrentDdlMode).
   * 'warn' pushes a warning + progress event and continues; 'block' throws a
   * MigrationConflictError. Detection failures degrade to cautions and never
   * break the migration.
   */
  async _detectConcurrentDdl(phaseNum, phaseName, config, result) {
    const lockInfo = this.lockManager.locks.get(config.lockKey);
    const excludePid = lockInfo?.client?.connection?.processID || null;

    let detection;
    try {
      detection = await this.lockConflictDetector.detect({
        excludePid,
        longQuerySeconds: config.concurrentDdlLongQuerySeconds || 30,
      });
    } catch (error) {
      this.emitProgress({
        type: 'concurrent_ddl_detection_error',
        phase: phaseNum,
        phaseName,
        error: error.message,
      });
      return;
    }

    if (!detection.detected && detection.cautions.length === 0) {
      return;
    }

    this.emitProgress({
      type: 'concurrent_ddl_detected',
      phase: phaseNum,
      phaseName,
      severity: detection.detected ? 'critical' : 'medium',
      conflicts: detection.conflicts.length,
      cautions: detection.cautions.length,
      details: LockConflictDetector.summarize(detection),
    });

    if (detection.detected && config.concurrentDdlMode === 'block') {
      throw new MigrationConflictError(
        `Concurrent DDL detected before phase ${phaseNum} "${phaseName}":\n` +
        LockConflictDetector.summarize(detection),
        { phase: phaseNum, conflicts: detection.conflicts, phaseName }
      );
    }

    result.warnings.push({
      phase: phaseNum,
      phaseName,
      severity: detection.detected ? 'high' : 'low',
      message: `Concurrent activity detected before phase ${phaseNum} "${phaseName}":\n` +
        LockConflictDetector.summarize(detection),
      concurrentDdl: {
        conflicts: detection.conflicts,
        cautions: detection.cautions,
        mode: config.concurrentDdlMode,
      },
    });
  }

  /**
   * Execute the queued non-transactional steps (in plan/phase order) after
   * all transactional phases have committed. Each step runs outside a
   * transaction; failures count against the result and, combined with
   * transactional success, yield PARTIALLY_APPLIED.
   */
  async _executeNonTxQueue(config, result) {
    const queueSteps = this._nonTxQueue.steps;

    this.emitProgress({
      type: 'non_tx_queue_start',
      stepCount: queueSteps.length,
    });

    for (const step of queueSteps) {
      this._assertLockStillHeld();
      await this.updateHeartbeat({ phase: step.phase, stepId: step.id });
      await this.executeNonTransactionalStep(step, step.phase, config, result);
    }

    this.emitProgress({
      type: 'non_tx_queue_complete',
      stepCount: queueSteps.length,
    });
  }

  /**
   * Execute transactional steps in a single transaction
   * @param {Array} steps
   * @param {number} phaseNum
   * @param {ExecutionConfig} config
   * @param {Object} result
   */
  async executeInTransaction(steps, phaseNum, config, result) {
    const phaseName = this.getPhaseName(phaseNum);
    // Run the phase transaction on the advisory-lock's dedicated client so
    // the session-level lock and the transaction-level lock of the same key
    // are held by ONE session (advisory locks conflict across sessions).
    // Fall back to a pool client when no lock client exists (e.g. dry-run
    // paths without a session lock); such clients are released afterwards.
    const lockClient = this.lockManager.getLockClient(config.lockKey);
    const usingLockClient = !!lockClient;
    const client = lockClient || await this.pool.connect();

    const stepsCompleted = [];
    const stepsFailed = [];
    const stepsSkipped = [];

    try {
      await client.query('BEGIN');

      // lock_timeout bounds the advisory-lock wait; statement_timeout is set
      // to lockStatementTimeout for the lock query itself and then reset to
      // the DDL statementTimeout once the lock is held, so a hung lock query
      // can never stall the migration indefinitely.
      await client.query(`SET LOCAL lock_timeout = '${config.lockTimeout}'`);
      await client.query(`SET LOCAL statement_timeout = '${config.lockStatementTimeout || config.statementTimeout}'`);
      await client.query(`SET LOCAL search_path = 'public'`);

      // Transaction-scoped advisory lock: auto-releases on COMMIT/ROLLBACK,
      // so a crashed process can never leave a dangling phase lock and
      // concurrent DDL writers are blocked for the duration of this DDL tx.
      // lock_timeout (SET LOCAL above) applies in blocking/queue modes.
      await this.lockManager.acquireXactLock(
        client,
        config.lockKey,
        config.lockMode || this.config.lockMode
      );

      await client.query(`SET LOCAL statement_timeout = '${config.statementTimeout}'`);

      for (const step of steps) {
        this._assertLockStillHeld();
        const savepointName = `sp_${sanitizeSavepointName(step.id)}`;
        const intent = this._recordIntent(step, 'INTENT');
        result.intents.push(intent);

        await this._logStep({
          stepId: step.id,
          phase: phaseNum,
          status: 'intent',
          sql: step.sql,
          isTransactional: true,
        });

        try {
          await client.query(`SAVEPOINT ${savepointName}`);

          await this.executeStepWithRetry(client, step, phaseNum, phaseName, config);

          await client.query(`RELEASE SAVEPOINT ${savepointName}`);
          stepsCompleted.push(step);

          this._updateIntent(intent, {
            status: 'COMPLETED',
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - new Date(intent.recordedAt).getTime(),
          });

          result.stepsCompleted++;

          await this._logStep({
            stepId: step.id,
            phase: phaseNum,
            status: 'completed',
            sql: step.sql,
            isTransactional: true,
            completedAt: new Date(),
            durationMs: Date.now() - new Date(intent.recordedAt).getTime(),
            rowsAffected: 1,
          });

        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
          await client.query(`RELEASE SAVEPOINT ${savepointName}`);

          const pgError = extractPgError(error);
          const classification = classifyPgError(pgError.code);

          const isDropStep = step.changeType === 'DROP';
          const shouldSkipDuplicate = classification.action === 'skip';
          const shouldSkipIfDrop = classification.action === 'skip_if_drop' && isDropStep;

          if (shouldSkipDuplicate || shouldSkipIfDrop) {
            stepsSkipped.push({ step, reason: classification.category });

            this._updateIntent(intent, {
              status: 'SKIPPED',
              completedAt: new Date().toISOString(),
              skipReason: classification.category,
              pgCode: pgError.code,
            });

            result.warnings.push({
              step: step.id,
              message: `Skipped: ${pgError.message} (${pgError.code})`,
              severity: 'low',
              pgCode: pgError.code,
            });
            result.stepsSkipped++;

            await this._logStep({
              stepId: step.id,
              phase: phaseNum,
              status: 'skipped',
              sql: step.sql,
              isTransactional: true,
              errorCode: pgError.code,
              errorMessage: pgError.message,
            });
            continue;
          }

          stepsFailed.push({ step, error, pgError, classification });

          this._updateIntent(intent, {
            status: 'FAILED',
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - new Date(intent.recordedAt).getTime(),
            errorCode: pgError.code,
            errorMessage: pgError.message,
          });

          result.stepsFailed++;
          result.errors.push({
            step: step.id,
            sql: step.sql,
            message: pgError.message,
            code: pgError.code,
            severity: pgError.severity,
            detail: pgError.detail,
            hint: pgError.hint,
            schema: pgError.schema,
            table: pgError.table,
            column: pgError.column,
            constraint: pgError.constraint,
            classification: classification.category,
            isNonTransactional: false,
          });

          this.executedSteps.push({
            stepId: step.id,
            sql: step.sql,
            phase: phaseNum,
            status: 'failed',
            error: error.message,
            errorCode: pgError.code,
            timestamp: new Date().toISOString(),
          });

          await this._logStep({
            stepId: step.id,
            phase: phaseNum,
            status: 'failed',
            sql: step.sql,
            isTransactional: true,
            errorCode: pgError.code,
            errorMessage: pgError.message,
            errorSeverity: pgError.severity,
            completedAt: new Date(),
            durationMs: Date.now() - new Date(intent.recordedAt).getTime(),
          });

          if (!config.continueOnError) {
            await client.query('ROLLBACK');
            throw new ExecutionError(
              `Phase ${phaseNum} ("${phaseName}") step "${step.id}" — ${step.objectType} "${step.objectKey}"` +
              `: ${pgError.message}${pgError.detail ? ' — ' + pgError.detail : ''}` +
              `${pgError.hint ? `\nHint: ${pgError.hint}` : ''}` +
              `\nSQL: ${(step.sql || '').substring(0, 300)}`,
              { phase: { number: phaseNum, name: phaseName }, step, cause: error, pgError }
            );
          }

          result.warnings.push({
            step: step.id,
            message: `Step failed but continuing: ${pgError.message} (${pgError.code})`,
            severity: 'medium',
            pgCode: pgError.code,
          });
        }
      }

      if (config.dryRun) {
        await client.query('ROLLBACK');
        this.emitProgress({
          type: 'dry_run_rollback',
          phase: phaseNum,
          phaseName,
          stepsRolledBack: stepsCompleted.length,
        });
      } else {
        await client.query('COMMIT');
      }

    } catch (error) {
      if (error instanceof ExecutionError) {
        throw error;
      }
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[CRITICAL] ROLLBACK failed:', rollbackError.message);
        this.emitProgress({
          type: 'error',
          message: `ROLLBACK failed: ${rollbackError.message}. Manual intervention may be required.`,
          severity: 'critical',
        });
      }
      throw new ExecutionError(
        `Phase "${phaseName}" failed: ${error.message}`,
        { phase: { number: phaseNum, name: phaseName }, cause: error }
      );
    } finally {
      if (!usingLockClient) client.release();
    }

    if (stepsFailed.length > 0 && config.continueOnError) {
      this.emitProgress({
        type: 'partial_completion',
        phase: phaseNum,
        phaseName,
        stepsCompleted: stepsCompleted.length,
        stepsFailed: stepsFailed.length,
        stepsSkipped: stepsSkipped.length,
      });
    }
  }

  /**
   * Execute a step with retry on transient errors.
   * Uses exponential backoff: 1s → 2s → 4s for up to 3 retries.
   * @param {number} [maxRetries=3] - Industry standard retry count
   */
  async executeStepWithRetry(client, step, phaseNum, phaseName, config, maxRetries = 3) {
    let lastError;
    let attempts = 0;
    const retryMetadata = { attempts: 0, backoffs: [] };

    while (attempts <= maxRetries) {
      try {
        await this.executeStep(client, step, phaseNum, phaseName, config);
        if (attempts > 0) {
          this.emitProgress({
            type: 'step_retry_success',
            stepId: step.id,
            totalAttempts: attempts,
            backoffs: retryMetadata.backoffs,
          });
        }
        return;
      } catch (error) {
        lastError = error;
        const pgError = extractPgError(error);
        const classification = classifyPgError(pgError.code);

        if (classification.action === 'retry' && attempts < maxRetries) {
          attempts++;
          const backoffMs = 1000 * Math.pow(2, attempts - 1);
          retryMetadata.backoffs.push(backoffMs);
          retryMetadata.attempts = attempts;
          
          this.emitProgress({
            type: 'step_retry',
            stepId: step.id,
            attempt: attempts,
            maxRetries,
            backoffMs,
            classification: classification.category,
            sqlState: pgError.code,
          });
          
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        if (classification.action === 'wait_retry' && attempts < maxRetries) {
          attempts++;
          const backoffMs = 3000 * Math.pow(2, attempts - 1);
          retryMetadata.backoffs.push(backoffMs);
          retryMetadata.attempts = attempts;
          
          this.emitProgress({
            type: 'step_retry',
            stepId: step.id,
            attempt: attempts,
            maxRetries,
            backoffMs,
            classification: classification.category,
            sqlState: pgError.code,
          });
          
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        if (attempts > 0) {
          error.retryMetadata = retryMetadata;
        }
        throw error;
      }
    }

    if (attempts > 0) {
      lastError.retryMetadata = retryMetadata;
    }
    throw lastError;
  }

  /**
   * Execute a single non-transactional step
   * @param {Object} step
   * @param {number} phaseNum
   * @param {ExecutionConfig} config
   * @param {Object} result
   */
  async executeNonTransactionalStep(step, phaseNum, config, result) {
    this._assertLockStillHeld();
    const phaseName = this.getPhaseName(phaseNum);

    const intent = this._recordIntent(step, 'INTENT');
    result.intents.push(intent);

    if (this.migrationRecord?.id) {
      await this.storage.updateStepProgress(
        this.migrationRecord.id,
        step.id,
        'intent',
        null
      ).catch(() => {});
    }

    await this._logStep({
      stepId: step.id,
      phase: phaseNum,
      status: 'intent',
      sql: step.sql,
      isTransactional: false,
    });

    if (config.dryRun) {
      this._updateIntent(intent, {
        status: 'SKIPPED',
        completedAt: new Date().toISOString(),
        skipReason: 'dry_run',
      });
      result.stepsSkipped++;

      await this._logStep({
        stepId: step.id,
        phase: phaseNum,
        status: 'skipped',
        sql: step.sql,
        isTransactional: false,
        skipReason: 'dry_run',
      });

      this.emitProgress({
        type: 'dry_run_skip',
        phase: phaseNum,
        phaseName,
        stepId: step.id,
        sql: step.sql,
        reason: 'Non-transactional DDL skipped in dry run (cannot rollback)',
      });
      return;
    }

    const client = await this.pool.connect();

    try {
      await client.query(`SET statement_timeout = '${config.statementTimeout}'`);

      const statements = splitSqlStatements(step.sql);

      if (statements.length > 1) {
        result.warnings.push({
          step: step.id,
          message: `Non-transactional step contains ${statements.length} SQL statements. Executing all sequentially.`,
          severity: 'medium',
        });
      }

      const totalStartTime = Date.now();
      let totalRowsAffected = 0;
      const statementResults = [];

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const stmtStartTime = Date.now();
        try {
          const queryResult = await client.query(stmt);
          const stmtDuration = Date.now() - stmtStartTime;
          totalRowsAffected += queryResult.rowCount || 0;
          statementResults.push({
            index: i,
            sql: stmt.substring(0, 200),
            success: true,
            duration: stmtDuration,
            rowCount: queryResult.rowCount,
          });
        } catch (stmtError) {
          const pgError = extractPgError(stmtError);
          statementResults.push({
            index: i,
            sql: stmt.substring(0, 200),
            success: false,
            error: pgError.message,
            errorCode: pgError.code,
          });
          throw stmtError;
        }
      }

      const totalDuration = Date.now() - totalStartTime;

      this.executedSteps.push({
        stepId: step.id,
        sql: step.sql,
        phase: phaseNum,
        status: 'completed',
        duration: totalDuration,
        rowsAffected: totalRowsAffected,
        timestamp: new Date().toISOString(),
        isTransactional: false,
        statementCount: statements.length,
        statementResults,
      });

      if (this.migrationRecord?.id) {
        await this.storage.updateStepProgress(
          this.migrationRecord.id,
          step.id,
          'completed',
          totalDuration
        ).catch(() => {});
      }

      this._updateIntent(intent, {
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        durationMs: totalDuration,
        statementCount: statements.length,
      });

      result.stepsCompleted++;

      await this._logStep({
        stepId: step.id,
        phase: phaseNum,
        status: 'completed',
        sql: step.sql,
        isTransactional: false,
        completedAt: new Date(),
        durationMs: totalDuration,
        rowsAffected: totalRowsAffected,
      });

      this.emitProgress({
        type: 'step_completed',
        phase: phaseNum,
        phaseName,
        stepId: step.id,
        sql: step.sql,
        duration: totalDuration,
        rowsAffected: totalRowsAffected,
        isNonTransactional: true,
        statementCount: statements.length,
      });

    } catch (error) {
      const pgError = extractPgError(error);
      const classification = classifyPgError(pgError.code);

      let invalidIndexes = [];
      const isConcurrentIndex = /CREATE\s+INDEX\s+CONCURRENTLY/i.test(step.sql || '');
      if (isConcurrentIndex) {
        try {
          const indexCheck = await client.query(`
            SELECT indexname, schemaname 
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE i.indisvalid = false
              AND c.relname IN (
                SELECT DISTINCT regexp_matches($1, 'CREATE\s+INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?(\w+)', 'gi')
              )
          `, [step.sql]);
          invalidIndexes = indexCheck.rows;
        } catch {}
      }

      let vacuumClusterState = null;
      const isVacuumOrCluster = /\b(VACUUM|CLUSTER)\b/i.test(step.sql || '');
      if (isVacuumOrCluster) {
        try {
          const tableMatch = step.sql.match(/(?:VACUUM\s+(?:FULL\s+)?(?:ANALYZE\s+)?|CLUSTER\s+)(?:\w+\.)?(\w+)/i);
          if (tableMatch) {
            const tableName = tableMatch[1];
            const tableCheck = await client.query(`
              SELECT c.relname, c.relpages, c.reltuples, pg_stat_get_live_tuples(c.oid) as live_tuples
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE c.relname = $1 AND n.nspname = 'public'
            `, [tableName]);
            if (tableCheck.rows.length > 0) {
              vacuumClusterState = {
                table: tableName,
                relpages: tableCheck.rows[0].relpages,
                reltuples: tableCheck.rows[0].reltuples,
                liveTuples: tableCheck.rows[0].live_tuples,
                verified: true,
              };
            }
          }
        } catch (e) {
          vacuumClusterState = { verified: false, error: e.message };
        }
      }

      const recoveryHint = invalidIndexes.length > 0
        ? `Invalid indexes detected: ${invalidIndexes.map(i => `${i.schemaname}.${i.indexname}`).join(', ')}. Run: DROP INDEX CONCURRENTLY ${invalidIndexes.map(i => `${i.schemaname}.${i.indexname}`).join('; DROP INDEX CONCURRENTLY ')};`
        : vacuumClusterState && !vacuumClusterState.verified
        ? `VACUUM/CLUSTER may be incomplete. Verify table state manually and re-run if needed.`
        : step.recoverySql || `Manual recovery may be required`;

      this._updateIntent(intent, {
        status: 'FAILED',
        completedAt: new Date().toISOString(),
        errorCode: pgError.code,
        errorMessage: pgError.message,
        invalidIndexes: invalidIndexes.length > 0 ? invalidIndexes : undefined,
      });

      result.stepsFailed++;
      result.errors.push({
        step: step.id,
        sql: step.sql,
        message: pgError.message,
        code: pgError.code,
        severity: pgError.severity,
        detail: pgError.detail,
        hint: pgError.hint,
        classification: classification.category,
        isNonTransactional: true,
        recoveryHint,
        invalidIndexes: invalidIndexes.length > 0 ? invalidIndexes : undefined,
        vacuumClusterState,
      });

      this.executedSteps.push({
        stepId: step.id,
        sql: step.sql,
        phase: phaseNum,
        status: 'failed',
        error: error.message,
        errorCode: pgError.code,
        isTransactional: false,
        timestamp: new Date().toISOString(),
        recoveryHint: recoveryHint.substring(0, 500),
        invalidIndexes: invalidIndexes.length > 0 ? invalidIndexes : undefined,
        vacuumClusterState,
      });

      if (this.migrationRecord?.id) {
        await this.storage.updateStepProgress(
          this.migrationRecord.id,
          step.id,
          'running',
          null
        ).catch(() => {});
      }

      await this._logStep({
        stepId: step.id,
        phase: phaseNum,
        status: 'failed',
        sql: step.sql,
        isTransactional: false,
        errorCode: pgError.code,
        errorMessage: pgError.message,
        errorSeverity: pgError.severity,
        completedAt: new Date(),
        durationMs: null,
        postCheckResult: {
          invalidIndexes: invalidIndexes.length > 0 ? invalidIndexes : undefined,
          vacuumClusterState,
          recoveryHint: recoveryHint.substring(0, 500),
        },
      });

      if (!config.continueOnError) {
        throw new ExecutionError(
          `Non-transactional step "${step.id}" — ${step.objectType} "${step.objectKey}"` +
          `: ${pgError.message}${pgError.detail ? ' — ' + pgError.detail : ''}` +
          `${pgError.hint ? `\nHint: ${pgError.hint}` : ''}` +
          `\nSQL: ${(step.sql || '').substring(0, 300)}` +
          `${invalidIndexes.length > 0 ? `\nInvalid indexes: ${invalidIndexes.map(i => i.indexname).join(', ')}` : ''}` +
          `\nRecovery: ${recoveryHint.substring(0, 400)}`,
          { phase: { number: phaseNum, name: phaseName }, step, cause: error, isNonTransactional: true, pgError, invalidIndexes }
        );
      }

      result.warnings.push({
        step: step.id,
        message: `Non-tx step failed: ${pgError.message} (${pgError.code})`,
        severity: 'high',
        pgCode: pgError.code,
        invalidIndexes: invalidIndexes.length > 0 ? invalidIndexes : undefined,
      });
    } finally {
      client.release();
    }
  }

  /**
   * Execute a single step
   * @param {import('pg').PoolClient} client
   * @param {Object} step
   * @param {number} phaseNum
   * @param {string} phaseName
   * @param {ExecutionConfig} config
   */
  async executeStep(client, step, phaseNum, phaseName, config) {
    if (step.preCheck) {
      const preCheckResult = await client.query(step.preCheck);
      if (step.preCheckExpectEmpty && preCheckResult.rows.length > 0) {
        throw new PreCheckFailedError(
          `Pre-check failed for step ${step.id}: ${step.preCheckMessage || 'Condition not met'}`,
          { step, preCheckResult }
        );
      }
    }

    const statements = splitSqlStatements(step.sql);
    
    if (statements.length === 0) {
      this.executedSteps.push({
        stepId: step.id,
        sql: step.sql,
        phase: phaseNum,
        phaseName,
        status: 'completed',
        duration: 0,
        rowsAffected: 0,
        timestamp: new Date().toISOString(),
        isTransactional: step.isTransactional !== false,
      });
      return;
    }

    if (statements.length === 1) {
      await this._executeSingleStatement(client, statements[0], step, phaseNum, phaseName);
      return;
    }

    const subResults = [];
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const subSavepointName = `sp_${sanitizeSavepointName(step.id)}_stmt_${i}`;
      
      try {
        await client.query(`SAVEPOINT ${subSavepointName}`);
        
        const result = await this._executeSingleStatement(client, stmt, step, phaseNum, phaseName, true);
        subResults.push(result);
        
        await client.query(`RELEASE SAVEPOINT ${subSavepointName}`);
        
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${subSavepointName}`);
        await client.query(`RELEASE SAVEPOINT ${subSavepointName}`);
        
        error.subStatementIndex = i;
        error.subStatementSql = stmt;
        throw error;
      }
    }

    this.emitProgress({
      type: 'step_completed',
      phase: phaseNum,
      phaseName,
      stepId: step.id,
      sql: step.sql,
      duration: subResults.reduce((sum, r) => sum + r.duration, 0),
      rowsAffected: subResults.reduce((sum, r) => sum + r.rowsAffected, 0),
      subStatements: statements.length,
    });
  }

  async _executeSingleStatement(client, sql, step, phaseNum, phaseName, isSubStatement = false) {
    const startTime = Date.now();
    const result = await client.query(sql);
    const duration = Date.now() - startTime;

    if (!isSubStatement) {
      this.executedSteps.push({
        stepId: step.id,
        sql: step.sql,
        phase: phaseNum,
        phaseName,
        status: 'completed',
        duration,
        rowsAffected: result.rowCount,
        timestamp: new Date().toISOString(),
        isTransactional: step.isTransactional !== false,
      });

      if (this.migrationRecord?.id) {
        await this.storage.updateStepProgress(
          this.migrationRecord.id,
          step.id,
          'completed',
          duration
        );
      }

      this.emitProgress({
        type: 'step_completed',
        phase: phaseNum,
        phaseName,
        stepId: step.id,
        sql: step.sql,
        duration,
        rowsAffected: result.rowCount,
      });

      if (step.postCheck) {
        await client.query(step.postCheck);
      }
    }

    return {
      success: true,
      rowsAffected: result.rowCount || 0,
      duration,
    };
  }

  /**
   * Pre-flight checks before execution
   * @param {import('../types/migration.js').MigrationPlan} plan
   * @param {ExecutionConfig} config
   */
async preflightCheck(plan, config) {
      await this.pool.query('SELECT 1');
  
      const versionResult = await this.pool.query('SHOW server_version_num');
      const version = parseInt(versionResult.rows[0].server_version_num);
  
      for (const step of plan.steps) {
        if (step.pgVersionMinimum && version < step.pgVersionMinimum * 10000) {
          throw new VersionIncompatibilityError(
            `Step "${step.id}" requires PG ${step.pgVersionMinimum}+ but database is PG ${Math.floor(version / 10000)}`,
            { requiredVersion: step.pgVersionMinimum, currentVersion: Math.floor(version / 10000) }
          );
        }
      }
  
      const longQueries = await this.pool.query(`
        SELECT pid, now() - pg_stat_activity.query_start AS duration, query
        FROM pg_stat_activity
        WHERE state = 'active'
          AND now() - query_start > interval '30 seconds'
          AND pid != pg_backend_pid()
      `);
      if (longQueries.rows.length > 0) {
        this.emitProgress({
          type: 'warning',
          message: `${longQueries.rows.length} long-running queries detected. Migration may be blocked.`,
          queries: longQueries.rows,
          connectionId: config.connectionId,
        });
      }
  
      await this.storage.ensureTable();

      if (config.verifyHistory !== false) {
        const integrity = await this.storage.verifyHistoryIntegrity(config.connectionId);
        if (!integrity.valid) {
          this.emitProgress({
            type: 'warning',
            message: `History integrity check found ${integrity.mismatches.length} checksum mismatch(es)`,
            mismatches: integrity.mismatches,
            connectionId: config.connectionId,
          });
        }
      }

      if (config.checkDriftBefore !== false) {
        await this.checkPreMigrationDrift(config);
      }
    }

    async checkPreMigrationDrift(config) {
      const lastMigration = await this.storage.getLastMigration(config.connectionId, true);
      
      if (!lastMigration?.snapshot_after) {
        this.emitProgress({
          type: 'info',
          message: 'No baseline snapshot found - skipping pre-migration drift check',
          connectionId: config.connectionId,
        });
        return;
      }

      let expectedSnapshot;
      try {
        expectedSnapshot = typeof lastMigration.snapshot_after === 'string' 
          ? JSON.parse(lastMigration.snapshot_after) 
          : lastMigration.snapshot_after;
      } catch (e) {
        this.emitProgress({
          type: 'warning',
          message: 'Could not parse baseline snapshot - skipping drift check',
          connectionId: config.connectionId,
        });
        return;
      }

      const currentSnapshot = await this.captureSnapshot();

      const drift = this.driftDetector.detect(expectedSnapshot, currentSnapshot, { changes: [] });
      
      if (drift.detected) {
        const summary = `Objects created: ${drift.summary.objectsCreated || 0}, ` +
          `Objects dropped: ${drift.summary.objectsDropped || 0}, ` +
          `Objects modified: ${drift.summary.objectsModified || 0}`;

        if (config.abortOnDrift !== false) {
          throw new DriftDetectedError(
            `Pre-migration drift detected: ${summary}. ` +
            `Set abortOnDrift: false to proceed anyway, or run reconciliation first.`,
            { drift, phase: 'pre_migration', expectedSnapshot, currentSnapshot }
          );
        }

        this.emitProgress({
          type: 'warning',
          message: `Pre-migration drift detected (proceeding): ${summary}`,
          drift,
          connectionId: config.connectionId,
        });

        config._driftDetected = drift;
      } else {
        this.emitProgress({
          type: 'info',
          message: 'Pre-migration drift check passed - schema is consistent',
          connectionId: config.connectionId,
        });
      }
    }

  /**
   * Acquire advisory lock
   * @param {ExecutionConfig} config
   */
  async acquireAdvisoryLock(config) {
    const lockKey = config.lockKey || this.lockManager.computeLockKey(config.connectionId);
    const acquired = await this.lockManager.acquire(
      lockKey,
      config.lockTimeout,
      config.lockMode || this.config.lockMode
    );
    if (!acquired) {
      throw new MigrationConflictError(
        `Failed to acquire advisory lock ${lockKey} (connectionId: ${config.connectionId}) within "${config.lockTimeout}". ` +
        `Another migration may be in progress on this database. ` +
        `To resolve: (1) wait for the running migration to complete, (2) terminate the conflicting backend ` +
        `(SELECT pg_terminate_backend(pid) FROM pg_locks WHERE objid = ${lockKey}), ` +
        `or (3) use a different connectionId.`,
        { code: '55P03', lockKey, connectionId: config.connectionId }
      );
    }
    this.emitProgress({ type: 'lock_acquired', lockKey, connectionId: config.connectionId });
  }

  /**
   * Release advisory lock
   */
  async releaseAdvisoryLock() {
    await this.lockManager.release().catch(() => {});
    this.emitProgress({ type: 'lock_released', lockKey: this.lockManager.lockId, connectionId: this.connectionId });
  }

  /**
   * Post-flight verification
   * @param {import('../types/migration.js').MigrationPlan} plan
   * @param {ExecutionConfig} config
   */
  async postflightVerify(plan, config) {
    if (this.snapshots.before && this.snapshots.after) {
      const drift = this.driftDetector.detect(
        this.snapshots.before,
        this.snapshots.after,
        { changes: this.executedSteps }
      );

      if (drift.detected) {
        const driftChanges = (drift.changes || []).map(c => c.objectKey || c.name || c).join(', ');
        throw new DriftDetectedError(
          `Schema drift detected during migration ${plan.id}: ${drift.changeCount || drift.changes?.length || 0} unexpected change(s)` +
          `${driftChanges ? `. Affected objects: ${driftChanges}` : ''}. ` +
          `This may indicate concurrent modifications to the database during migration. ` +
          `Review the drift and re-run introspection to reconcile.`,
          { drift }
        );
      }
    }
  }

  /**
   * Capture a snapshot of current database state
   * @returns {Promise<Object>}
   */
  async captureSnapshot() {
    const result = await this.pool.query(`
      SELECT
        c.oid,
        n.nspname as schema,
        c.relname as name,
        c.relkind as kind,
        md5(n.nspname || '.'::text || c.relname || '.'::text || c.relkind::text) as checksum
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND n.nspname NOT LIKE 'pg_temp_%'
      ORDER BY n.nspname, c.relname
    `);

    // Pre-migration drift detection (PreDriftDetector.compareSnapshots)
    // compares the stored snapshot_after against a full introspection in the
    // { tables, indexes, constraints, views, functions } format, while the
    // postflight detector uses the checksum lists. Store both.
    let fullSnapshot = null;
    try {
      fullSnapshot = await this.introspector.introspect();
    } catch (snapshotError) {
      console.warn(`[MigrationExecutor] Could not capture full schema snapshot: ${snapshotError.message}`);
    }

    return {
      timestamp: new Date().toISOString(),
      objectCount: result.rows.length,
      checksums: result.rows.map(r => ({
        schema: r.schema,
        name: r.name,
        kind: r.kind,
        checksum: r.checksum,
      })),
      ...(fullSnapshot || {}),
    };
  }

  /**
   * Verify that a DDL step was actually applied to the database.
   * Used for connection drop recovery to determine if COMMIT succeeded.
   * @param {Object} step - The step to verify
   * @returns {Promise<{applied: boolean, details: Object}>}
   */
  async verifyStepApplied(step) {
    const client = await this.pool.connect();
    try {
      const objectName = step.objectName || step.objectKey?.split('.').pop();
      const schemaName = step.schema || step.objectKey?.split('.')[0] || 'public';

      switch (step.objectType) {
        case 'table': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_schema = $1 AND table_name = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'table', name: objectName } };
        }
        
        case 'index': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_indexes
              WHERE schemaname = $1 AND indexname = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'index', name: objectName } };
        }
        
        case 'column': {
          const tableName = step.tableName || step.objectKey?.split('.')[1];
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
            )
          `, [schemaName, tableName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'column', table: tableName, name: objectName } };
        }
        
        case 'constraint': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_constraint
              WHERE connamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)
                AND conname = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'constraint', name: objectName } };
        }
        
        case 'function':
        case 'procedure': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = $1 AND p.proname = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: step.objectType, name: objectName } };
        }
        
        case 'trigger': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_trigger t
              JOIN pg_class c ON c.oid = t.tgrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE t.tgname = $1 AND n.nspname = $2
            )
          `, [objectName, schemaName]);
          return { applied: check.rows[0].exists, details: { type: 'trigger', name: objectName, schema: schemaName } };
        }
        
        case 'view': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.views
              WHERE table_schema = $1 AND table_name = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'view', name: objectName } };
        }
        
        case 'materializedView':
        case 'matview': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_matviews
              WHERE schemaname = $1 AND matviewname = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'materializedView', name: objectName } };
        }
        
        case 'sequence': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.sequences
              WHERE sequence_schema = $1 AND sequence_name = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'sequence', name: objectName } };
        }
        
        case 'policy': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_policies
              WHERE schemaname = $1 AND policyname = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'policy', name: objectName } };
        }
        
        case 'rule': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_rules
              WHERE schemaname = $1 AND rulename = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'rule', name: objectName } };
        }
        
        case 'extension': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_extension WHERE extname = $1
            )
          `, [objectName]);
          return { applied: check.rows[0].exists, details: { type: 'extension', name: objectName } };
        }
        
        case 'schema': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM information_schema.schemata WHERE schema_name = $1
            )
          `, [objectName]);
          return { applied: check.rows[0].exists, details: { type: 'schema', name: objectName } };
        }
        
        case 'domain': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_type t
              JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE n.nspname = $1 AND t.typname = $2 AND t.typtype = 'd'
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'domain', name: objectName } };
        }
        
        case 'type':
        case 'enum': {
          const check = await client.query(`
            SELECT EXISTS (
              SELECT FROM pg_type t
              JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE n.nspname = $1 AND t.typname = $2
            )
          `, [schemaName, objectName]);
          return { applied: check.rows[0].exists, details: { type: 'type', name: objectName } };
        }
        
        case 'enum_value': {
          const enumValueCheck = await this.verifyEnumValue(step);
          return enumValueCheck;
        }
        
        case 'partition': {
          const partitionCheck = await this.verifyPartitionState(step);
          return partitionCheck;
        }
        
        default:
          return { applied: false, details: { type: 'unknown', reason: 'Cannot verify this object type' } };
      }
    } finally {
      client.release();
    }
  }

  /**
   * Verify if an enum value was added (for ALTER TYPE ADD VALUE on PG14-15).
   * @param {Object} step - The step containing enum value details
   * @returns {Promise<{applied: boolean, details: Object}>}
   */
  async verifyEnumValue(step) {
    const client = await this.pool.connect();
    try {
      const typeName = step.typeName || step.objectName;
      const valueName = step.valueName || step.enumValue;
      const schemaName = step.schema || 'public';
      
      const check = await client.query(`
        SELECT EXISTS (
          SELECT FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = $1 
            AND t.typname = $2 
            AND e.enumlabel = $3
        )
      `, [schemaName, typeName, valueName]);
      
      return {
        applied: check.rows[0].exists,
        details: {
          type: 'enum_value',
          typeName,
          valueName,
          schema: schemaName,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Verify the state of a partition (for DETACH PARTITION CONCURRENTLY).
   * @param {Object} step - The step containing partition details
   * @returns {Promise<{applied: boolean, details: Object}>}
   */
  async verifyPartitionState(step) {
    const client = await this.pool.connect();
    try {
      const partitionName = step.partitionName || step.objectName;
      const parentTable = step.parentTable;
      const schemaName = step.schema || 'public';
      
      const check = await client.query(`
        SELECT 
          c.relname as name,
          c.relispartition as is_partition,
          CASE 
            WHEN c.relispartition THEN 'attached'
            ELSE 'detached'
          END as state,
          p.relname as parent_name
        FROM pg_class c
        LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
        LEFT JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
      `, [schemaName, partitionName]);
      
      if (check.rows.length === 0) {
        return {
          applied: false,
          details: {
            type: 'partition',
            name: partitionName,
            reason: 'Partition not found',
          },
        };
      }
      
      const row = check.rows[0];
      const expectedState = step.targetState || 'detached';
      const isApplied = expectedState === 'detached' ? !row.is_partition : row.is_partition;
      
      return {
        applied: isApplied,
        details: {
          type: 'partition',
          name: partitionName,
          currentState: row.state,
          expectedState,
          parentTable: row.parent_name,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Bookkeeping step types that carry no DDL and must never be verified
   * against the database (and never count towards applied/total).
   */
  static NON_DDL_STEP_TYPES = new Set([
    'pre_check', 'advisory_lock', 'snapshot', 'verify',
    'postflight', 'reconcile', 'heartbeat',
  ]);

  static isNonDdlStepType(type) {
    return !!type && MigrationExecutor.NON_DDL_STEP_TYPES.has(type);
  }

  /**
   * Recover from a connection drop by verifying the actual database state.
   * Call this when a connection error occurs after COMMIT was sent.
   *
   * Only DDL steps are verified; bookkeeping steps (pre_check, advisory_lock,
   * snapshot, verify, ...) are excluded from both the applied set and the
   * total, so `fully_applied` is reachable whenever every DDL step is present.
   * Verified results are recorded into the execution log as best-effort
   * recovery entries (status 'completed' when applied, 'skipped' when not).
   *
   * @param {Object} plan - The migration plan that was executing
   * @returns {Promise<{recovered: boolean, state: string, appliedSteps: Array, unverifiedSteps: Array}>}
   */
  async recoverFromConnectionDrop(plan) {
    this.emitProgress({
      type: 'connection_recovery_start',
      planId: plan.id,
      timestamp: new Date().toISOString(),
    });

    const ddlSteps = (plan.steps || []).filter(s => !MigrationExecutor.isNonDdlStepType(s.type));
    const appliedSteps = [];
    const unverifiedSteps = [];
    const verifiedAt = new Date();

    for (const step of ddlSteps) {
      try {
        const verification = await this.verifyStepApplied(step);
        if (verification.applied) {
          appliedSteps.push({
            stepId: step.id,
            objectType: step.objectType,
            objectKey: step.objectKey,
            verified: true,
          });
        }
        await this._recordRecoveryVerification(step, verification, verifiedAt);
      } catch (verifyError) {
        this.emitProgress({
          type: 'verification_error',
          stepId: step.id,
          error: verifyError.message,
        });
        unverifiedSteps.push({
          stepId: step.id,
          objectType: step.objectType,
          objectKey: step.objectKey,
          error: verifyError.message,
        });
      }
    }

    const totalSteps = ddlSteps.length;
    let state;
    if (unverifiedSteps.length > 0) {
      state = appliedSteps.length > 0 ? 'partially_applied' : 'unknown';
    } else if (totalSteps > 0 && appliedSteps.length === totalSteps) {
      state = 'fully_applied';
    } else if (appliedSteps.length > 0) {
      state = 'partially_applied';
    } else {
      state = 'not_applied';
    }

    this.emitProgress({
      type: 'connection_recovery_complete',
      planId: plan.id,
      state,
      appliedSteps: appliedSteps.length,
      totalSteps,
      unverifiedSteps: unverifiedSteps.length,
    });

    return {
      recovered: true,
      state,
      appliedSteps,
      unverifiedSteps,
      allApplied: totalSteps > 0 && unverifiedSteps.length === 0 && appliedSteps.length === totalSteps,
    };
  }

  /**
   * Record a connection-recovery verification into the execution log.
   * Best-effort: logging failures never break recovery.
   * @param {Object} step - The DDL step that was verified
   * @param {{applied: boolean, details: Object}} verification - Result of verifyStepApplied
   * @param {Date} verifiedAt - Shared recovery timestamp
   */
  async _recordRecoveryVerification(step, verification, verifiedAt) {
    const recordId = this.migrationRecord?.id || this.migrationRecord?.migration_id;
    if (!recordId || !this.storage?.executionLog?.logStep) return;

    try {
      await this.storage.executionLog.logStep({
        migrationId: recordId,
        stepId: step.id,
        phase: step.phase || 0,
        status: verification.applied ? 'completed' : 'skipped',
        sql: step.sql || '',
        startedAt: verifiedAt,
        completedAt: new Date(),
        isTransactional: step.isTransactional !== false,
        postCheckResult: {
          recoveryVerification: {
            applied: verification.applied,
            method: 'introspection',
            details: verification.details || null,
          },
        },
      });
    } catch (logError) {
      this.emitProgress({
        type: 'verification_log_error',
        stepId: step.id,
        error: logError.message,
      });
    }
  }

  /**
   * Check if an error is a connection-related error that warrants recovery.
   * @param {Error} error
   * @returns {boolean}
   */
  isConnectionError(error) {
    const connectionCodes = ['08001', '08003', '08004', '08006', '08007', '57P01'];
    const errorCode = error.code || '';
    return connectionCodes.includes(errorCode) ||
           error.code === 'ECONNRESET' ||
           error.code === 'ETIMEDOUT' ||
           error.message?.toLowerCase().includes('connection') ||
           error.message?.toLowerCase().includes('terminate');
  }

  /**
   * Handle execution failure
   * @param {Error} error
   * @param {import('../types/migration.js').MigrationPlan} plan
   * @returns {Promise<Object>}
   */
  async handleFailure(error, plan) {
    const executedPhaseNames = [...new Set(
      this.executedSteps.filter(s => s.status === 'completed').map(s => this.getPhaseName(s.phase))
    )];

    const nonTransactionalExecuted = this.executedSteps.filter(
      s => s.status === 'completed' && s.isTransactional === false
    );

    // Undo SQL for executed non-transactional steps (reverse execution order)
    // plus best-effort rollback SQL for executed changes' committed DDL.
    const recoverySQL = this.buildRecoverySQL(nonTransactionalExecuted);
    const rollbackSQL = this.buildRollbackSQL(plan);

    let connectionRecovery = null;
    if (this.isConnectionError(error)) {
      this.emitProgress({
        type: 'connection_error_detected',
        error: error.message,
        code: error.code,
        attemptingRecovery: true,
      });
      
      try {
        connectionRecovery = await this.recoverFromConnectionDrop(plan);
        
        if (connectionRecovery.state === 'fully_applied') {
          if (this.migrationRecord?.id) {
            await this.storage.updateRecord(this.migrationRecord.id, {
              status: 'COMPLETED',
              completed_at: new Date().toISOString(),
              connection_recovery: connectionRecovery,
            });
          }
          await this.releaseAdvisoryLock();
          return {
            state: 'recovered_committed',
            originalError: error.message,
            connectionRecovery,
            executedPhases: executedPhaseNames,
          };
        }
      } catch (recoveryError) {
        this.emitProgress({
          type: 'connection_recovery_failed',
          error: recoveryError.message,
        });
        connectionRecovery = { state: 'recovery_failed', error: recoveryError.message };
      }
    }

    if (this.migrationRecord?.id) {
      await this.storage.failRecord(
        this.migrationRecord.id,
        error,
        this.executedSteps
      );
    }

    await this.releaseAdvisoryLock();

    return {
      state: 'failed',
      error: error.message,
      executedPhases: executedPhaseNames,
      nonTransactionalExecuted: nonTransactionalExecuted.map(s => ({
        stepId: s.stepId,
        sql: s.sql,
      })),
      rollbackStatus: nonTransactionalExecuted.length > 0 ? 'PARTIAL' : 'FULL',
      manualRecoveryRequired: nonTransactionalExecuted.length > 0,
      recoverySQL,
      rollbackSQL,
      connectionRecovery,
    };
  }

  /**
   * Build undo SQL for executed non-transactional steps, in reverse execution
   * order so later objects are dropped before the objects that depend on them.
   * Sources: planner-provided recoverySql, CIC detection, and the non-tx queue's
   * prepared rollback SQL (undoSql/rollbackSql). Deduplicated by step id.
   * @param {Array<Object>} executedNonTxSteps - Completed non-tx executed steps
   * @returns {Array<{stepId: string, sql: string}>}
   */
  buildRecoverySQL(executedNonTxSteps) {
    const byStep = new Map();

    for (const step of executedNonTxSteps) {
      const undo = step.recoverySql || this.generateUndoSQL(step);
      if (undo) byStep.set(step.stepId || step.id, undo);
    }

    for (const item of this._nonTxQueue.generateRollbackSQL()) {
      if (!byStep.has(item.stepId)) byStep.set(item.stepId, item.sql);
    }

    return [...byStep.entries()].reverse().map(([stepId, sql]) => ({ stepId, sql }));
  }

  /**
   * Build best-effort rollback SQL for executed steps' changes via the
   * RollbackGenerator, in reverse change order. Only changes that map to a
   * completed executed step (via changeId) are included; changes that were
   * never attempted are left alone.
   * @param {import('../types/migration.js').MigrationPlan} plan
   * @returns {Array<{changeId: string, changeType: string, objectKey: string, sql: string, isTransactional: boolean}>}
   */
  buildRollbackSQL(plan) {
    const changes = plan.diff?.changes || plan.changes || [];
    if (changes.length === 0) return [];

    const executedChangeIds = new Set(
      this.executedSteps
        .filter(s => s.status === 'completed' && s.changeId)
        .map(s => s.changeId)
    );
    if (executedChangeIds.size === 0) return [];

    const rollbackGenerator = new RollbackGenerator({
      pgVersion: this.pgVersion ? parseFloat(this.pgVersion) : null,
    });

    const steps = [];
    for (const change of [...changes].reverse()) {
      if (!executedChangeIds.has(change.id)) continue;
      try {
        const undo = rollbackGenerator.generateUndoForChange(change);
        if (undo) {
          steps.push({
            changeId: change.id,
            changeType: change.changeType,
            objectKey: change.objectKey || change.path,
            sql: undo,
            isTransactional: !rollbackGenerator.isNonTransactionalRollback(change, undo),
          });
        }
      } catch (rollbackError) {
        steps.push({
          changeId: change.id,
          changeType: change.changeType,
          objectKey: change.objectKey || change.path,
          sql: `-- CANNOT AUTO-ROLLBACK: ${rollbackError.message}`,
          isTransactional: true,
        });
      }
    }
    return steps;
  }

  /**
   * Generate undo SQL for an executed step
   * @param {Object} executedStep
   * @returns {string|null}
   */
  generateUndoSQL(executedStep) {
    const sql = executedStep.sql?.toUpperCase().trim();
    if (!sql) return null;

    if (sql.startsWith('CREATE INDEX CONCURRENTLY')) {
      const match = executedStep.sql.match(/CREATE INDEX CONCURRENTLY\s+(?:IF NOT EXISTS\s+)?(?:(\w+)\.)?(\w+)/i);
      if (match) {
        return `DROP INDEX IF EXISTS ${match[1] ? match[1] + '.' : ''}${match[2]}`;
      }
    }

    return null;
  }

  /**
   * Complete the migration record
   */
  async completeMigrationRecord() {
    const recordId = this.migrationRecord?.id || this.migrationRecord?.migration_id;
    if (recordId) {
      await this.storage.completeRecord(
        recordId,
        {
          status: this.finalResultStatus || 'completed',
          duration: this.executedSteps.reduce((sum, s) => sum + (s.duration || 0), 0),
          snapshotBefore: this.snapshots.before,
          snapshotAfter: this.snapshots.after,
          executionResults: this.executedSteps,
          changeCount: this.executedSteps.filter(s => s.status === 'completed').length,
        }
      );
    }
  }

  /**
   * Refresh the DB heartbeat while phases are executing so the stale
   * detector (recovery/crash-recovery.js) can distinguish a live run
   * from a crashed one.
   *
   * @param {{ phase: number, stepId?: string }} [details]
   */
  async updateHeartbeat(details = {}) {
    const recordId = this.migrationRecord?.id || this.migrationRecord?.migration_id;
    if (!recordId) return;
    try {
      await this.storage.updateHeartbeat(recordId, {
        phase: details.phase,
        stepId: details.stepId,
      });
    } catch (error) {
      console.warn(`[MigrationExecutor] Heartbeat update failed: ${error.message}`);
    }
  }

  /**
   * Best-effort write to migration_execution_log. Logging must never break
   * the migration, so all failures are swallowed with a warning.
   *
   * @param {Object} entry - See ExecutionLog.logStep()
   */
  async _logStep(entry) {
    if (!this.storage?.executionLog) return;
    const migrationId = this.migrationRecord?.id || this.migrationRecord?.migration_id;
    if (!migrationId) return;
    try {
      await this.storage.executionLog.logStep({ migrationId, ...entry });
    } catch (error) {
      console.warn(`[MigrationExecutor] Execution log write failed: ${error.message}`);
    }
  }

  /**
   * Build execution result
   * @param {import('../types/migration.js').MigrationPlan} plan
   * @param {string} status
   * @param {number} startTime
   * @param {Object} [resultObj]
   * @returns {import('../types/migration.js').MigrationResult}
   */
  buildResult(plan, status, startTime, resultObj = {}) {
    const completed = this.executedSteps.filter(s => s.status === 'completed');
    const failed = this.executedSteps.filter(s => s.status === 'failed');

    return {
      success: resultObj.success !== undefined ? resultObj.success : (status === 'completed' && failed.length === 0),
      migrationId: resultObj.migrationId || this.migrationRecord?.migration_id || plan.id,
      status: resultObj.status || status,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      stepsCompleted: resultObj.stepsCompleted ?? completed.length,
      stepsSkipped: resultObj.stepsSkipped ?? 0,
      stepsTotal: plan.steps?.length || 0,
      stepsFailed: resultObj.stepsFailed ?? failed.length,
      changesApplied: completed.length,
      snapshots: {
        before: this.snapshots.before?.objectCount || 0,
        after: this.snapshots.after?.objectCount || 0,
      },
      executedSteps: this.executedSteps,
      warnings: resultObj.warnings || [],
      errors: resultObj.errors?.length > 0 ? resultObj.errors : failed.map(s => ({
        step: s.stepId,
        sql: s.sql,
        message: s.error,
        code: s.errorCode,
        subStatementIndex: s.subStatementIndex,
        subStatementSql: s.subStatementSql,
        isNonTransactional: s.isTransactional === false,
        recoveryHint: s.recoveryHint,
      })),
      intents: resultObj.intents || [],
      state: {
        name: this.state,
        executedPhaseCount: [...new Set(this.executedSteps.map(s => s.phase))].length,
        failed: failed.length > 0,
      },
      pgVersion: this.pgVersion,
    };
  }

  /**
   * Get phase name from number
   * @param {number} phase
   * @returns {string}
   */
  getPhaseName(phase) {
    const phases = {
      1: 'pre_check',
      2: 'advisory_lock',
      3: 'extensions',
      4: 'types',
      5: 'schemas',
      6: 'tables_create',
      7: 'columns_add',
      8: 'sequences',
      9: 'indexes_create',
      10: 'constraints_non_fk',
      11: 'data_migration',
      12: 'constraints_fk',
      13: 'validate_constraints',
      14: 'views',
      15: 'materialized_views',
      16: 'functions',
      17: 'triggers',
      18: 'policies',
      19: 'rules',
      20: 'behavioral_other',
      21: 'grants',
      22: 'comments',
      23: 'indexes_concurrent',
      24: 'cleanup',
      25: 'post_check',
      26: 'snapshot',
    };
    return phases[phase] || `phase_${phase}`;
  }

  /**
   * Subscribe to progress events
   * @param {Function} listener
   * @returns {Function} Unsubscribe function
   */
  onProgress(listener) {
    return this.progressTracker.subscribe(listener);
  }

  /**
   * Emit progress event
   * @param {Object} event
   */
  emitProgress(event) {
    this.progressTracker.emit({
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
      state: this.state,
      executedStepCount: this.executedSteps.length,
    });
  }

  /**
   * Dry run a migration plan
   * @param {import('../types/migration.js').MigrationPlan} plan
   * @param {import('../types/execution.js').ExecutionOptions} [options]
   * @returns {Promise<import('../types/migration.js').MigrationResult>}
   */
  async dryRun(plan, options = {}) {
    return this.execute(plan, { ...options, dryRun: true });
  }

  /**
   * Manually trigger reconciliation for a connection
   * @param {string} [connectionId] - Connection ID to reconcile (defaults to this.connectionId)
   * @returns {Promise<Object>} Reconciliation results
   */
  async reconcile(connectionId) {
    const cid = connectionId || this.connectionId;
    if (!cid) {
      throw new Error('Cannot reconcile without connectionId');
    }
    return await this.crashRecovery.reconcile(cid);
  }

  /**
   * Check for incomplete migrations without reconciling
   * @param {string} [connectionId]
   * @returns {Promise<Array>} List of running migrations
   */
  async getIncompleteMigrations(connectionId) {
    const cid = connectionId || this.connectionId;
    if (!cid) {
      return [];
    }
    return await this.storage.getByStatus(cid, 'running');
  }
}
