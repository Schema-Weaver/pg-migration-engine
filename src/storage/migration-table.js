/**
 * Schema Weaver Migration Engine - Migration Storage
 * https://schemaweaver.vivekmind.com/
 */
import crypto from 'crypto';

const ENGINE_VERSION = '1.0.0';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toUUID(input) {
  if (!input) return null;
  if (UUID_REGEX.test(input)) {
    return input;
  }
  if (typeof input === 'string') {
    const hash = crypto.createHash('md5').update(input).digest('hex');
    return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
  }
  return null;
}

function validateConnectionId(connectionId) {
  if (!connectionId) return { valid: true, uuid: null, warning: null };
  
  if (UUID_REGEX.test(connectionId)) {
    return { valid: true, uuid: connectionId, warning: null };
  }
  
  const converted = toUUID(connectionId);
  return {
    valid: true,
    uuid: converted,
    warning: `connectionId "${connectionId}" is not a valid UUID. ` +
             `Converted to "${converted}" for database storage. ` +
             `For best results, use a valid UUID format.`,
  };
}

async function retryWithBackoff(fn, maxRetries = MAX_RETRIES, delayMs = RETRY_DELAY_MS) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const isRetryable = error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === '55P03' ||
          error.code === '08006' ||
          error.message?.includes('connection') ||
          error.message?.includes('timeout');
        if (isRetryable) {
          const delay = delayMs * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      throw error;
    }
  }
  throw lastError;
}

const VALID_STATUSES = [
  'pending', 'running', 'completed', 'failed',
  'partially_applied', 'rolled_back', 'needs_review'
];

export class MigrationTable {
  tableName = 'migration_history';

  constructor(pool, connectionId = null) {
    this.pool = pool;
    const validation = validateConnectionId(connectionId);
    this.connectionId = validation.uuid;
    if (validation.warning) {
      console.warn(`[MigrationTable] ${validation.warning}`);
    }
    this._reconciledConnections = new Set();

    if (!connectionId) {
      console.warn(
        '[SchemaWeaver] No connectionId provided. ' +
        'Migration records will not be scoped to a specific database. ' +
        'This may cause issues in multi-database environments.'
      );
    }
  }

  static getValidStatuses() {
    return [...VALID_STATUSES];
  }

  isValidStatus(status) {
    return VALID_STATUSES.includes(status);
  }

