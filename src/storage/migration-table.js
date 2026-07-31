/**
 * Schema Weaver Migration Engine - Migration Storage
 * https://schemaweaver.vivekmind.com/
 */
import crypto from 'crypto';
import os from 'os';
import { MigrationStateMachine } from '../state-machine/migration-state-machine.js';
import { ExecutionLog } from './execution-log.js';
import { MigrationConflictError } from '../errors.js';

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
  'pending', 'acquiring_lock', 'running', 'verifying', 'completing',
  'completed', 'failed', 'partially_applied',
  'rolling_back', 'rolled_back', 'stale', 'needs_review',
];

const STALE_THRESHOLD_MINUTES = 30;
const STALE_PENDING_MINUTES = 5;

const ACTIVE_STATUSES_SQL = `('pending', 'acquiring_lock', 'running', 'verifying', 'completing')`;

/**
 * Per-status stale thresholds (minutes) used by createRecord()'s gatekeeper.
 * pending/acquiring_lock resolve quickly (lock acquisition); once running,
 * the longer legacy threshold applies until heartbeat data is available.
 */
const STATUS_STALE_MINUTES = {
  pending: STALE_PENDING_MINUTES,
  acquiring_lock: STALE_PENDING_MINUTES,
  running: STALE_THRESHOLD_MINUTES,
  verifying: STALE_THRESHOLD_MINUTES,
  completing: STALE_THRESHOLD_MINUTES,
};

export class MigrationTable {
  tableName = 'migration_history';

