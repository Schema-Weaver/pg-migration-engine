/**
 * Schema Weaver Migration Engine - Core
 * https://schemaweaver.vivekmind.com/
 */
import crypto from 'crypto';
import { SchemaIntrospector } from './introspection/index.js';
import { SchemaDiffer } from './differ/index.js';
import { ReverseDependencyIntrospector } from './differ/reverse-dependency-introspector.js';
import { MigrationPlanner } from './planner/index.js';
import { MigrationExecutor } from './executor/migration-executor.js';
import { TransactionManager } from './executor/transaction-manager.js';
import { MigrationTable } from './storage/migration-table.js';
import { RollbackGenerator } from './storage/rollback-generator.js';
import { ExecutionLog } from './storage/execution-log.js';
import { BehavioralExtractor } from './behavioral/behavioral-extractor.js';
import { BehavioralApplier } from './behavioral/behavioral-applier.js';
import { DdlGenerator } from './ddl-generator/index.js';
import { RiskEngine } from './risk/index.js';
import { InMemoryStorageProvider } from './storage/index.js';
import { CrashRecovery } from './recovery/index.js';
import { MigrationStateMachine, ACTIVE_STATUSES } from './state-machine/index.js';
import {
  MigrationError,
  ExecutionError,
  IntrospectionError,
  DiffError,
  DDLGenerationError,
  PreCheckFailedError,
  PostCheckFailedError,
  MigrationConflictError,
  VersionIncompatibilityError,
  RollbackError,
  DriftDetectedError,
  LockAcquisitionError,
  TimeoutError,
  ValidationError,
  StorageError,
  PlanBlockedError,
  RecoveryError,
  DestructiveChangeError,
} from './errors.js';

export {
  DestructiveWarningIntegrator,
  ExecutorWarningPrompt,
  CliWarningDisplay,
  CloneDryRunner,
  DestructiveChangeClassifier,
  DataImpactAnalyzer,
  DataSampler,
  WarningFormatter,
} from './warnings/index.js';

export {
  normalizeSchema,
  normalizeColumn,
  normalizeIndex,
  validateSchemaFormat,
} from './validation/index.js';


export {
  SchemaIntrospector,
  SchemaDiffer,
  DdlGenerator,
  RiskEngine,
  MigrationPlanner,
  MigrationExecutor,
  BehavioralExtractor,
  BehavioralApplier,
  TransactionManager,
  MigrationTable,
  RollbackGenerator,
  InMemoryStorageProvider,
  CrashRecovery,
  MigrationStateMachine,
  ExecutionLog,
  ReverseDependencyIntrospector,
  ACTIVE_STATUSES,
  MigrationError,
  ExecutionError,
  IntrospectionError,
  DiffError,
  DDLGenerationError,
  PreCheckFailedError,
  PostCheckFailedError,
  MigrationConflictError,
  VersionIncompatibilityError,
  RollbackError,
  DriftDetectedError,
  LockAcquisitionError,
  TimeoutError,
  ValidationError,
  StorageError,
  PlanBlockedError,
  RecoveryError,
  DestructiveChangeError,
  MIGRATION_STATUS,
  DB_STATUS,
};

import { RISK_LEVELS, RISK_LEVEL_ORDER, mapExecutorStatusToDb, MIGRATION_STATUS, DB_STATUS } from './constants.js';

/**
 * @typedef {Object} EngineConfig
 * @property {string} [engineVersion='1.0.0']
 * @property {string} [lockTimeout='5s'] - Lock wait timeout (lock_timeout)
 * @property {'blocking'|'try'|'queue'} [lockMode='blocking'] - Lock acquisition mode:
 *   'blocking' waits up to lockTimeout, 'try' fails immediately, 'queue' uses a
 *   FIFO per-connectionId queue before acquiring
 * @property {'database'|'application'} [heartbeatMethod='database'] - Lock heartbeat
 *   verification: 'database' queries pg_locks (detects silent connection loss),
 *   'application' uses the fast in-memory check
 * @property {string} [lockStatementTimeout='15s'] - Timeout for the advisory-lock
 *   query itself; statement_timeout is set to this while acquiring the lock and
 *   reset to statementTimeout for the DDL steps afterwards
 * @property {string} [statementTimeout='30s']
 * @property {number} [checkpointInterval=0] - Persist an execution checkpoint
 *   every N completed steps (0 disables checkpointing)
 * @property {boolean} [dryRun=false]
 * @property {boolean} [snapshotBefore=true]
 * @property {boolean} [verifyAfter=true]
 * @property {string} [connectionId] - Database connection ID for multi-DB support
 * @property {'none'|'low'|'medium'|'high'|'critical'} [allowRiskBelow] - Only allow migrations below this risk level
 * @property {boolean} [acceptDataLoss=false] - Auto-approve destructive changes without prompting
 * @property {boolean} [warningsEnabled=true] - Enable/disable destructive change warnings
 * @property {boolean} [interactive=true] - Enable interactive prompts (set false for CI/CD)
 * @property {boolean} [cloneDryRun=false] - Enable clone dry-run before execution (tests DDL on ephemeral schema with copied data)
 */

