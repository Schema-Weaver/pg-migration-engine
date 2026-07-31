/**
 * Schema Weaver Migration Engine - Migration State Machine
 * https://schemaweaver.vivekmind.com/
 *
 * Enforces valid status transitions on migration_history records.
 * All status changes should be routed through this class so that:
 *   - Invalid transitions are rejected (e.g. completed -> running)
 *   - status_previous / status_changed_at stay accurate
 *   - started_at / completed_at / applied_at are set at the right moment
 *   - last_heartbeat_at is refreshed while a migration is active
 *   - stale migrations (heartbeat timeout) can be detected and reconciled
 */
import { StorageError } from '../errors.js';

/**
 * Statuses that count as "actively executing" - used for the
 * one-active-migration-per-connection guard and stale detection.
 */
export const ACTIVE_STATUSES = [
  'pending',
  'acquiring_lock',
  'running',
  'verifying',
  'completing',
];

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const STALE_MULTIPLIER = 3;
const STALE_PENDING_MINUTES = 5;
const STALE_LEGACY_MINUTES = 30;

export class MigrationStateMachine {
  /**
   * Valid transitions between migration statuses.
   * Key: current status -> list of allowed target statuses.
   */
  static VALID_TRANSITIONS = {
    pending: ['acquiring_lock', 'stale', 'failed'],
    acquiring_lock: ['running', 'failed', 'stale'],
    running: ['verifying', 'failed', 'stale', 'needs_review', 'completed'],
    verifying: ['completing', 'failed', 'stale'],
    completing: ['completed', 'partially_applied', 'failed', 'stale'],
    completed: ['rolling_back'],
    failed: ['pending', 'rolling_back'],
    rolling_back: ['rolled_back', 'failed'],
    rolled_back: [],
    stale: ['needs_review', 'pending', 'failed', 'completed', 'rolling_back'],
    needs_review: ['pending', 'completed', 'failed', 'rolling_back'],
    partially_applied: ['pending', 'failed', 'rolled_back', 'rolling_back'],
  };

  /**
   * @param {import('pg').Pool} pool
   */
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Check whether a transition is allowed.
   * @param {string} from
   * @param {string} to
   * @returns {boolean}
   */
  canTransition(from, to) {
    if (!from || !to) return false;
    return (MigrationStateMachine.VALID_TRANSITIONS[from] || []).includes(to);
  }

  /**
   * Get all statuses a migration may transition to.
   * @param {string} status
   * @returns {string[]}
   */
  getValidTransitions(status) {
    return [...(MigrationStateMachine.VALID_TRANSITIONS[status] || [])];
  }

  /**
   * Get the current status of a migration record.
   * @param {string} recordId
   * @returns {Promise<string|null>}
   */
  async getStatus(recordId) {
    const row = await this.getStatusRow(recordId);
    return row ? row.status : null;
  }

  /**
   * Get the full status-tracking row for a migration record.
   * @param {string} recordId
   * @returns {Promise<Object|null>}
   */
  async getStatusRow(recordId) {
    const result = await this.pool.query(`
      SELECT id, status, status_previous, status_changed_at,
             created_at, last_heartbeat_at, heartbeat_interval_ms
      FROM migration_history
      WHERE id = $1
    `, [recordId]);
    return result.rows[0] || null;
  }