  constructor(pool, connectionId = null) {
    this.pool = pool;
    this.stateMachine = new MigrationStateMachine(pool);
    this.executionLog = new ExecutionLog(pool);
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

  /**
   * Create the migration_history table if it does not exist.
   *
   * Concurrent callers (two migrate() calls racing on a fresh database) can
   * both pass the existence check and both attempt the identical CREATE TABLE.
   * PostgreSQL's catalog then throws 23505 on pg_type_typname_nsp_index from
   * the concurrent create. Retry briefly, re-checking existence between
   * attempts; when the racing caller has created the table, just proceed.
   */
  async ensureTableExists() {
    const existsCheck = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'migration_history'
      )
    `;

    const tableCheck = await this.pool.query(existsCheck);
    if (tableCheck.rows[0].exists) return true;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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
          status_previous VARCHAR(20),
          status_changed_at TIMESTAMPTZ,
          execution_time_ms INTEGER,
          error_message TEXT,
          rolled_back_at TIMESTAMPTZ,
          rolled_back_by UUID,
          metadata JSONB,
          applied_at TIMESTAMPTZ,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          last_heartbeat_at TIMESTAMPTZ,
          heartbeat_interval_ms INTEGER,
          executor_pid INTEGER,
          executor_hostname VARCHAR(255),
          retry_count INTEGER DEFAULT 0,
          last_error TEXT,
          reconcile_count INTEGER DEFAULT 0,
          phase_count INTEGER DEFAULT 0,
          step_count INTEGER DEFAULT 0,
          current_phase INTEGER,
          current_step_id VARCHAR(100),
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
          data_loss_acknowledged BOOLEAN DEFAULT FALSE,
          lock_mode VARCHAR(20)
        )
      `);
        return true;
      } catch (error) {
        if (error.code !== '23505') throw error;
        const recheck = await this.pool.query(existsCheck);
        if (recheck.rows[0].exists) return true;
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }

    // Last attempt: let any real error surface.
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
        status_previous VARCHAR(20),
        status_changed_at TIMESTAMPTZ,
        execution_time_ms INTEGER,
        error_message TEXT,
        rolled_back_at TIMESTAMPTZ,
        rolled_back_by UUID,
        metadata JSONB,
        applied_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        last_heartbeat_at TIMESTAMPTZ,
        heartbeat_interval_ms INTEGER,
        executor_pid INTEGER,
        executor_hostname VARCHAR(255),
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        reconcile_count INTEGER DEFAULT 0,
        phase_count INTEGER DEFAULT 0,
        step_count INTEGER DEFAULT 0,
        current_phase INTEGER,
        current_step_id VARCHAR(100),
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
        data_loss_acknowledged BOOLEAN DEFAULT FALSE,
        lock_mode VARCHAR(20)
      )
    `);
    return true;
  }

  async ensureTable() {
    await this.ensureTableExists();
    await this.ensureEngineColumns();

    // Enum migration must run BEFORE any index/trigger references the status
    // column: partial indexes and the transition trigger block the ALTER TYPE
    // ("cannot alter type of a column used in a trigger definition",
    // "functions in index predicate must be marked IMMUTABLE").
    await this.ensureStatusEnum();
    await this.ensureIndexes();
    await this.ensureCheckConstraints();
    await this.ensureTransitionTrigger();
    await this.checkLegacyTable();
    await this.executionLog.ensureTable();
  }

  /**
   * Create the migration_status enum type (idempotent) and migrate the
   * status/status_previous columns from VARCHAR to the enum when safe.
   *
   * Failures degrade gracefully (warning only): the transition trigger and
   * the JS state machine still enforce transitions without the enum.
   */
  async ensureStatusEnum() {
    const labels = MigrationStateMachine.VALID_TRANSITIONS
      ? Object.keys(MigrationStateMachine.VALID_TRANSITIONS)
      : [];
    const allStatuses = labels.length > 0
      ? labels
      : ['pending', 'acquiring_lock', 'running', 'verifying', 'completing',
         'completed', 'failed', 'stale', 'rolling_back', 'rolled_back',
         'needs_review', 'partially_applied'];

    const labelList = allStatuses.map(s => `'${s}'`).join(', ');

    await this.pool.query(`
      DO $$ BEGIN
        CREATE TYPE migration_status AS ENUM (${labelList});
      EXCEPTION WHEN duplicate_object THEN NULL;
        -- Concurrent callers racing the same CREATE TYPE can hit the catalog
        -- unique index (23505) instead of duplicate_object (42710).
        WHEN unique_violation THEN NULL;
      END $$
    `).catch((error) => {
      console.warn(`[MigrationTable] Could not create migration_status enum: ${error.message}`);
      return;
    });

    try {
      const colCheck = await this.pool.query(`
        SELECT data_type, column_default
        FROM information_schema.columns
        WHERE table_name = 'migration_history' AND column_name = 'status'
      `);
      if (colCheck.rows[0] && colCheck.rows[0].data_type === 'character varying') {
        const hasDefault = colCheck.rows[0].column_default != null;
        if (hasDefault) {
          await this.pool.query(`
            ALTER TABLE migration_history ALTER COLUMN status DROP DEFAULT
          `);
        }
        // Legacy tables may already carry objects that block the ALTER TYPE:
        // the transition trigger (references status) and the partial indexes
        // whose predicates reference status. Drop them here; ensureIndexes /
        // ensureTransitionTrigger recreate them afterwards.
        await this.pool.query(`
          DROP TRIGGER IF EXISTS enforce_status_transition ON migration_history
        `);
        await this.pool.query(`
          DROP INDEX IF EXISTS idx_migration_history_heartbeat
        `);
        await this.pool.query(`
          DROP INDEX IF EXISTS idx_migration_history_one_running_per_connection
        `);
        const migrate = () => this.pool.query(`
          ALTER TABLE migration_history
          ALTER COLUMN status TYPE migration_status USING status::text::migration_status,
          ALTER COLUMN status_previous TYPE migration_status USING status_previous::text::migration_status
        `);
        await migrate().catch((error) => {
          // status_previous may be missing on legacy tables; migrate status alone.
          if (String(error.message || '').includes('status_previous')) {
            return this.pool.query(`
              ALTER TABLE migration_history
              ALTER COLUMN status TYPE migration_status USING status::text::migration_status
            `);
          }
          throw error;
        });
        if (hasDefault) {
          await this.pool.query(`
            ALTER TABLE migration_history
            ALTER COLUMN status SET DEFAULT 'pending'::migration_status
          `);
        }
      }
    } catch (error) {
      console.warn(`[MigrationTable] Could not migrate status column to enum: ${error.message}`);
    }
  }

  /**
   * Database-level state machine enforcement (proposal v2).
   *
   * A BEFORE UPDATE OF status trigger validates every status change against
   * the same transition table the JS state machine enforces
   * (MigrationStateMachine.VALID_TRANSITIONS). Same-status updates (no-op
   * refreshes) are always allowed. Built from the JS transition table so the
   * two can never drift.
   */
  async ensureTransitionTrigger() {
    const pairs = Object.entries(MigrationStateMachine.VALID_TRANSITIONS)
      .map(([from, tos]) => {
        if (!Array.isArray(tos) || tos.length === 0) {
          return `(OLD.status = '${from}' AND FALSE)`;
        }
        return `(OLD.status = '${from}' AND NEW.status IN (${tos.map(t => `'${t}'`).join(', ')}))`;
      })
      .join('\n      OR ');

    const ddl = `