export class SwMigrationEngine {
  /**
   * @param {EngineConfig} config
   */
  constructor(config = {}) {
    this.config = {
      engineVersion: '1.0.0',
      lockTimeout: '5s',
      lockStatementTimeout: '15s',
      statementTimeout: '30s',
      checkpointInterval: 0,
      dryRun: false,
      snapshotBefore: true,
      verifyAfter: true,
      connectionId: config.connectionId || null,
      allowRiskBelow: 'critical',
      acceptDataLoss: false,
      warningsEnabled: true,
      interactive: true,
      ...config,
    };

    if (!this.config.connectionId) {
      this.config.connectionId = `default-${crypto.randomUUID().slice(0, 8)}`;
      console.warn(
        '[SwMigrationEngine] No connectionId provided. ' +
        `Auto-generated: "${this.config.connectionId}". ` +
        'Set connectionId explicitly for multi-database support.'
      );
    }

    this.pool = null;
    this.introspector = null;
    this.differ = new SchemaDiffer();
    this.planner = new MigrationPlanner();
    this.riskEngine = new RiskEngine();
    this.ddlGenerator = new DdlGenerator();
    this.behavioralExtractor = new BehavioralExtractor();
    this.behavioralApplier = new BehavioralApplier();
    this.rollbackGenerator = new RollbackGenerator();
  }

  /**
   * Set the database pool
   * @param {import('pg').Pool} pool
   */
  setPool(pool) {
    this.pool = pool;
    this.introspector = new SchemaIntrospector(pool);
  }

  /**
   * STEP 1: Introspect a live database
   * @param {import('pg').Pool} [pool]
   * @param {Object} [options]
   * @returns {Promise<import('./types/schema.js').SchemaSnapshot>}
   */
  async introspect(pool, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new IntrospectionError('Database pool is required. Call setPool() or pass pool to introspect().');
    }

