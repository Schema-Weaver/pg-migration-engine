/**
 * Schema Weaver Migration Engine - Execution Log
 * https://schemaweaver.vivekmind.com/
 *
 * Fine-grained per-step execution log for debugging and recovery.
 * Each migration step writes a row per status transition (intent/pending,
 * completed, failed, skipped) into migration_execution_log.
 *
 * Best-effort by design: logging failures must never break a migration.
 */

import crypto from 'crypto';

export class ExecutionLog {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Create the log table and indexes if they do not exist.
   * @returns {Promise<void>}
   */
  async ensureTable() {
    const existsCheck = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'migration_execution_log'
      )
    `;

    const createLogTable = async () => {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS migration_execution_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          migration_id UUID NOT NULL,
          step_id VARCHAR(100) NOT NULL,
          phase INTEGER NOT NULL,

          started_at TIMESTAMPTZ NOT NULL,
          completed_at TIMESTAMPTZ,
          duration_ms INTEGER,

          sql_statement TEXT NOT NULL,
          sql_hash VARCHAR(64),

          status VARCHAR(20) NOT NULL,
          rows_affected INTEGER,

          error_code VARCHAR(10),
          error_message TEXT,
          error_severity VARCHAR(20),

          retry_count INTEGER DEFAULT 0,
          retry_backoffs INTEGER[],

          is_transactional BOOLEAN,
          pre_check_result JSONB,
          post_check_result JSONB,

          created_at TIMESTAMPTZ DEFAULT now()
        )
      `);
    };

    const exists = await this.pool.query(existsCheck);
    if (!exists.rows[0].exists) {
      // Concurrent callers can race the identical CREATE TABLE in the PG
      // catalog (23505 on pg_type_typname_nsp_index). Retry, re-checking
      // existence between attempts.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await createLogTable();
          break;
        } catch (error) {
          if (error.code !== '23505') throw error;
          const recheck = await this.pool.query(existsCheck);
          if (recheck.rows[0].exists) break;
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    }

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_execution_log_migration
      ON migration_execution_log(migration_id)
    `).catch(() => {});

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_execution_log_step
      ON migration_execution_log(migration_id, step_id)
    `).catch(() => {});
  }

  /**
   * Write one log entry for a step.
   * All fields are optional except migrationId, stepId, phase and status.
   *
   * @param {Object} entry
   * @param {string} entry.migrationId
   * @param {string} entry.stepId
   * @param {number} entry.phase
   * @param {'pending'|'intent'|'completed'|'failed'|'skipped'} entry.status
   * @param {string} [entry.sql]
   * @param {Date} [entry.startedAt]
   * @param {Date} [entry.completedAt]
   * @param {number} [entry.durationMs]
   * @param {number} [entry.rowsAffected]
   * @param {string} [entry.errorCode]
   * @param {string} [entry.errorMessage]
   * @param {string} [entry.errorSeverity]
   * @param {number} [entry.retryCount]
   * @param {number[]} [entry.retryBackoffs]
   * @param {boolean} [entry.isTransactional]
   * @param {Object} [entry.preCheckResult]
   * @param {Object} [entry.postCheckResult]
   * @returns {Promise<Object>} The inserted row
   */
  async logStep(entry) {
    const sqlHash = entry.sql
      ? crypto.createHash('sha256').update(entry.sql).digest('hex')
      : null;

    const startedAt = entry.startedAt || new Date();

    const result = await this.pool.query(`
      INSERT INTO migration_execution_log (
        migration_id, step_id, phase,
        started_at, completed_at, duration_ms,
        sql_statement, sql_hash,
        status, rows_affected,
        error_code, error_message, error_severity,
        retry_count, retry_backoffs,
        is_transactional, pre_check_result, post_check_result
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8,
        $9, $10,
        $11, $12, $13,
        $14, $15,
        $16, $17, $18
      )
      RETURNING *
    `, [
      entry.migrationId,
      entry.stepId,
      entry.phase ?? 0,
      startedAt,
      entry.completedAt || null,
      entry.durationMs ?? null,
      entry.sql || '',
      sqlHash,
      entry.status,
      entry.rowsAffected ?? null,
      entry.errorCode || null,
      entry.errorMessage || null,
      entry.errorSeverity || null,
      entry.retryCount ?? 0,
      entry.retryBackoffs || null,
      entry.isTransactional ?? null,
      entry.preCheckResult ? JSON.stringify(entry.preCheckResult) : null,
      entry.postCheckResult ? JSON.stringify(entry.postCheckResult) : null,
    ]);

    return result.rows[0];
  }

  /**
   * Full execution trace for a migration, oldest first.
   * @param {string} migrationId
   * @returns {Promise<Array<Object>>}
   */
  async getTrace(migrationId) {
    const result = await this.pool.query(`
      SELECT
        step_id, phase, status,
        started_at, completed_at, duration_ms,
        rows_affected,
        error_code, error_message, error_severity,
        retry_count, retry_backoffs,
        is_transactional
      FROM migration_execution_log
      WHERE migration_id = $1
      ORDER BY started_at, created_at
    `, [migrationId]);
    return result.rows;
  }

  /**
   * Status rollup per step for a migration.
   * @param {string} migrationId
   * @returns {Promise<Array<Object>>}
   */
  async getStepSummary(migrationId) {
    const result = await this.pool.query(`
      SELECT step_id, phase,
        MAX(status) FILTER (WHERE status = 'failed') IS NOT NULL AS failed,
        MAX(status) FILTER (WHERE status = 'completed') IS NOT NULL AS completed,
        MAX(status) FILTER (WHERE status = 'skipped') IS NOT NULL AS skipped,
        MAX(duration_ms) AS duration_ms,
        SUM(rows_affected) AS rows_affected
      FROM migration_execution_log
      WHERE migration_id = $1
      GROUP BY step_id, phase
      ORDER BY phase, MIN(started_at)
    `, [migrationId]);
    return result.rows;
  }
}