  /**
   * Transition a migration record to a new status with validation.
   *
   * Known column fields in metadata are mapped to their columns; anything
   * else is merged into the metadata JSONB.
   *
   * @param {string} recordId
   * @param {string} newStatus
   * @param {Object} [metadata]
   * @returns {Promise<{from: string, to: string, recordId: string}>}
   */
  async transition(recordId, newStatus, metadata = {}) {
    const row = await this.getStatusRow(recordId);
    if (!row) {
      throw new StorageError(`Migration record ${recordId} not found`);
    }

    const current = row.status;
    if (!this.canTransition(current, newStatus)) {
      throw new StorageError(
        `Invalid state transition: ${current} -> ${newStatus}. ` +
        `Valid transitions from ${current}: ${this.getValidTransitions(current).join(', ') || '(none)'}`
      );
    }

    const columnFields = [
      'lock_pid', 'lock_key', 'executor_pid', 'executor_hostname',
      'heartbeat_interval_ms', 'phase_count', 'step_count',
      'current_phase', 'current_step_id',
    ];
    const sets = [];
    const params = [];
    let index = 1;

    sets.push('status = $1');
    sets.push('status_previous = status');
    sets.push('status_changed_at = now()');
    params.push(newStatus);
    index = 2;

    // Active statuses refresh the heartbeat on every transition.
    if (ACTIVE_STATUSES.includes(newStatus)) {
      sets.push('last_heartbeat_at = now()');
    }

    if (newStatus === 'running') {
      sets.push('started_at = COALESCE(started_at, now())');
    }

    if (['completed', 'partially_applied'].includes(newStatus)) {
      sets.push('completed_at = now()');
      sets.push('applied_at = COALESCE(applied_at, now())');
    }

    if (newStatus === 'failed' && metadata.error) {
      sets.push(`last_error = $${index++}`);
      params.push(String(metadata.error).slice(0, 4000));
    }

    if (newStatus === 'stale') {
      sets.push('reconcile_count = COALESCE(reconcile_count, 0) + 1');
    }

    for (const field of columnFields) {
      if (metadata[field] !== undefined && metadata[field] !== null) {
        sets.push(`${field} = $${index++}`);
        params.push(metadata[field]);
      }
    }

    const jsonFields = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (columnFields.includes(key)) continue;
      if (key === 'error' || key === 'reason') continue;
      jsonFields[key] = value;
    }
    if (metadata.reason) jsonFields.reason = metadata.reason;

    if (Object.keys(jsonFields).length > 0) {
      sets.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${index++}::jsonb`);
      params.push(JSON.stringify(jsonFields));
    }

    params.push(recordId);
    await this.pool.query(`
      UPDATE migration_history
      SET ${sets.join(', ')}
      WHERE id = $${index}
    `, params);

    return { from: current, to: newStatus, recordId };
  }

  /**
   * Find migration records whose heartbeat has gone stale
   * (or that are too old for their current stage).
   *
   * Legacy records without a heartbeat (last_heartbeat_at IS NULL) fall back
   * to created_at with the old 30-minute threshold.
   *
   * @param {import('pg').Pool} [pool]
   * @param {string} [connectionId] - Restrict to one connection; null = all
   * @param {Date} [now]
   * @returns {Promise<Array<Object>>} Stale migration rows
   */
  async findStale(pool, connectionId = null, now = new Date()) {
    const usePool = pool || this.pool;
    const params = [];
    let where = `status IN ('acquiring_lock', 'running', 'verifying', 'completing')`;
    if (connectionId) {
      where += ` AND connection_id = $1`;
      params.push(connectionId);
    }

    const result = await usePool.query(`
      SELECT id, connection_id, status, version, name, created_at,
             last_heartbeat_at, heartbeat_interval_ms,
             schema_diff, sql_statements, execution_results
      FROM migration_history
      WHERE ${where}
    `, params);

    return result.rows.filter((m) => {
      if (m.status === 'pending') {
        // Pending records should become running quickly (lock acquisition).
        // After 5 minutes they are considered abandoned.
        const ageMs = now.getTime() - new Date(m.created_at).getTime();
        return ageMs > STALE_PENDING_MINUTES * 60 * 1000;
      }

      if (!m.last_heartbeat_at) {
        // Legacy record - fall back to created_at with the old threshold.
        const ageMs = now.getTime() - new Date(m.created_at).getTime();
        return ageMs > STALE_LEGACY_MINUTES * 60 * 1000;
      }

      const intervalMs = m.heartbeat_interval_ms || DEFAULT_HEARTBEAT_INTERVAL_MS;
      const ageMs = now.getTime() - new Date(m.last_heartbeat_at).getTime();
      return ageMs > intervalMs * STALE_MULTIPLIER;
    });
  }

  /**
   * Timeout helper used by consumers to compute stale thresholds.
   */
  static getStaleThresholdMs(status, heartbeatIntervalMs) {
    if (status === 'pending') {
      return STALE_PENDING_MINUTES * 60 * 1000;
    }
    return (heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS) * STALE_MULTIPLIER;
  }
}