    this.introspector = new SchemaIntrospector(usePool);
    return this.introspector.introspect(options);
  }

  /**
   * STEP 2: Diff two schema snapshots
   * @param {import('./types/schema.js').SchemaSnapshot} desired - Target schema
   * @param {import('./types/schema.js').SchemaSnapshot} current - Current schema
   * @returns {import('./types/changes.js').SchemaDiff}
   */
  diff(desired, current) {
    return this.differ.diff(desired, current);
  }

  /**
   * STEP 3: Generate DDL from a diff
   * @param {import('./types/changes.js').SchemaDiff} diff
   * @param {Object} [options]
   * @returns {string}
   */
  generateDDL(diff, options = {}) {
    const changes = Array.isArray(diff) ? diff : (diff.changes || []);
    return this.ddlGenerator.generate(changes, options);
  }

  /**
   * STEP 3.5: Expand a change set with implicit DROP changes for reverse
   * dependents (Layer 4). Queries the live database catalogs to find objects
   * depending on DROP targets and returns the expanded list.
   *
   * @param {import('pg').Pool} [pool]
   * @param {Array<Object>} changes - SchemaDiff changes
   * @param {Object} [options] - See ReverseDependencyIntrospector.expandDropChanges
   * @returns {Promise<{changes: Array, additions: Array, warnings: Array, assessments: Array}>}
   */
  async expandDropDependencies(pool, changes, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const introspector = new ReverseDependencyIntrospector(usePool);
    return introspector.expandDropChanges(changes, options);
  }

  /**
   * STEP 4: Create a migration plan from a diff
   * @param {import('./types/changes.js').SchemaDiff} diff
   * @param {Object} [options]
   * @returns {import('./types/migration.js').MigrationPlan}
   */
  plan(diff, options = {}) {
    const plan = this.planner.createPlan(diff, {
      ...options,
      pgVersion: options.pgVersion,
    });

    const riskAssessment = this.riskEngine.assess(plan.changes || [], options.pgVersion);
    plan.riskAssessment = riskAssessment;

    const riskOrder = ['none', 'low', 'medium', 'high', 'critical'];
    const maxAllowedIdx = riskOrder.indexOf(this.config.allowRiskBelow);
    const hasCritical = (plan.summary?.riskSummary?.critical || 0) > 0;
    const hasHigh = (plan.summary?.riskSummary?.high || 0) > 0;

    if (hasCritical && maxAllowedIdx < riskOrder.indexOf('critical')) {
      plan.blocked = true;
      plan.blockReason = `Migration blocked: ${plan.summary.riskSummary.critical} critical risk(s) detected.`;
    } else if (hasHigh && maxAllowedIdx < riskOrder.indexOf('high')) {
      plan.blocked = true;
      plan.blockReason = `Migration blocked: ${plan.summary.riskSummary.high} high risk(s) detected.`;
    }

    return plan;
  }

  /**
   * STEP 5: Execute a migration plan
   * @param {import('pg').Pool} [pool]
   * @param {import('./types/migration.js').MigrationPlan} plan
   * @param {import('./types/execution.js').ExecutionOptions} [options]
   * @returns {Promise<import('./types/migration.js').MigrationResult>}
   */
  async execute(pool, plan, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new ExecutionError('Database pool is required. Call setPool() or pass pool to execute().');
    }

    if (plan.blocked && !options.allowBlocked) {
      throw new PlanBlockedError(plan.blockReason || 'Migration is blocked', { plan });
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    if (!connectionId) {
      console.warn(
        '[SwMigrationEngine] No connectionId for execute(). ' +
        'Migration records will not be scoped to a database.'
      );
    }

    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();

    const introspector = new SchemaIntrospector(usePool);
    const executor = new MigrationExecutor(usePool, introspector, storage, {
      ...this.config,
      ...options,
      connectionId,
    });

    if (options.onProgress) {
      executor.onProgress(options.onProgress);
    }

    return executor.execute(plan, options);
  }

  /**
   * Dry-run a migration — validates SQL without applying changes
   * @param {import('pg').Pool} [pool]
   * @param {import('./types/migration.js').MigrationPlan} plan
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async dryRun(pool, plan, options = {}) {
    return this.execute(pool, plan, { ...options, dryRun: true });
  }

  /**
   * ONE-SHOT: Introspect → Diff → Plan → Execute
   * Convenience method for the full pipeline
   * @param {import('pg').Pool} [pool]
   * @param {import('./types/schema.js').SchemaSnapshot} desired - Target schema
   * @param {Object} [options]
   * @returns {Promise<import('./types/migration.js').MigrationResult>}
   */
  async migrate(pool, desired, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new ExecutionError('Database pool is required. Call setPool() or pass pool to migrate().');
    }

    if (desired === null || desired === undefined) {
      throw new ValidationError(
        'Schema (desired) is required and cannot be null or undefined. ' +
        'Provide a valid schema object with at least: { tables: { ... } }'
      );
    }

    if (typeof desired !== 'object' || Array.isArray(desired)) {
      throw new ValidationError(
        `Schema must be an object, got ${Array.isArray(desired) ? 'array' : typeof desired}. ` +
        'Expected format: { tables: { "public.tablename": { ... } } }'
      );
    }

    const { normalizeSchema } = await import('./validation/schema-normalizer.js');
    let normalizedSchema = desired;
    try {
      normalizedSchema = normalizeSchema(desired);
    } catch (normError) {
      throw new ValidationError(`Schema normalization failed: ${normError.message}`);
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    if (!connectionId) {
      console.warn(
        '[SwMigrationEngine] No connectionId for migrate(). ' +
        'Migration records will not be scoped to a database.'
      );
    }

    const current = await this.introspect(usePool, options);

    if (current.checksum === normalizedSchema.checksum) {
      return {
        success: true,
        status: 'no_changes',
        migrationId: null,
        message: 'No schema changes detected.',
        diff: { summary: { totalChanges: 0 }, changes: [] },
        executedSteps: [],
      };
    }

    const diff = this.diff(normalizedSchema, current);

    if (diff.summary.totalChanges === 0) {
      return {
        success: true,
        status: 'no_changes',
        migrationId: null,
        message: 'No schema changes detected.',
        diff,
        executedSteps: [],
      };
    }

    // Layer 4: expand DROP changes with reverse dependents from the live
    // catalog (FKs pointing at dropped tables, views on dropped tables,
    // indexes/constraints on dropped columns, domains on dropped types, ...)
    if (usePool && options.expandDropDependencies !== false) {
      const introspector = new ReverseDependencyIntrospector(usePool);
      const expanded = await introspector.expandDropChanges(diff.changes, options);
      if (expanded.additions.length > 0 || expanded.warnings.length > 0) {
        diff.changes = expanded.changes;
        diff.warnings = [...diff.warnings, ...expanded.warnings];
        diff.summary.totalChanges = diff.changes.length;
        diff.summary.drops = diff.changes.filter(c => c.changeType === 'DROP').length;
        diff.dependencyExpansion = {
          added: expanded.additions.length,
          additions: expanded.additions.map(a => ({ objectType: a.objectType, objectKey: a.objectKey, implicitDependencyOf: a.implicitDependencyOf })),
        };
      }
    }

    const plan = this.plan(diff, options);

    if (plan.blocked) {
      return {
        success: false,
        status: 'blocked',
        migrationId: null,
        message: plan.blockReason,
        plan,
        diff,
        executedSteps: [],
      };
    }

    const execOptions = { ...options, connectionId };
    const acceptDataLoss = options.acceptDataLoss || this.config.acceptDataLoss;
    const warningsEnabled = options.warningsEnabled !== undefined ? options.warningsEnabled : this.config.warningsEnabled;
    const interactive = options.interactive !== undefined ? options.interactive : this.config.interactive;

    if (options.dryRun) {
      const dryRunResult = await this.dryRun(usePool, plan, execOptions);
      return {
        ...dryRunResult,
        status: 'dry_run',
        plan,
        diff,
      };
    }

    if (warningsEnabled) {
      const { DestructiveWarningIntegrator } = await import(
        './warnings/planner-warning-integration.js'
      );
      const { ExecutorWarningPrompt } = await import(
        './warnings/executor-warning-prompt.js'
      );
      const { CliWarningDisplay } = await import(
        './warnings/cli-warning-display.js'
      );

      const integrator = new DestructiveWarningIntegrator();
      integrator.setPool(usePool);
      const report = await integrator.generateWarningReport(plan, options);

      const prompt = new ExecutorWarningPrompt({
        acceptDataLoss,
        force: options.force || false,
        dryRun: false,
        interactive,
        outputStream: process.stdout,
      });

      if (report.hasDestructiveChanges) {
        const display = new CliWarningDisplay();
        if (acceptDataLoss) {
          display.outputStream.write(display.formatAutoProceed(report) + '\n');
        } else {
          display.outputStream.write(display.formatReport(report, options) + '\n');
        }

        const resolution = await prompt.resolve(report);
        if (!resolution.proceed) {
          if (!acceptDataLoss && !options.force) {
            const display2 = new CliWarningDisplay();
            display2.outputStream.write(display2.formatCancelled() + '\n');
          }
          return {
            success: false,
            status: 'cancelled',
            message: resolution.message,
            warningReport: report,
            plan,
            diff,
            executedSteps: [],
          };
        }

        execOptions.warningReport = report;
        execOptions.warningsAcknowledged = resolution.acknowledged;
        execOptions.dataLossAcknowledged = resolution.acknowledged.some(w => w.level === 'data_loss');
      }
    }

    if (options.cloneDryRun || this.config.cloneDryRun) {
      const { CloneDryRunner } = await import(
        './warnings/clone-dry-runner.js'
      );
      const runner = new CloneDryRunner(usePool);
      try {
        const cloneReport = await runner.run(plan, execOptions);
        execOptions.cloneReport = cloneReport;
        if (!cloneReport.safeToProceed) {
          return {
            success: false,
            status: 'clone_dry_run_failed',
            message: `Clone dry-run failed: ${cloneReport.errors.map(e => e.detail).join('; ')}`,
            cloneReport,
            plan,
            diff,
            executedSteps: [],
          };
        }
      } finally {
        await runner.cleanup();
      }
    }

    // Attach the diff to the plan so the migration record stores the full
    // schema_diff (used by generateRollbackSQL / _buildRollbackSteps) and the
    // executor can build rollback SQL for executed changes.
    if (plan && !plan.diff && diff) {
      plan.diff = diff;
    }

    const result = await this.execute(usePool, plan, execOptions);
    return {
      ...result,
      plan,
      diff,
      warningReport: result.warningReport || null,
      cloneReport: execOptions.cloneReport || null,
    };
  }

  /**
   * Get migration history
   * @param {import('pg').Pool} [pool]
   * @param {Object} [options]
   * @returns {Promise<Array>}
   */
  async getHistory(pool, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();
    return storage.getHistory(connectionId, options.limit || 50, options.offset || 0);
  }

  /**
   * Get full execution trace for a migration from migration_execution_log.
   * @param {import('pg').Pool} [pool]
   * @param {string} migrationId
   * @returns {Promise<Array>}
   */
  async getExecutionTrace(pool, migrationId) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const storage = new MigrationTable(usePool, this.config.connectionId || null);
    await storage.ensureTable();
    return storage.getExecutionTrace(migrationId);
  }

  /**
   * Get step-level summary (grouped by step) for a migration.
   * @param {import('pg').Pool} [pool]
   * @param {string} migrationId
   * @returns {Promise<Array>}
   */
  async getExecutionStepSummary(pool, migrationId) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const storage = new MigrationTable(usePool, this.config.connectionId || null);
    await storage.ensureTable();
    return storage.getExecutionStepSummary(migrationId);
  }

  /**
   * Get last successful migration
   * @param {import('pg').Pool} [pool]
   * @param {Object} [options]
   * @returns {Promise<Object|null>}
   */
  async getLastMigration(pool, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();
    return storage.getLastMigration(connectionId);
  }

  /**
   * Rollback a migration (best-effort).
   *
   * Valid source states: completed, partially_applied, failed. For
   * partially_applied/failed migrations only changes that were actually
   * executed (per execution_results.executedSteps) are rolled back.
   *
   * Lifecycle: <source> -> rolling_back -> rolled_back (success) or
   * <source> -> rolling_back -> failed (a rollback step failed). Every
   * rollback step is recorded into the execution log.
   *
   * @param {import('pg').Pool} [pool]
   * @param {string} migrationId
   * @param {Object} [options]
   * @param {string} [options.rolledBackBy] - User/system that triggered the rollback
   * @returns {Promise<Object>}
   */
  async rollback(pool, migrationId, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();

    const migration = await storage.getRollbackSQL(migrationId);
    if (!migration) {
      throw new RollbackError(`Migration ${migrationId} not found.`);
    }

    const rollbackable = ['completed', 'partially_applied', 'failed'];
    if (!rollbackable.includes(migration.status)) {
      throw new RollbackError(
        `Cannot rollback migration with status "${migration.status}". ` +
        `Rollback is only valid from ${rollbackable.join(', ')}.`
      );
    }

    const rollbackSteps = this._buildRollbackSteps(migration);

    if (rollbackSteps.length === 0) {
      return {
        success: false,
        migrationId,
        status: 'no_rollback_available',
        message: 'No rollback steps could be generated for this migration.',
      };
    }

    for (const step of rollbackSteps) {
      if (!step.isTransactional) {
        step.warning = 'This step runs outside a transaction and cannot be rolled back.';
      }
    }

    // Enter rolling_back (valid from completed/partially_applied/failed).
    await storage.stateMachine.transition(migrationId, 'rolling_back', {
      reason: 'engine_rollback',
      rolled_back_by: options.rolledBackBy || null,
    }).catch((error) => {
      console.warn(`[Engine] Failed to transition ${migrationId} to rolling_back: ${error.message}`);
    });

    const transactional = rollbackSteps.filter(s => s.isTransactional);
    const nonTransactional = rollbackSteps.filter(s => !s.isTransactional);

    const results = [];
    const logStep = async (step, result) => {
      if (!storage.executionLog?.logStep) return;
      try {
        await storage.executionLog.logStep({
          migrationId,
          stepId: `rb_${String(step.originalChangeId || 'unknown').slice(0, 90)}`,
          phase: 0,
          status: result.success ? 'completed' : 'failed',
          sql: step.sql,
          isTransactional: step.isTransactional,
          errorCode: result.code || null,
          errorMessage: result.error || null,
          postCheckResult: { rollback: true, changeId: step.originalChangeId },
        });
      } catch (logError) {
        // Best-effort: rollback logging must never break the rollback.
      }
    };

    if (transactional.length > 0) {
      try {
        const tm = new TransactionManager(usePool);
        const txResults = await tm.executeTransactional(
          transactional.map(s => ({ id: s.originalChangeId, sql: s.sql })),
          {
            lockTimeout: options.lockTimeout || this.config.lockTimeout,
            statementTimeout: options.statementTimeout || this.config.statementTimeout,
            continueOnError: true,
          }
        );
        for (let i = 0; i < txResults.length; i++) {
          const step = transactional[i];
          const r = txResults[i];
          results.push({ ...r, changeType: step.changeType, objectKey: step.objectKey, isTransactional: true });
          await logStep(step, r);
        }
      } catch (txError) {
        results.push({
          stepId: 'tx_batch',
          success: false,
          error: txError.message,
          code: txError.code,
          isTransactional: true,
          changeType: 'BATCH',
          objectKey: null,
        });
      }
    }

    for (let i = 0; i < nonTransactional.length; i++) {
      const step = nonTransactional[i];
      try {
        const tm = new TransactionManager(usePool);
        const r = await tm.executeNonTransactional(
          { id: step.originalChangeId, sql: step.sql },
          { statementTimeout: options.statementTimeout || this.config.statementTimeout }
        );
        results.push({ ...r, changeType: step.changeType, objectKey: step.objectKey, isTransactional: false });
        await logStep(step, r);
      } catch (stepError) {
        const r = {
          stepId: step.originalChangeId,
          success: false,
          error: stepError.message,
          code: stepError.code,
          isTransactional: false,
          changeType: step.changeType,
          objectKey: step.objectKey,
        };
        results.push(r);
        await logStep(step, r);
      }
    }

    const failedResults = results.filter(r => !r.success);
    const success = failedResults.length === 0;

    if (success) {
      await storage.markRolledBack(migrationId, options.rolledBackBy || null);
    } else {
      await storage.stateMachine.transition(migrationId, 'failed', {
        reason: 'rollback_failed',
        rolled_back_by: options.rolledBackBy || null,
        failedStepCount: failedResults.length,
      }).catch((error) => {
        console.warn(`[Engine] Failed to mark ${migrationId} as failed after rollback error: ${error.message}`);
      });
    }

    return {
      success,
      migrationId,
      status: success ? 'rolled_back' : 'failed',
      steps: results,
      rollbackStatus: nonTransactional.length > 0 ? 'PARTIAL' : 'FULL',
      manualRecoveryRequired: nonTransactional.length > 0,
      failedSteps: failedResults.map(r => ({
        stepId: r.stepId,
        error: r.error,
        code: r.code,
      })),
      warning: 'Rollback is best-effort. Some changes (DROP TABLE, DROP COLUMN, enum value removal) cannot be reversed.',
    };
  }

  /**
   * Build best-effort rollback steps for a migration record.
   * Completed migrations roll back every change in reverse order; failed /
   * partially_applied migrations only roll back changes whose steps were
   * recorded as executed (execution_results.executedSteps changeIds).
   * @param {Object} migration - Record from getRollbackSQL
   * @returns {Array<{sql: string, originalChangeId: string, changeType: string, objectKey: string, isTransactional: boolean}>}
   */
  _buildRollbackSteps(migration) {
    const diff = migration.schema_diff || migration.diff;
    let changes = diff?.changes || [];

    if (migration.status !== 'completed') {
      const executedChangeIds = new Set(
        (migration.execution_results?.executedSteps || [])
          .filter(s => s.status === 'completed' && s.changeId)
          .map(s => s.changeId)
      );
      if (executedChangeIds.size === 0) {
        return [];
      }
      changes = changes.filter(c => executedChangeIds.has(c.id));
    }

    const steps = [];
    for (const change of [...changes].reverse()) {
      const undo = this.rollbackGenerator.generateUndoForChange(change);
      if (!undo) continue;
      steps.push({
        sql: undo,
        originalChangeId: change.id,
        changeType: change.changeType,
        objectKey: change.objectKey || change.path,
        isTransactional: !this.rollbackGenerator.isNonTransactionalRollback(change, undo),
      });
    }
    return steps;
  }

  /**
   * Generate a best-effort rollback SQL script for a migration without
   * executing anything. Useful for previewing rollback before applying.
   * @param {import('pg').Pool} [pool]
   * @param {string} migrationId
   * @returns {Promise<Object>} { script, steps, status, manualRecoveryRequired }
   */
  async generateRollbackSQL(pool, migrationId) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = this.config.connectionId || null;
    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();

    const migration = await storage.getRollbackSQL(migrationId);
    if (!migration) {
      throw new RollbackError(`Migration ${migrationId} not found.`);
    }

    const steps = this._buildRollbackSteps(migration);
    const nonTransactional = steps.filter(s => !s.isTransactional);

    return {
      migrationId,
      status: migration.status,
      steps,
      script: this.rollbackGenerator.generateRollbackScript(migration),
      manualRecoveryRequired: nonTransactional.length > 0,
      stepCount: steps.length,
    };
  }

  /**
   * Reconcile incomplete migrations after crash
   * @param {import('pg').Pool} [pool]
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async reconcile(pool, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();

    const introspector = new SchemaIntrospector(usePool);
    const recovery = new CrashRecovery(usePool, introspector, storage);

    return recovery.reconcile(connectionId);
  }

  /**
   * Startup recovery — call once after the app boots (and the pool is
   * ready) to reconcile any migrations left in active/stale states by a
   * previous process crash.
   *
   * Safe to call on every boot: reconciles per connection and tolerates
   * missing tables (fresh databases).
   *
   * @param {import('pg').Pool} [pool]
   * @param {Object} [options]
   * @param {string} [options.connectionId]
   * @returns {Promise<{reconciled: number, failed: number, manualReview: number, connections: Array}>}
   */
  async startup(pool, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = options.connectionId || this.config.connectionId || null;

    if (connectionId) {
      const result = await this.reconcile(usePool, { connectionId });
      return {
        reconciled: result.reconciled?.length || 0,
        failed: result.failed?.length || 0,
        manualReview: result.manualReview?.length || 0,
        staleMigrations: result.staleMigrations?.length || 0,
        connections: [{ connectionId, result }],
      };
    }

    const distinct = await usePool.query(`
      SELECT DISTINCT connection_id
      FROM migration_history
      WHERE status IN ('pending', 'acquiring_lock', 'running', 'verifying', 'completing')
    `).catch(() => ({ rows: [] }));

    const connections = [];
    let reconciled = 0;
    let failed = 0;
    let manualReview = 0;
    let staleMigrations = 0;

    for (const row of distinct.rows) {
      try {
        const result = await this.reconcile(usePool, { connectionId: row.connection_id });
        reconciled += result.reconciled?.length || 0;
        failed += result.failed?.length || 0;
        manualReview += result.manualReview?.length || 0;
        staleMigrations += result.staleMigrations?.length || 0;
        connections.push({ connectionId: row.connection_id, result });
      } catch (error) {
        console.warn(`[SwMigrationEngine] Startup reconciliation failed for ${row.connection_id}: ${error.message}`);
        connections.push({ connectionId: row.connection_id, error: error.message });
      }
    }

    return { reconciled, failed, manualReview, staleMigrations, connections };
  }

  /**
   * Get incomplete migrations count
   * @param {import('pg').Pool} [pool]
   * @param {Object} [options]
   * @returns {Promise<number>}
   */
  async getIncompleteCount(pool, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();

    const running = await storage.getByStatus(connectionId, 'running');
    return running.length;
  }

  /**
   * Validate a desired schema against PG version constraints
   * @param {import('./types/schema.js').SchemaSnapshot} desired
   * @param {number} pgVersion
   * @returns {Object}
   */
  validate(desired, pgVersion) {
    return this.riskEngine.validateVersionCompatibility(desired, pgVersion);
  }

  /**
   * Assess risk for changes (alias for riskEngine.assess)
   * @param {Array} changes
   * @param {number} [pgVersion]
   * @returns {Object}
   */
  assessRisk(changes, pgVersion) {
    return this.riskEngine.assess(changes, pgVersion);
  }

  /**
   * Create a migration plan from changes
   * @param {Array} changes
   * @param {Object} options
   * @returns {import('./types/migration.js').MigrationPlan}
   */
  createMigrationPlan(changes, options) {
    const diff = { changes, summary: { totalChanges: changes.length } };
    return this.plan(diff, options);
  }

  /**
   * Diff two schemas (alias for diff)
   * @param {Object} desired
   * @param {Object} current
   * @returns {import('./types/changes.js').SchemaDiff}
   */
