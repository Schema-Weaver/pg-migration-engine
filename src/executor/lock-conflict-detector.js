/**
 * Schema Weaver Migration Engine - Lock Conflict Detector
 * https://schemaweaver.vivekmind.com/
 *
 * Concurrent-DDL monitoring: before each migration phase we check pg_locks +
 * pg_stat_activity for relation-level AccessExclusiveLock / ExclusiveLock
 * conflicts held by OTHER backends (a second tool running DDL on the same
 * database) and for long-running queries that could block DDL.
 *
 * The advisory lock only serializes migrations using this engine; it does not
 * protect against foreign writers. This detector closes that gap.
 *
 * Modes (config.concurrentDdlMode):
 *   'off'   - no detection
 *   'warn'  - (default) emit warnings / progress events, continue
 *   'block' - abort the migration with a MigrationConflictError
 */

export class LockConflictDetector {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Detect lock conflicts and long-running queries on OTHER backends.
   * Rows without a real pid (e.g. background workers, fake pools in tests)
   * are ignored so the check never produces phantom conflicts.
   *
   * @param {Object} [options]
   * @param {number|null} [options.excludePid] - Own backend pid to exclude
   * @param {number} [options.longQuerySeconds] - Threshold for long queries
   * @returns {Promise<{conflicts: Array, cautions: Array, detected: boolean}>}
   */
  async detect(options = {}) {
    const { excludePid = null, longQuerySeconds = 30 } = options;
    const ownPid = excludePid || 0;

    const conflicts = [];
    const cautions = [];

    try {
      const lockResult = await this.pool.query(`
        SELECT
          l.pid,
          l.mode,
          l.granted,
          COALESCE(n.nspname, '') AS schema_name,
          COALESCE(c.relname, '') AS object_name,
          LEFT(a.query, 200) AS query,
          a.state
        FROM pg_locks l
        LEFT JOIN pg_class c ON c.oid = l.relation
        LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.pid IS DISTINCT FROM $1::int
          AND l.locktype IN ('relation', 'tuple', 'page')
          AND l.mode IN ('AccessExclusiveLock', 'ExclusiveLock', 'ShareUpdateExclusiveLock')
          AND l.granted = true
        ORDER BY l.mode
      `, [ownPid]);

      for (const row of lockResult.rows || []) {
        const pid = Number(row.pid);
        if (!Number.isFinite(pid) || pid <= 0) continue;

        conflicts.push({
          pid,
          mode: row.mode,
          schema: row.schema_name || null,
          object: row.object_name || null,
          query: row.query || null,
          state: row.state || null,
          kind: 'lock_conflict',
        });
      }
    } catch (error) {
      // Detection must never break a migration: degrade to a caution.
      cautions.push({
        kind: 'detection_error',
        message: `Lock conflict detection failed: ${error.message}`,
      });
    }

    try {
      const activityResult = await this.pool.query(`
        SELECT
          pid,
          state,
          LEFT(query, 200) AS query,
          EXTRACT(EPOCH FROM now() - query_start)::int AS duration_seconds
        FROM pg_stat_activity
        WHERE pid IS DISTINCT FROM $1::int
          AND state = 'active'
          AND now() - query_start > ($2::int || ' seconds')::interval
          AND query NOT ILIKE '%pg_stat_activity%'
          AND query NOT ILIKE '%pg_locks%'
        ORDER BY query_start
      `, [ownPid, longQuerySeconds]);

      for (const row of activityResult.rows || []) {
        const pid = Number(row.pid);
        if (!Number.isFinite(pid) || pid <= 0) continue;

        cautions.push({
          pid,
          state: row.state || null,
          query: row.query || null,
          durationSeconds: row.duration_seconds ?? null,
          kind: 'long_running_query',
        });
      }
    } catch (error) {
      cautions.push({
        kind: 'detection_error',
        message: `Long-running query detection failed: ${error.message}`,
      });
    }

    return {
      conflicts,
      cautions,
      detected: conflicts.length > 0,
    };
  }

  /**
   * Build a human-readable summary of the detection result.
   * @param {{conflicts: Array, cautions: Array}} detection
   * @returns {string}
   */
  static summarize(detection) {
    const lines = [];
    for (const c of detection.conflicts || []) {
      lines.push(
        `pid ${c.pid} holds ${c.mode} on ${c.schema ? c.schema + '.' : ''}${c.object || '?'}` +
        (c.query ? ` (${c.query.slice(0, 80)})` : '')
      );
    }
    for (const c of detection.cautions || []) {
      if (c.kind === 'long_running_query') {
        lines.push(`pid ${c.pid} has a query running ${c.durationSeconds}s`);
      } else if (c.kind === 'detection_error') {
        lines.push(c.message);
      }
    }
    return lines.join('\n');
  }
}