  async ensureTable() {
    const tableCheck = await this.pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'migration_history'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS migration_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          connection_id UUID,
          version VARCHAR(30) NOT NULL,
          name VARCHAR(255) NOT NULL,
          checksum VARCHAR(64) NOT NULL DEFAULT '',
          up_sql TEXT NOT NULL DEFAULT '',
          down_sql TEXT,
          full_snapshot_sql TEXT,
          commit_message TEXT,
          applied_by UUID,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          execution_time_ms INTEGER,
          error_message TEXT,
          rolled_back_at TIMESTAMPTZ,
          rolled_back_by UUID,
          metadata JSONB,
          applied_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now(),

          schema_diff JSONB,
          sql_statements JSONB,
          execution_results JSONB,
          snapshot_before JSONB,
          snapshot_after JSONB,
          risk_summary JSONB,
          warnings JSONB,
          direction VARCHAR(10) DEFAULT 'up',
          change_count INTEGER DEFAULT 0,
          create_count INTEGER DEFAULT 0,
          alter_count INTEGER DEFAULT 0,
          drop_count INTEGER DEFAULT 0,
          rename_count INTEGER DEFAULT 0,
          pg_version VARCHAR(20),
          engine_version VARCHAR(20),
          rollback_sql JSONB,
          tags TEXT[],
          warnings_acknowledged JSONB DEFAULT NULL,
          data_loss_acknowledged BOOLEAN DEFAULT FALSE
        )
      `);
    } else {
      await this.ensureEngineColumns();
    }

    await this.ensureIndexes();
    await this.ensureCheckConstraints();
    await this.checkLegacyTable();
  }

  async ensureEngineColumns() {
    const engineColumns = [
      { name: 'schema_diff', type: 'JSONB' },
      { name: 'sql_statements', type: 'JSONB' },
      { name: 'execution_results', type: 'JSONB' },
      { name: 'snapshot_before', type: 'JSONB' },
      { name: 'snapshot_after', type: 'JSONB' },
      { name: 'risk_summary', type: 'JSONB' },
      { name: 'warnings', type: 'JSONB' },
      { name: 'direction', type: 'VARCHAR(10)', def: "'up'" },
      { name: 'change_count', type: 'INTEGER', def: '0' },
      { name: 'create_count', type: 'INTEGER', def: '0' },
      { name: 'alter_count', type: 'INTEGER', def: '0' },
      { name: 'drop_count', type: 'INTEGER', def: '0' },
      { name: 'rename_count', type: 'INTEGER', def: '0' },
      { name: 'pg_version', type: 'VARCHAR(20)' },
      { name: 'engine_version', type: 'VARCHAR(20)' },
      { name: 'rollback_sql', type: 'JSONB' },
      { name: 'tags', type: 'TEXT[]' },
      { name: 'lock_pid', type: 'INTEGER' },
      { name: 'lock_key', type: 'VARCHAR(50)' },
      { name: 'warnings_acknowledged', type: 'JSONB' },
      { name: 'data_loss_acknowledged', type: 'BOOLEAN', def: 'FALSE' },
    ];

    for (const col of engineColumns) {
      const colCheck = await this.pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_name = 'migration_history'
            AND column_name = $1
        )
      `, [col.name]);

      if (!colCheck.rows[0].exists) {
        const defaultClause = col.def ? ` DEFAULT ${col.def}` : '';
        await this.pool.query(`
          ALTER TABLE migration_history
          ADD COLUMN ${col.name} ${col.type}${defaultClause}
        `);
      }
    }
  }

  async ensureIndexes() {
    const indexes = [
      { name: 'idx_migration_history_status', on: 'status' },
      { name: 'idx_migration_history_connection', on: 'connection_id' },
      { name: 'idx_migration_history_applied_at', on: 'applied_at DESC NULLS LAST' },
      { name: 'idx_migration_history_version', on: 'version' },
      { name: 'idx_migration_history_name', on: 'name' },
    ];

    for (const idx of indexes) {
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS ${idx.name}
        ON migration_history (${idx.on})
      `).catch(() => {});
    }

    const uniqueIndexes = [
      {
        name: 'idx_migration_history_one_running_per_connection',
        on: 'connection_id',
        where: "status = 'running'",
      },
      {
        name: 'idx_migration_history_version_unique',
        on: 'connection_id, version',
        where: null,
      },
    ];

    for (const idx of uniqueIndexes) {
      try {
        const existsCheck = await this.pool.query(`
          SELECT 1 FROM pg_indexes 
          WHERE indexname = $1
        `, [idx.name]);
        
        if (existsCheck.rows.length === 0) {
          const whereClause = idx.where ? ` WHERE ${idx.where}` : '';
          await this.pool.query(`
            CREATE UNIQUE INDEX ${idx.name}
            ON migration_history (${idx.on})${whereClause}
          `);
        }
      } catch (error) {
        if (error.code === '23505') {
          console.warn(
            `[MigrationTable] Cannot create unique index ${idx.name}: ` +
            `multiple running migrations exist. Clean up stale records first.`
          );
        } else if (error.code !== '42P07') {
          console.warn(
            `[MigrationTable] Could not create unique index ${idx.name}: ${error.message}`
          );
        }
      }
    }
  }

  async ensureCheckConstraints() {
    const checkConstraints = [
      {
        name: 'chk_migration_history_status',
        check: `status IN ('pending', 'running', 'completed', 'failed', 'partially_applied', 'rolled_back', 'needs_review')`,
      },
      {
        name: 'chk_migration_history_direction',
        check: `direction IN ('up', 'down')`,
      },
    ];

    for (const constraint of checkConstraints) {
      try {
        const existsCheck = await this.pool.query(`
          SELECT 1 FROM pg_constraint 
          WHERE conname = $1 AND contype = 'c'
        `, [constraint.name]);
        
        if (existsCheck.rows.length === 0) {
          await this.pool.query(`
            ALTER TABLE migration_history
            ADD CONSTRAINT ${constraint.name} CHECK (${constraint.check})
          `);
        }
      } catch (error) {
        if (error.code !== '42710') {
          console.warn(
            `[MigrationTable] Could not create check constraint ${constraint.name}: ${error.message}`
          );
        }
      }
    }
  }

  getValidStatuses() {
    return VALID_STATUSES;
  }

  async checkLegacyTable() {
    const legacyCheck = await this.pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = '_sw_migrations'
      )
    `);

    if (legacyCheck.rows[0].exists) {
      console.warn(
        '[SchemaWeaver] Legacy table _sw_migrations detected. ' +
        'This table is deprecated. Migration history is now stored in migration_history.'
      );
    }
  }

  generateVersion() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
  }

  computeChecksum(plan) {
    const canonical = JSON.stringify(
      plan.steps?.map(s => ({ sql: s.sql, id: s.id })) || []
    );
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  generateUpSql(plan) {
    return plan.steps?.map(s => s.sql).filter(Boolean).join(';\n') || '';
  }

  getEngineVersion() {
    return ENGINE_VERSION;
  }

  mapExecutorStatus(executorStatus) {
    const STATUS_MAP = {
      'COMPLETED': 'completed',
      'completed': 'completed',
      'PARTIALLY_APPLIED': 'partially_applied',
      'partially_applied': 'partially_applied',
      'FAILED': 'failed',
      'failed': 'failed',
      'DRY_RUN_SUCCESS': 'completed',
      'dry_run_success': 'completed',
      'DRY_RUN_FAILURE': 'failed',
      'dry_run_failure': 'failed',
      'running': 'running',
      'pending': 'pending',
      'rolled_back': 'rolled_back',
    };
    return STATUS_MAP[executorStatus] || executorStatus?.toLowerCase() || 'failed';
  }

  async createRecord(plan, connectionId = null) {
    return retryWithBackoff(async () => {
      const cid = connectionId || this.connectionId;
      
      const existingRunning = await this.pool.query(`
        SELECT id, version, name, applied_at, created_at
        FROM migration_history
        WHERE connection_id = $1 AND status = 'running'
        ORDER BY created_at DESC
        LIMIT 1
      `, [cid]);
    
    if (existingRunning.rows.length > 0) {
      const stale = existingRunning.rows[0];
      const ageMs = Date.now() - new Date(stale.created_at).getTime();
      const ageMinutes = Math.round(ageMs / 60000);
      
      const staleThresholdMinutes = plan.staleThresholdMinutes || 30;
      
      if (ageMinutes < staleThresholdMinutes) {
        const error = new Error(
          `Cannot create migration: another migration is already running. ` +
          `Migration ID: ${stale.id}, version: ${stale.version}, ` +
          `started: ${stale.created_at} (${ageMinutes} minutes ago). ` +
          `Wait for it to complete or check for stale locks.`
        );
        error.name = 'MigrationConflictError';
        error.code = 'CONCURRENT_MIGRATION';
        error.details = {
          existingMigration: {
            id: stale.id,
            version: stale.version,
            name: stale.name,
            createdAt: stale.created_at,
            ageMinutes,
          },
          connectionId: cid,
        };
        throw error;
      }
      
      console.warn(
        `[MigrationTable] Found stale running migration (id: ${stale.id}, ` +
        `age: ${ageMinutes} minutes). Marking as failed and proceeding.`
      );
      
      await this.pool.query(`
        UPDATE migration_history
        SET status = 'failed',
            error_message = $1
        WHERE id = $2
      `, [`Stale migration (running for ${ageMinutes} minutes) - superseded by new migration`, stale.id]);
      
      // Attempt to clean up any stale advisory lock for this connection
      // This uses pg_try_advisory_lock to safely acquire and release
      try {
        const lockKeyResult = await this.pool.query(`
          SELECT objid FROM pg_locks 
          WHERE locktype = 'advisory' 
            AND pid IN (
              SELECT pid FROM pg_stat_activity 
              WHERE datname = current_database()
            )
            AND objid IN (
              SELECT (hash + nonce)::bigint FROM (
                SELECT 0 as nonce
              ) t
            )
          LIMIT 1
        `);
        
        if (lockKeyResult.rows.length > 0) {
          const possibleLockKey = lockKeyResult.rows[0].objid;
          const client = await this.pool.connect();
          try {
            const acquireResult = await client.query(
              'SELECT pg_try_advisory_lock($1) as acquired',
              [possibleLockKey]
            );
            if (acquireResult.rows[0].acquired) {
              await client.query('SELECT pg_advisory_unlock($1)', [possibleLockKey]);
              console.info(
                `[MigrationTable] Released stale advisory lock ${possibleLockKey} ` +
                `for connection ${cid}`
              );
            }
          } finally {
            client.release();
          }
        }
      } catch (lockCleanupError) {
        // Log but don't fail - advisory lock cleanup is best effort
        console.warn(
          `[MigrationTable] Could not clean up stale lock (this is okay if the lock was ` +
          `already released or held by another session): ${lockCleanupError.message}`
        );
      }
    }

    const version = this.generateVersion();
    const checksum = this.computeChecksum(plan);
    const upSql = this.generateUpSql(plan);

    if (plan.isIrreversible !== true) {
      const hasRollbackSql = plan.rollbackSql || 
                             plan.down_sql || 
                             plan.rollbackSteps?.length > 0 ||
                             plan.steps?.some(s => s.rollbackSql || s.undoSql);
      if (!hasRollbackSql) {
        console.warn(
          `[MigrationTable] Migration "${plan.name || version}" has no rollback SQL. ` +
          `Mark as isIrreversible=true or provide rollback SQL for safety.`
        );
      }
    }

    const changes = plan.changes || plan.steps || [];
    const changeCount = changes.length;
    const createCount = changes.filter(c => c.changeType === 'CREATE').length;
    const alterCount = changes.filter(c => c.changeType === 'ALTER').length;
    const dropCount = changes.filter(c => c.changeType === 'DROP').length;
    const renameCount = changes.filter(c => c.changeType === 'RENAME').length;

    const result = await this.pool.query(`
      INSERT INTO migration_history (
        connection_id, version, name, checksum,
        up_sql, status, direction,
        schema_diff, sql_statements,
        risk_summary, warnings,
        change_count, create_count, alter_count, drop_count, rename_count,
        pg_version, engine_version,
        lock_pid, lock_key,
        applied_at, created_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, 'running', $6,
        $7, $8,
        $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17,
        $18, $19,
        now(), now()
      )
      ON CONFLICT (connection_id, version) DO UPDATE
      SET status = 'running',
          applied_at = now(),
          up_sql = EXCLUDED.up_sql,
          checksum = EXCLUDED.checksum,
          schema_diff = EXCLUDED.schema_diff,
          sql_statements = EXCLUDED.sql_statements
      WHERE migration_history.status IN ('failed', 'partial_manual_review')
      RETURNING id, version
    `, [
      cid,
      version,
      plan.name || `migration_${version}`,
      checksum,
      upSql,
      plan.direction || 'up',
      JSON.stringify(plan.schemaDiff || plan.diff || {}),
      JSON.stringify(plan.steps?.map(s => ({ stepId: s.id, sql: s.sql })) || []),
      JSON.stringify(plan.riskSummary || {}),
      JSON.stringify(plan.warnings || []),
      changeCount, createCount, alterCount, dropCount, renameCount,
      plan.pgVersion || null,
      this.getEngineVersion(),
      plan.lockPid || null,
      plan.lockKey || null,
    ]);

    if (result.rows.length === 0) {
      throw new Error(
        `Cannot create migration record for connection ${cid}. ` +
        `A migration with version ${version} is already running. ` +
        `Use reconcile() to clean up stale records.`
      );
    }

    return result.rows[0];
    });
  }


  async updateStepProgress(recordId, stepId, status, durationMs) {
    return retryWithBackoff(async () => {
      await this.pool.query(`
        UPDATE migration_history
        SET execution_results = 
          COALESCE(execution_results, '{}'::jsonb) || 
          jsonb_build_object($1::text, jsonb_build_object(
            'status', $2::text,
            'duration_ms', $3::numeric,
            'completed_at', now()
          ))
        WHERE id = $4
      `, [stepId, status, durationMs, recordId]);
    });
  }

  async completeRecord(recordId, execResult) {
    return retryWithBackoff(async () => {
    const status = this.mapExecutorStatus(execResult.status);
    const errorMessage = execResult.errors?.length > 0
      ? execResult.errors.map(e => `[${e.code || 'ERR'}] ${e.message}`).join('\n')
      : null;

    const warningPayload = execResult.warningReport
      ? JSON.stringify(execResult.warningReport.warnings || [])
      : execResult.warningsAcknowledged
        ? JSON.stringify(execResult.warningsAcknowledged)
        : null;

    const dataLossAck = execResult.dataLossAcknowledged === true;

    await this.pool.query(`
      UPDATE migration_history
      SET status = $1,
          execution_time_ms = $2,
          error_message = $3,
          execution_results = $4,
          snapshot_before = $5,
          snapshot_after = $6,
          rollback_sql = $7,
          warnings_acknowledged = COALESCE($9, warnings_acknowledged),
          data_loss_acknowledged = CASE WHEN $10 THEN TRUE ELSE data_loss_acknowledged END,
          applied_at = CASE WHEN $1 IN ('completed', 'partially_applied') THEN now() ELSE applied_at END
      WHERE id = $8
    `, [
      status,
      execResult.durationMs || execResult.duration,
      errorMessage,
      JSON.stringify(execResult.intents || execResult.executionResults || {}),
      JSON.stringify(execResult.snapshotBefore || execResult.snapshots?.before || null),
      JSON.stringify(execResult.snapshotAfter || execResult.snapshots?.after || null),
      JSON.stringify(execResult.rollbackSteps || []),
      recordId,
      warningPayload,
      dataLossAck,
    ]);
    });
  }

  async failRecord(recordId, error, executedSteps = []) {
    return retryWithBackoff(async () => {
      const errorMessage = error.message || String(error);
      const pgError = error.code ? `[${error.code}] ` : '';
      
      const retryMetadata = error.retryMetadata || {};
      const connectionRecovery = error.connectionRecovery || null;

      await this.pool.query(`
        UPDATE migration_history
        SET status = 'failed',
            error_message = $1,
            execution_results = $2,
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
        WHERE id = $4
      `, [
        pgError + errorMessage,
        JSON.stringify({ 
          executedSteps, 
          error: { 
            message: errorMessage, 
            code: error.code,
            retryCount: retryMetadata.attempts || 0,
            backoffs: retryMetadata.backoffs || [],
          },
          connectionRecovery,
        }),
        JSON.stringify({
          retry_count: retryMetadata.attempts || 0,
          retry_backoffs_ms: retryMetadata.backoffs || [],
          connection_recovered: connectionRecovery?.state === 'fully_applied',
        }),
        recordId,
      ]);
    });
  }

  async markRolledBack(recordId, rolledBackBy = null) {
    await this.pool.query(`
      UPDATE migration_history
      SET status = 'rolled_back',
          rolled_back_at = now(),
          rolled_back_by = $1
      WHERE id = $2
    `, [rolledBackBy, recordId]);
  }

  async getHistory(connectionId = null, limit = 50, offset = 0) {
    const cid = connectionId || this.connectionId;
    const result = await this.pool.query(`
      SELECT id, version, name, status, direction,
             change_count, create_count, alter_count, drop_count, rename_count,
             execution_time_ms, error_message,
             applied_at, created_at, rolled_back_at
      FROM migration_history
      WHERE connection_id = $1
      ORDER BY applied_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `, [cid, limit, offset]);
    return result.rows;
  }

async getLastMigration(connectionId = null, includeSnapshot = false) {
    const cid = connectionId || this.connectionId;
    const columns = includeSnapshot 
      ? 'id, version, name, status, checksum, applied_at, snapshot_before, snapshot_after'
      : 'id, version, name, status, checksum, applied_at';
    const result = await this.pool.query(`
      SELECT ${columns}
      FROM migration_history
      WHERE connection_id = $1 AND status = 'completed'
      ORDER BY applied_at DESC
      LIMIT 1
    `, [cid]);
    return result.rows[0] || null;
  }

  async getHistoryForVerification(connectionId = null, limit = 100) {
    const cid = connectionId || this.connectionId;
    const result = await this.pool.query(`
      SELECT id, version, name, checksum, sql_statements, applied_at
      FROM migration_history
      WHERE connection_id = $1 AND status = 'completed'
      ORDER BY applied_at DESC
      LIMIT $2
    `, [cid, limit]);
    return result.rows;
  }

  async updateSnapshotAfter(recordId, snapshotAfter) {
    await this.pool.query(`
      UPDATE migration_history
      SET snapshot_after = $1
      WHERE id = $2
    `, [JSON.stringify(snapshotAfter), recordId]);
  }

  async insertReconciliationRecord(data) {
    const result = await this.pool.query(`
      INSERT INTO migration_history (
        connection_id, version, name, checksum, up_sql,
        status, applied_at, applied_by,
        schema_diff, snapshot_before, snapshot_after,
        metadata, engine_version
      ) VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11, $12)
      RETURNING id, version
    `, [
      data.connectionId,
      data.version || this.generateVersion(),
      data.name || 'drift_reconciliation',
      data.checksum || '',
      data.up_sql || '',
      'completed',
      data.appliedBy || null,
      JSON.stringify(data.schemaDiff || {}),
      JSON.stringify(data.snapshotBefore || {}),
      JSON.stringify(data.snapshotAfter || {}),
      JSON.stringify({
        reconciliation: true,
        driftSummary: data.driftSummary || {},
        reconciledAt: new Date().toISOString()
      }),
      this.getEngineVersion()
    ]);
    return result.rows[0];
  }

  computeChecksum(plan) {
    const canonical = JSON.stringify(
      plan.steps?.map(s => ({ sql: s.sql, id: s.id })) || []
    );
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  reconstructPlanFromHistory(migration) {
    if (!migration.sql_statements) return null;
    const steps = JSON.parse(migration.sql_statements || '[]').map((s, i) => ({
      id: s.stepId || `step_${i}`,
      sql: s.sql
    }));
    return { steps };
  }

  async verifyHistoryIntegrity(connectionId = null) {
    const history = await this.getHistoryForVerification(connectionId);
    const mismatches = [];
    
    for (const migration of history) {
      if (!migration.sql_statements) continue;
      
      try {
        const plan = this.reconstructPlanFromHistory(migration);
        if (!plan || !plan.steps?.length) continue;
        
        const computed = this.computeChecksum(plan);
        
        if (computed !== migration.checksum) {
          mismatches.push({
            id: migration.id,
            version: migration.version,
            name: migration.name,
            storedChecksum: migration.checksum,
            computedChecksum: computed,
            appliedAt: migration.applied_at
          });
        }
      } catch (error) {
        console.warn(`[MigrationTable] Failed to verify migration ${migration.version}: ${error.message}`);
      }
    }
    
    return {
      valid: mismatches.length === 0,
      verified: history.length,
      mismatches
    };
  }

  async getMigration(recordId) {
    const result = await this.pool.query(`
      SELECT * FROM migration_history WHERE id = $1
    `, [recordId]);
    return result.rows[0] || null;
  }

  async getMigrationByVersion(connectionId = null, version) {
    const cid = connectionId || this.connectionId;
    const result = await this.pool.query(`
      SELECT * FROM migration_history
      WHERE connection_id = $1 AND version = $2
    `, [cid, version]);
    return result.rows[0] || null;
  }

  async getByStatus(connectionId = null, status) {
    const cid = connectionId || this.connectionId;
    const result = await this.pool.query(`
      SELECT * FROM migration_history
      WHERE connection_id = $1 AND status = $2
      ORDER BY created_at DESC
    `, [cid, status]);
    return result.rows;
  }

  async getRollbackSQL(recordId) {
    const result = await this.pool.query(`
      SELECT 
        id, name, schema_diff,
        rollback_sql, sql_statements,
        status, applied_at
      FROM migration_history
      WHERE id = $1
    `, [recordId]);
    return result.rows[0] || null;
  }

  async setRollbackSQL(recordId, rollbackSteps) {
    await this.pool.query(`
      UPDATE migration_history
      SET rollback_sql = $1
      WHERE id = $2
    `, [JSON.stringify(rollbackSteps), recordId]);
  }

  async getStats(connectionId = null) {
    const cid = connectionId || this.connectionId;
    const result = await this.pool.query(`
      SELECT
        COUNT(*) as total_migrations,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'rolled_back') as rolled_back,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'partially_applied') as partially_applied,
        COALESCE(SUM(change_count), 0) as total_changes,
        COALESCE(SUM(execution_time_ms), 0) as total_execution_time_ms,
        MAX(applied_at) as last_migration_at
      FROM migration_history
      WHERE connection_id = $1
    `, [cid]);
    return result.rows[0];
  }

  async cleanupOldRecords(keepCount = 100, connectionId = null) {
    const cid = connectionId || this.connectionId;
    const result = await this.pool.query(`
      DELETE FROM migration_history
      WHERE id NOT IN (
        SELECT id FROM migration_history
        WHERE connection_id = $1
        ORDER BY applied_at DESC NULLS LAST
        LIMIT $2
      ) AND connection_id = $1
      RETURNING id
    `, [cid, keepCount]);
    return result.rowCount;
  }
}