diffSchemas(desired, current) {
    return this.diff(desired, current);
  }

  async detectDrift(pool, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();

    const lastMigration = await storage.getLastMigration(connectionId, true);

    if (!lastMigration?.snapshot_after) {
      return {
        canDetect: false,
        reason: 'no_baseline',
        message: 'No previous migration snapshot found. Cannot detect drift.',
      };
    }

    let expectedSnapshot;
    try {
      expectedSnapshot = typeof lastMigration.snapshot_after === 'string' 
        ? JSON.parse(lastMigration.snapshot_after) 
        : lastMigration.snapshot_after;
    } catch (e) {
      return {
        canDetect: false,
        reason: 'invalid_snapshot',
        message: 'Could not parse baseline snapshot.',
      };
    }

    const { DriftDetector } = await import('./executor/drift-detector.js');
    const driftDetector = new DriftDetector();

    const introspector = new SchemaIntrospector(usePool);
    const currentSnapshot = await this.captureDriftSnapshot(usePool);

    const drift = driftDetector.detect(expectedSnapshot, currentSnapshot, { changes: [] });

    return {
      canDetect: true,
      driftDetected: drift.detected,
      summary: drift.summary,
      unexpectedChanges: drift.unexpectedChanges,
      missingChanges: drift.missingChanges,
      baselineMigration: {
        id: lastMigration.id,
        version: lastMigration.version,
        appliedAt: lastMigration.applied_at
      },
      currentSnapshot,
    };
  }

  async captureDriftSnapshot(pool) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const result = await usePool.query(`
      SELECT
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

    return {
      timestamp: new Date().toISOString(),
      objectCount: result.rows.length,
      checksums: result.rows.map(r => ({
        schema: r.schema,
        name: r.name,
        kind: r.kind,
        checksum: r.checksum,
      })),
    };
  }

  async reconcileDrift(pool, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    const driftResult = await this.detectDrift(usePool, { connectionId });

    if (!driftResult.canDetect) {
      return {
        reconciled: false,
        reason: driftResult.reason,
        message: driftResult.message,
      };
    }

    if (!driftResult.driftDetected) {
      return {
        reconciled: false,
        reason: 'no_drift',
        message: 'No drift detected. Schema is consistent.',
      };
    }

    if (!options.auto && options.confirm !== true) {
      return {
        reconciled: false,
        requiresConfirmation: true,
        drift: driftResult,
        message: `Drift detected: ${driftResult.summary.objectsCreated || 0} created, ` +
          `${driftResult.summary.objectsDropped || 0} dropped, ` +
          `${driftResult.summary.objectsModified || 0} modified. ` +
          `Set auto: true or confirm: true to reconcile.`,
      };
    }

    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();

    const currentSnapshot = await this.captureDriftSnapshot(usePool);
    const expectedSnapshot = driftResult.currentSnapshot;

    const reconciliationRecord = await storage.insertReconciliationRecord({
      connectionId,
      name: 'drift_reconciliation',
      snapshotBefore: expectedSnapshot,
      snapshotAfter: currentSnapshot,
      driftSummary: driftResult.summary,
      schemaDiff: { drift: driftResult },
    });

    return {
      reconciled: true,
      reconciliationId: reconciliationRecord.id,
      version: reconciliationRecord.version,
      driftSummary: driftResult.summary,
      message: 'Drift reconciled. Current schema state recorded in history.',
    };
  }

  async verifyHistoryIntegrity(pool, options = {}) {
    const usePool = pool || this.pool;
    if (!usePool) {
      throw new StorageError('Database pool is required.');
    }

    const connectionId = options.connectionId || this.config.connectionId || null;
    const storage = new MigrationTable(usePool, connectionId);
    await storage.ensureTable();

    return storage.verifyHistoryIntegrity(connectionId);
  }
}