CREATE OR REPLACE FUNCTION validate_migration_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
      ${pairs}
  ) THEN
    RAISE EXCEPTION 'Invalid status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_status_transition ON migration_history;
CREATE TRIGGER enforce_status_transition
  BEFORE UPDATE OF status ON migration_history
  FOR EACH ROW EXECUTE FUNCTION validate_migration_transition();`;

    try {
      await this.pool.query(ddl);
    } catch (error) {
      console.warn(`[MigrationTable] Could not create transition trigger: ${error.message}`);
    }
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
      { name: 'heartbeat_interval_ms', type: 'INTEGER' },
      { name: 'executor_pid', type: 'INTEGER' },
      { name: 'executor_hostname', type: 'VARCHAR(255)' },
      { name: 'retry_count', type: 'INTEGER', def: '0' },
      { name: 'last_error', type: 'TEXT' },
      { name: 'reconcile_count', type: 'INTEGER', def: '0' },
      { name: 'phase_count', type: 'INTEGER', def: '0' },
      { name: 'step_count', type: 'INTEGER', def: '0' },
      { name: 'current_phase', type: 'INTEGER' },
      { name: 'current_step_id', type: 'VARCHAR(100)' },
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
        // IF NOT EXISTS keeps concurrent ensureTable() calls race-free
        // (check-then-ALTER would throw 42701 duplicate_column).
        await this.pool.query(`
          ALTER TABLE migration_history
          ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}${defaultClause}
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
      {
        name: 'idx_migration_history_heartbeat',
        on: 'last_heartbeat_at',
        where: `status IN ${ACTIVE_STATUSES_SQL}`,
      },
    ];

    for (const idx of indexes) {
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS ${idx.name}
        ON migration_history (${idx.on})${idx.where ? ` WHERE ${idx.where}` : ''}
      `).catch(() => {});
    }

    const uniqueIndexes = [
      {
        name: 'idx_migration_history_one_running_per_connection',
        on: 'connection_id',
        where: `status IN ${ACTIVE_STATUSES_SQL}`,
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
          SELECT pg_get_indexdef(indexname::regclass) AS def
          FROM pg_indexes 
          WHERE indexname = $1
        `, [idx.name]);

        if (existsCheck.rows.length === 0) {
          const whereClause = idx.where ? ` WHERE ${idx.where}` : '';
          await this.pool.query(`
            CREATE UNIQUE INDEX ${idx.name}
            ON migration_history (${idx.on})${whereClause}
          `);
        } else if (idx.where && !existsCheck.rows[0].def.includes("'acquiring_lock'")) {
          // Outdated WHERE clause (e.g. status = 'running' only) - recreate
          // so the unique guard covers every active status.
          await this.pool.query(`DROP INDEX IF EXISTS ${idx.name}`);
          await this.pool.query(`
            CREATE UNIQUE INDEX ${idx.name}
            ON migration_history (${idx.on}) WHERE ${idx.where}
          `);
        }
      } catch (error) {
        if (error.code === '23505') {
          console.warn(
            `[MigrationTable] Cannot create unique index ${idx.name}: ` +
            `multiple active migrations exist. Clean up stale records first.`
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
        check: `status IN ('pending', 'acquiring_lock', 'running', 'verifying', 'completing', 'completed', 'failed', 'partially_applied', 'rolling_back', 'rolled_back', 'stale', 'needs_review')`,
      },
      {
        name: 'chk_migration_history_direction',
        check: `direction IN ('up', 'down')`,
      },
    ];

    for (const constraint of checkConstraints) {
      try {
        const existsCheck = await this.pool.query(`
          SELECT pg_get_constraintdef(oid) AS def
          FROM pg_constraint 
          WHERE conname = $1 AND contype = 'c'
        `, [constraint.name]);

        if (existsCheck.rows.length === 0) {
          await this.pool.query(`
            ALTER TABLE migration_history
            ADD CONSTRAINT ${constraint.name} CHECK (${constraint.check})
          `);
        } else if (constraint.name === 'chk_migration_history_status' &&
                   !existsCheck.rows[0].def.includes("'stale'")) {
          // Outdated status list - recreate with the full state machine set.
          await this.pool.query(`
            ALTER TABLE migration_history
            DROP CONSTRAINT IF EXISTS ${constraint.name}
          `);
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
    // Millisecond granularity: the version doubles as the unique
    // (connection_id, version) gate, so second-granularity versions let
    // sequential migrations within the same second collide.
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${yyyy}${MM}${dd}${HH}${mm}${ss}${ms}`;
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
        SELECT id, version, name, applied_at, created_at, status
        FROM migration_history
        WHERE connection_id = $1 AND status IN ${ACTIVE_STATUSES_SQL}
        ORDER BY created_at DESC
        LIMIT 1
      `, [cid]);
    
    if (existingRunning.rows.length > 0) {
      const stale = existingRunning.rows[0];
      const ageMs = Date.now() - new Date(stale.created_at).getTime();
      const ageMinutes = Math.round(ageMs / 60000);
      
      const statusThreshold = STATUS_STALE_MINUTES[stale.status];
      const staleThresholdMinutes = plan.staleThresholdMinutes || statusThreshold || STALE_THRESHOLD_MINUTES;
      
      if (ageMinutes < staleThresholdMinutes) {
        const error = new MigrationConflictError(
          `Cannot create migration: another migration is already running. ` +
          `Migration ID: ${stale.id}, version: ${stale.version}, ` +
          `status: ${stale.status}, started: ${stale.created_at} (${ageMinutes} minutes ago). ` +
          `Wait for it to complete or check for stale locks.`,
          {
            existingMigration: {
              id: stale.id,
              version: stale.version,
              name: stale.name,
              status: stale.status,
              createdAt: stale.created_at,
              ageMinutes,
              staleThresholdMinutes,
            },
            connectionId: cid,
          }
        );
        throw error;
      }
      
      console.warn(
        `[MigrationTable] Found stale migration (id: ${stale.id}, ` +
        `status: ${stale.status}, age: ${ageMinutes} minutes). Marking as failed and proceeding.`
      );
      
      await this.stateMachine.transition(stale.id, 'failed', {
        reason: 'stale_superseded',
        message: `Stale migration (${stale.status} for ${ageMinutes} minutes) - superseded by new migration`,
      }).catch((transitionError) => {
        // Terminal statuses (e.g. completed) cannot go to failed - only record the error.
        console.warn(`[MigrationTable] Could not mark stale migration as failed: ${transitionError.message}`);
      });
    }

    const version = this.generateVersion();
    const checksum = this.computeChecksum(plan);
    const upSql = this.generateUpSql(plan);

    if (plan.isIrreversible !== true) {
      // Engine-run plans carry the diff and generate rollback SQL from
      // executed changes at completion (buildRollbackSQL) - don't warn for
      // them.
      const hasRollbackSql = plan.rollbackSql || 
                             plan.down_sql || 
                             plan.rollbackSteps?.length > 0 ||
                             plan.steps?.some(s => s.rollbackSql || s.undoSql) ||
                             plan.diff?.changes?.length > 0;
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

    let result;
    try {
      result = await this.pool.query(`
      INSERT INTO migration_history (
        connection_id, version, name, checksum,
        up_sql, status, direction,
        schema_diff, sql_statements,
        risk_summary, warnings,
        change_count, create_count, alter_count, drop_count, rename_count,
        pg_version, engine_version,
        lock_pid, lock_key, lock_mode,
        created_at, status_changed_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, 'pending', $6,
        $7, $8,
        $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17,
        $18, $19, $20,
        now(), now()
      )
      ON CONFLICT (connection_id, version) DO UPDATE
      SET status = 'pending',
          status_previous = migration_history.status,
          status_changed_at = now(),
          up_sql = EXCLUDED.up_sql,
          checksum = EXCLUDED.checksum,
          schema_diff = EXCLUDED.schema_diff,
          sql_statements = EXCLUDED.sql_statements,
          created_at = now()
      WHERE migration_history.status IN ('failed', 'needs_review')
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
      plan.lockMode || 'transaction',
    ]);
    } catch (error) {
      // 23505 (unique violation) on (connection_id, version) with an ACTIVE
      // conflict row (not failed/needs_review) means the gate check and the
      // INSERT raced: a concurrent migration for this connection exists.
      // Surface it as the canonical concurrent-migration error instead of a
      // raw unique violation.
      if (error.code === '23505') {
        throw new MigrationConflictError(
          `Cannot create migration: a concurrent migration for connection ${cid} already exists ` +
          `(version ${version} is already active). ` +
          `Wait for the running migration to complete or reconcile stale records.`,
          {
            connectionId: cid,
            version,
            cause: error.constraint || error.message,
          }
        );
      }
      throw error;
    }

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

  /**
   * Activate a pending record into 'running' once the advisory lock is held.
   * Records the executor identity and heartbeat cadence for stale detection.
   * @param {string} recordId
   * @param {Object} [executorInfo]
   * @param {number} [executorInfo.executorPid]
   * @param {string} [executorInfo.executorHostname]
   * @param {number} [executorInfo.heartbeatIntervalMs]
   * @param {number} [executorInfo.lockPid]
   * @param {number} [executorInfo.phaseCount]
   * @param {number} [executorInfo.stepCount]
   */
  async activateRecord(recordId, executorInfo = {}) {
    return retryWithBackoff(async () => {
      await this.stateMachine.transition(recordId, 'running', {
        reason: 'lock_acquired',
        executor_pid: executorInfo.executorPid ?? process.pid,
        executor_hostname: executorInfo.executorHostname ?? os.hostname(),
        heartbeat_interval_ms: executorInfo.heartbeatIntervalMs ?? 30000,
        lock_pid: executorInfo.lockPid ?? null,
        phase_count: executorInfo.phaseCount ?? 0,
        step_count: executorInfo.stepCount ?? 0,
      });
    });
  }

  /**
   * Refresh the heartbeat timestamp and current position of a running migration.
   * Called at each phase boundary so stale detection can distinguish a live
   * migration from a crashed one.
   * @param {string} recordId
   * @param {Object} [details]
   * @param {number} [details.phase]
   * @param {string} [details.stepId]
   */
  async updateHeartbeat(recordId, details = {}) {
    if (!recordId) return;
    await this.pool.query(`
      UPDATE migration_history
      SET last_heartbeat_at = now(),
          current_phase = COALESCE($2::integer, current_phase),
          current_step_id = COALESCE($3::text, current_step_id)
      WHERE id = $1
    `, [recordId, details.phase ?? null, details.stepId ?? null]);
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

  /**
   * Persist an execution checkpoint (proposal v2 checkpointing).
   * Stored under metadata.checkpoint so a crashed process can resume or
   * reconcile from the exact cursor without scanning the execution log.
   * @param {string} recordId
   * @param {Object} checkpoint - { phase, stepId, completedSteps, stepsCompleted, ... }
   */
  async writeCheckpoint(recordId, checkpoint) {
    await this.pool.query(`
      UPDATE migration_history
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('checkpoint', $2::jsonb)
      WHERE id = $1
    `, [recordId, JSON.stringify(checkpoint)]);
  }

  /**
   * Read the last persisted checkpoint for a migration.
   * @param {string} recordId
   * @returns {Promise<Object|null>}
   */
  async getCheckpoint(recordId) {
    const result = await this.pool.query(`
      SELECT metadata->'checkpoint' AS checkpoint
      FROM migration_history
      WHERE id = $1
    `, [recordId]);
    return result.rows[0]?.checkpoint || null;
  }

  async completeRecord(recordId, execResult) {
    return retryWithBackoff(async () => {
    const status = this.mapExecutorStatus(execResult.status);
    const errorMessage = execResult.errors?.length > 0
      ? execResult.errors.map(e => `[${e.code || 'ERR'}] ${e.message}`).join('\n')
      : null;

    const currentStatus = await this.stateMachine.getStatus(recordId).catch(() => null);
    if (currentStatus && !this.stateMachine.canTransition(currentStatus, status)) {
      console.warn(
        `[MigrationTable] Skipping invalid status transition ${currentStatus} -> ${status} ` +
        `for migration ${recordId}. Storing result metadata only.`
      );
      await this.pool.query(`
        UPDATE migration_history
        SET execution_results = $1,
            snapshot_before = $2,
            snapshot_after = $3,
            rollback_sql = $4
        WHERE id = $5
      `, [
        JSON.stringify(execResult.intents || execResult.executionResults || {}),
        JSON.stringify(execResult.snapshotBefore || execResult.snapshots?.before || null),
        JSON.stringify(execResult.snapshotAfter || execResult.snapshots?.after || null),
        JSON.stringify(execResult.rollbackSteps || []),
        recordId,
      ]);
      return;
    }

    const warningPayload = execResult.warningReport
      ? JSON.stringify(execResult.warningReport.warnings || [])
      : execResult.warningsAcknowledged
        ? JSON.stringify(execResult.warningsAcknowledged)
        : null;

    const dataLossAck = execResult.dataLossAcknowledged === true;

    // Bare $1 keeps the parameter contextually typed by the status column
    // (varchar on legacy tables, migration_status after the enum migration) -
    // an explicit ::text cast breaks on the enum column. The final-status
    // checks are precomputed as a boolean to avoid a second, possibly
    // conflicting inference of $1 (which used to raise 42P08).
    const isFinalStatus = ['completed', 'partially_applied'].includes(status);

    await this.pool.query(`
      UPDATE migration_history
      SET status = $1,
          status_previous = status,
          status_changed_at = now(),
          execution_time_ms = $2,
          error_message = $3,
          execution_results = $4,
          snapshot_before = $5,
          snapshot_after = $6,
          rollback_sql = $7,
          warnings_acknowledged = COALESCE($9, warnings_acknowledged),
          data_loss_acknowledged = CASE WHEN $10::boolean THEN TRUE ELSE data_loss_acknowledged END,
          completed_at = CASE WHEN $12::boolean THEN now() ELSE completed_at END,
          applied_at = CASE WHEN $12::boolean THEN now() ELSE applied_at END,
          last_heartbeat_at = CASE WHEN $12::boolean THEN now() ELSE last_heartbeat_at END,
          last_error = $11
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
      errorMessage,
      isFinalStatus,
    ]);
    });
  }

  async failRecord(recordId, error, executedSteps = []) {
    return retryWithBackoff(async () => {
      const errorMessage = error.message || String(error);
      const pgError = error.code ? `[${error.code}] ` : '';
      
      const retryMetadata = error.retryMetadata || {};
      const connectionRecovery = error.connectionRecovery || null;

      const currentStatus = await this.stateMachine.getStatus(recordId).catch(() => null);
      if (currentStatus && !this.stateMachine.canTransition(currentStatus, 'failed')) {
        // Terminal statuses (completed, rolled_back) must not be downgraded.
        console.warn(
          `[MigrationTable] Skipping status change ${currentStatus} -> failed for migration ${recordId}. ` +
          `Recording error details only.`
        );
        await this.pool.query(`
          UPDATE migration_history
          SET error_message = $1,
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE id = $3
        `, [
          pgError + errorMessage,
          JSON.stringify({
            error_after_terminal: true,
            previous_status: currentStatus,
            executedSteps,
            error: {
              message: errorMessage,
              code: error.code,
              retryCount: retryMetadata.attempts || 0,
              backoffs: retryMetadata.backoffs || [],
            },
          }),
          recordId,
        ]);
        return;
      }

      await this.pool.query(`
        UPDATE migration_history
        SET status = 'failed',
            status_previous = status,
            status_changed_at = now(),
            error_message = $1,
            execution_results = $2,
            retry_count = GREATEST(COALESCE(retry_count, 0), $3::integer),
            last_error = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
        WHERE id = $5
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
        retryMetadata.attempts || 0,
        JSON.stringify({
          retry_backoffs_ms: retryMetadata.backoffs || [],
          connection_recovered: connectionRecovery?.state === 'fully_applied',
        }),
        recordId,
      ]);
    });
  }

  async markRolledBack(recordId, rolledBackBy = null) {
    const current = await this.stateMachine.getStatus(recordId).catch(() => null);

    if (!current) {
      throw new StorageError(`Migration record ${recordId} not found`);
    }

    if (current === 'rolled_back') {
      return;
    }

    // Already in rolling_back (engine.rollback transitions before executing):
    // complete the transition to rolled_back directly.
    if (current === 'rolling_back') {
      await this.stateMachine.transition(recordId, 'rolled_back', {
        reason: 'manual_rollback_complete',
        rolled_back_by: rolledBackBy,
      });
      return;
    }

    // completed/failed/needs_review/stale/partially_applied -> rolling_back -> rolled_back
    if (this.stateMachine.canTransition(current, 'rolling_back')) {
      await this.stateMachine.transition(recordId, 'rolling_back', {
        reason: 'manual_rollback',
        rolled_back_by: rolledBackBy,
      });
    } else {
      console.warn(
        `[MigrationTable] Cannot mark migration ${recordId} (status ${current}) as rolled back. ` +
        `Rollback is only valid from completed/failed/needs_review/stale/partially_applied.`
      );
      return;
    }

    await this.stateMachine.transition(recordId, 'rolled_back', {
      reason: 'manual_rollback_complete',
      rolled_back_by: rolledBackBy,
    });
  }

  /**
   * Generic record update used by recovery paths (e.g. connection-drop
   * recovery where the DDL committed but the app lost the connection).
   *
   * Status changes are routed through the state machine when the transition
   * is valid; otherwise the update is forced (recovery escape hatch) so a
   * committed migration is never left stuck in 'running'.
   *
   * @param {string} recordId
   * @param {Object} updates - Column values; unknown keys go to metadata JSONB
   */
  async updateRecord(recordId, updates = {}) {
    const { status, ...rest } = updates;

    if (status) {
      const mapped = this.mapExecutorStatus(status);
      const current = await this.stateMachine.getStatus(recordId).catch(() => null);

      if (current && this.stateMachine.canTransition(current, mapped)) {
        await this.stateMachine.transition(recordId, mapped, {
          reason: 'recovery_update',
          ...rest,
        });
        return;
      }

      console.warn(
        `[MigrationTable] updateRecord: transition ${current} -> ${mapped} not allowed for ` +
        `migration ${recordId}; forcing update (recovery path).`
      );
    }

    const sets = [];
    const params = [];
    let index = 1;
    const jsonMeta = {};

    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      if (['error_message', 'last_error', 'execution_results', 'completed_at',
           'applied_at', 'last_heartbeat_at', 'reconcile_count', 'retry_count'].includes(key)) {
        sets.push(`${key} = $${index++}`);
        params.push(value);
      } else {
        jsonMeta[key] = value;
      }
    }

    if (status) {
      sets.push('status = $' + index++);
      params.push(this.mapExecutorStatus(status));
      sets.push('status_previous = status');
      sets.push('status_changed_at = now()');
    }

    if (Object.keys(jsonMeta).length > 0) {
      sets.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${index++}::jsonb`);
      params.push(JSON.stringify(jsonMeta));
    }

    if (sets.length === 0) return;

    params.push(recordId);
    await this.pool.query(`
      UPDATE migration_history
      SET ${sets.join(', ')}
      WHERE id = $${index}
    `, params);
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

  /**
   * Full per-step execution trace for a migration (from migration_execution_log).
   * @param {string} migrationId
   * @returns {Promise<Array<Object>>}
   */
  async getExecutionTrace(migrationId) {
    return this.executionLog.getTrace(migrationId);
  }

  /**
   * Per-step status rollup for a migration (from migration_execution_log).
   * @param {string} migrationId
   * @returns {Promise<Array<Object>>}
   */
  async getExecutionStepSummary(migrationId) {
    return this.executionLog.getStepSummary(migrationId);
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
    // sql_statements is a JSONB column: node-postgres already parses it into
    // a JS array, so tolerate both shapes.
    const raw = migration.sql_statements;
    const stepsRaw = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
    const steps = stepsRaw.map((s, i) => ({
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
        execution_results,
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
