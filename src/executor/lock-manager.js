/**
 * Schema Weaver Migration Engine - Lock Manager v2
 * https://schemaweaver.vivekmind.com/
 * 
 * Thread-safe advisory lock management for PostgreSQL migrations.
 *
 * v2 changes:
 *  - Configurable lock modes: 'blocking' (wait), 'try' (immediate), 'queue' (FIFO)
 *  - Transaction-scoped advisory locks (pg_advisory_xact_lock) for phase
 *    transactions via acquireXactLock() - auto-release on COMMIT/ROLLBACK
 *  - Database-level heartbeat (pg_locks + pg_backend_pid) to detect silent
 *    connection loss instead of trusting the in-memory map
 *  - Session-level lock still spans the whole migration (see acquire())
 */
import crypto from 'crypto';
import { LockAcquisitionError } from '../errors.js';

const VALID_MODES = ['blocking', 'try', 'queue'];

export class LockManager {
  isLocked = false;
  lockId = null;
  connectionId = null;
  _heartbeatTimer = null;
  _releasingLocks = new Set(); // Guard against concurrent releases
  _queues = new Map();          // lockKey -> FIFO waiters for 'queue' mode

  constructor(pool, options = {}) {
    this.pool = pool;
    this.locks = new Map();
    this.connectionId = options.connectionId || null;
    this.lockId = this.computeLockKey(this.connectionId);
    this.mode = VALID_MODES.includes(options.mode) ? options.mode : 'blocking';
  }

  /**
   * Compute a 64-bit lock key from connectionId.
   * Uses SHA-256 and combines two 32-bit values for better uniqueness.
   * Returns a string that PostgreSQL can use with pg_advisory_lock(bigint).
   */
  computeLockKey(connectionId) {
    if (!connectionId) {
      throw new Error(
        'connectionId is required for lock key computation. ' +
        'Using a default lock key would cause cross-database lock conflicts.'
      );
    }

    if (typeof connectionId !== 'string' || connectionId.length === 0) {
      throw new Error(
        `connectionId must be a non-empty string, got: ${typeof connectionId}`
      );
    }

    const hash = crypto.createHash('sha256')
      .update(`schema-weaver-lock:${connectionId}`)
      .digest();

    const BIGINT_MAX = 9223372036854775807n;
    const lockKey = (BigInt(hash.readUInt32BE(0)) << 31n) | BigInt(hash.readUInt32BE(4));
    const clampedKey = lockKey > BIGINT_MAX ? lockKey % (BIGINT_MAX + 1n) : lockKey;
    return clampedKey.toString();
  }

  /**
   * Acquire the session-level advisory lock that spans the whole migration.
   *
   * Lock modes:
   *  - 'blocking': `pg_advisory_lock` - waits until acquired or lock_timeout (55P03)
   *  - 'try':      `pg_try_advisory_lock` - immediate success or fail
   *  - 'queue':    FIFO in-process queue per lockKey, then blocking acquire;
   *                the next waiter is granted a turn when the holder releases.
   *
   * Returns true if acquired, false if it could not be acquired within timeout.
   */
  async acquire(lockKey, timeout, mode) {
    const effectiveKey = lockKey || this.lockId;
    const effectiveMode = VALID_MODES.includes(mode) ? mode : (this.mode || 'blocking');

    // Re-acquire guard: for blocking/try modes a second acquire of a lock we
    // already hold is a no-op. In queue mode, same-instance callers must join
    // the FIFO queue and wait for the current holder to release.
    if (effectiveMode !== 'queue' && this.locks.has(effectiveKey)) {
      console.warn(
        `[LockManager] Attempt to re-acquire lock ${effectiveKey} ` +
        `that is already held by this instance. Lock was acquired at: ` +
        `${this.locks.get(effectiveKey)?.acquiredAt || 'unknown'}`
      );
      return true;
    }

    if (effectiveMode === 'queue') {
      await this._acquireQueueTurn(effectiveKey, this._timeoutToMs(timeout));
    }

    const client = await this.pool.connect();

    try {
      if (timeout) {
        const sanitizedTimeout = this._sanitizeTimeout(timeout);
        await client.query(`SET lock_timeout = '${sanitizedTimeout}'`);
      }

      let acquired = false;

      if (effectiveMode === 'try') {
        const result = await client.query(
          'SELECT pg_try_advisory_lock($1) as acquired',
          [effectiveKey]
        );
        acquired = result.rows[0].acquired;
      } else {
        // blocking / queue: lock_timeout applies -> 55P03 on timeout
        try {
          await client.query('SELECT pg_advisory_lock($1)', [effectiveKey]);
          acquired = true;
        } catch (error) {
          if (error.code === '55P03') {
            acquired = false;
          } else {
            throw error;
          }
        }
      }

      if (acquired) {
        this.isLocked = true;
        this.lockId = effectiveKey;
        this.locks.set(effectiveKey, {
          acquiredAt: new Date().toISOString(),
          client,
          key: effectiveKey,
        });
      } else {
        client.release();
        // Pass the FIFO turn along when we could not take the lock.
        if (effectiveMode === 'queue') this._dequeueNext(effectiveKey);
      }

      return acquired;

    } catch (error) {
      console.error(
        `[LockManager] Error during lock acquisition: ${error.message}`,
        { lockKey: effectiveKey, code: error.code }
      );

      client.release();
      if (effectiveMode === 'queue') this._dequeueNext(effectiveKey);
      throw error;
    }
  }

  /**
   * Acquire advisory lock (blocking with timeout).
   * Backward-compatible alias for mode 'blocking'.
   */
  async acquireAndWait(lockKey, timeout) {
    return this.acquire(lockKey, timeout, 'blocking');
  }

  /**
   * Get the dedicated client holding the session-level advisory lock.
   * Phase transactions run on this client so the transaction-scoped lock
   * of the same key is acquired in the SAME session (advisory locks of one
   * key conflict across sessions, so a separate client would block itself).
   * @param {string} [lockKey]
   * @returns {import('pg').PoolClient|null}
   */
  getLockClient(lockKey) {
    const effectiveKey = lockKey || this.lockId;
    return this.locks.get(effectiveKey)?.client || null;
  }

  /**
   * Acquire a transaction-scoped advisory lock on an open transaction client.
   *
   * The lock auto-releases when the transaction COMMITs or ROLLBACKs, so a
   * crashed process can never leave a dangling phase lock, and concurrent
   * DDL writers are blocked for the exact duration of the DDL transaction.
   *
   * Must be called after BEGIN while lock_timeout is set (SET LOCAL).
   *
   * @param {import('pg').PoolClient} client - Open transaction client
   * @param {string} lockKey
   * @param {'blocking'|'try'|'queue'} [mode]
   * @returns {Promise<boolean>}
   */
  async acquireXactLock(client, lockKey, mode) {
    if (!lockKey) return true;
    const effectiveMode = VALID_MODES.includes(mode) ? mode : (this.mode || 'blocking');

    if (effectiveMode === 'try') {
      const result = await client.query(
        'SELECT pg_try_advisory_xact_lock($1) AS acquired',
        [lockKey]
      );
      if (!result.rows[0].acquired) {
        throw new LockAcquisitionError(
          `Transaction-scoped advisory lock ${lockKey} could not be acquired (try mode). ` +
          `Another transaction may be modifying this database concurrently.`,
          { lockKey }
        );
      }
      return true;
    }

    // blocking / queue: respects the transaction's lock_timeout (55P03 on timeout)
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    return true;
  }

  /**
   * FIFO gate for 'queue' mode.
   *
   * Per-lockKey state tracks an active holder token plus a FIFO waiter list:
   *  - no holder and no waiters: resolves immediately (caller becomes active)
   *  - holder exists: caller is appended and resolves when _dequeueNext()
   *    passes the turn (on release or on a failed acquire)
   */
  _acquireQueueTurn(lockKey, timeoutMs) {
    let entry = this._queues.get(lockKey);
    if (!entry) {
      entry = { active: false, waiters: [] };
      this._queues.set(lockKey, entry);
    }

    if (!entry.active && entry.waiters.length === 0) {
      entry.active = true;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      entry.waiters.push(waiter);

      if (timeoutMs) {
        waiter.timer = setTimeout(() => {
          const idx = entry.waiters.indexOf(waiter);
          if (idx >= 0) entry.waiters.splice(idx, 1);
          if (entry.waiters.length === 0) entry.active = false;
          reject(new LockAcquisitionError(
            `Timed out waiting in lock queue for key ${lockKey} after ${timeoutMs}ms`,
            { lockKey }
          ));
        }, timeoutMs);
      }
    });
  }

  /**
   * Grant the next FIFO waiter its turn (called on release or failed acquire).
   * If no one is waiting, the gate is opened for the next caller.
   */
  _dequeueNext(lockKey) {
    const entry = this._queues.get(lockKey);
    if (!entry) return;

    const next = entry.waiters.shift();
    if (next) {
      if (next.timer) clearTimeout(next.timer);
      next.resolve();
      // The waiter becomes the active holder; it will call acquire next.
    } else {
      entry.active = false;
    }
  }

  /**
   * Convert a timeout ('5s', 5000, '500ms') to milliseconds.
   */
  _timeoutToMs(timeout) {
    if (!timeout) return 0;
    if (typeof timeout === 'number') return timeout;
    const match = /^(\d+(\.\d+)?)\s*(ms|s|min|h)?$/i.exec(String(timeout));
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = (match[3] || 'ms').toLowerCase();
    const multipliers = { ms: 1, s: 1000, min: 60000, h: 3600000 };
    return Math.floor(value * multipliers[unit]);
  }

  /**
   * Release advisory lock.
   * Only releases locks held by this instance.
   */
  async release(lockKey) {
    const effectiveKey = lockKey || this.lockId;
    
    if (this._releasingLocks.has(effectiveKey)) {
      console.warn(
        `[LockManager] Concurrent release attempt for lock ${effectiveKey}, ignoring`
      );
      return false;
    }
    
    this._releasingLocks.add(effectiveKey);
    this.stopHeartbeat();

    try {
      const lockInfo = this.locks.get(effectiveKey);

      if (!lockInfo) {
        console.debug(
          `[LockManager] Lock ${effectiveKey} not found in local map. ` +
          `It may have been released already or was never acquired by this instance.`
        );
        this.isLocked = this.locks.size > 0;
        this.lockId = this.locks.size > 0 ? [...this.locks.keys()][0] : null;
        return false;
      }

      const { client } = lockInfo;

      try {
        await client.query('SELECT pg_advisory_unlock($1)', [effectiveKey]);
        this.locks.delete(effectiveKey);
        this.isLocked = this.locks.size > 0;
        this.lockId = this.locks.size > 0 ? [...this.locks.keys()][0] : null;
        // Grant the next FIFO waiter its turn (queue mode)
        this._dequeueNext(effectiveKey);
        return true;
      } catch (error) {
        console.error(
          `[LockManager] Error releasing lock ${effectiveKey}: ${error.message}`
        );
        this.locks.delete(effectiveKey);
        this.isLocked = false;
        this.lockId = null;
        return false;
      } finally {
        client.release();
      }
    } finally {
      this._releasingLocks.delete(effectiveKey);
    }
  }

  /**
   * Check if lock is held by anyone.
   * Uses pg_locks view to avoid actually acquiring the lock.
   */
  async isLocked(lockKey) {
    const effectiveKey = lockKey || this.lockId;
    const selfHeld = this.locks.has(effectiveKey);

    if (selfHeld) {
      return { held: true, heldBySelf: true };
    }

    // Query pg_locks to check without acquiring
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND objid = $1`,
      [effectiveKey]
    );

    const isHeldByAnyone = result.rows[0].count > 0;
    return { 
      held: isHeldByAnyone, 
      heldBySelf: false 
    };
  }

  /**
   * Quick in-memory check if this instance holds the lock.
   */
  isHeldBySelf(lockKey) {
    const effectiveKey = lockKey || this.lockId;
    return this.locks.has(effectiveKey);
  }

  /**
   * Release all locks held by this instance.
   */
  async releaseAll() {
    let count = 0;
    const lockKeys = [...this.locks.keys()];

    for (const lockKey of lockKeys) {
      try {
        const released = await this.release(lockKey);
        if (released) count++;
      } catch (error) {
        console.error(`[LockManager] Error releasing lock ${lockKey}: ${error.message}`);
      }
    }

    return count;
  }

  /**
   * Start heartbeat timer to verify lock is still held.
   */
  startHeartbeat(lockKey, intervalMs = 30000) {
    this.stopHeartbeat();
    const effectiveKey = lockKey || this.lockId;
    
    // Validate that we actually hold this lock
    if (!this.locks.has(effectiveKey)) {
      console.warn(
        `[LockManager] Cannot start heartbeat for lock ${effectiveKey} ` +
        `that is not held by this instance`
      );
      return;
    }
    
    this.lockId = effectiveKey;

    this._heartbeatTimer = setInterval(async () => {
      const held = await this.heartbeat(effectiveKey, { method: 'database' });
      if (!held) {
        console.error(
          `[LockManager] Heartbeat detected lock loss for ${effectiveKey}`
        );
        this.stopHeartbeat();
      }
    }, intervalMs);
    
    console.debug(
      `[LockManager] Heartbeat started for lock ${effectiveKey} with interval ${intervalMs}ms`
    );
  }

  /**
   * Stop heartbeat timer.
   */
  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
      console.debug(`[LockManager] Heartbeat stopped`);
    }
  }

  /**
   * Check if a lock exists in pg_locks (database-level check).
   * Uses dedicated connection to verify lock is held by THIS process.
   */
  async isLockHeld(lockKey) {
    const effectiveKey = lockKey || this.lockId;
    
    const lockInfo = this.locks.get(effectiveKey);
    if (!lockInfo) {
      return false;
    }
    
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks l
          JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' 
            AND l.objid = $1
            AND l.granted = true
        ) AS held
      `, [effectiveKey]);
      return result.rows[0].held;
    } finally {
      client.release();
    }
  }

  /**
   * Database-level lock check: verifies the lock is still held by THIS backend
   * (pg_backend_pid()), not merely that someone holds it. Runs on the lock's
   * own client so the pid comparison is meaningful.
   *
   * @param {string} lockKey
   * @param {import('pg').PoolClient} [client] - The lock's dedicated client
   * @returns {Promise<boolean>}
   */
  async isHeldDatabase(lockKey, client) {
    const effectiveKey = lockKey || this.lockId;
    const lockInfo = this.locks.get(effectiveKey);
    if (!lockInfo) {
      return false;
    }

    const useClient = client || lockInfo.client;
    try {
      const result = await useClient.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks l
          JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory'
            AND l.objid = $1
            AND l.granted = true
            AND a.pid = pg_backend_pid()
        ) AS held
      `, [effectiveKey]);
      return result.rows[0].held;
    } catch (error) {
      // Connection lost - the lock cannot be verified as held.
      return false;
    }
  }

  /**
   * Heartbeat: verify the lock is still held.
   *
   * @param {string} [lockKey]
   * @param {Object} [options]
   * @param {'database'|'application'} [options.method] - database queries
   *   pg_locks (detects silent connection loss); application is the fast
   *   in-memory check.
   * @returns {Promise<boolean>}
   */
  async heartbeat(lockKey, options = {}) {
    const effectiveKey = lockKey || this.lockId;

    if (!this.locks.has(effectiveKey)) {
      return false;
    }

    if (options.method === 'application') {
      return true;
    }

    return this.isHeldDatabase(effectiveKey, this.locks.get(effectiveKey).client);
  }

  /**
   * Force release a lock (cleanup utility).
   * WARNING: This can terminate another process's lock!
   */
  async forceRelease(lockKey) {
    const effectiveKey = lockKey || this.lockId;
    
    // First, clean up local state regardless
    const localLockInfo = this.locks.get(effectiveKey);
    if (localLockInfo) {
      try {
        await localLockInfo.client.release();
      } catch {}
      this.locks.delete(effectiveKey);
    }
    
    this.isLocked = this.locks.size > 0;
    
    // Try to acquire and release to clear any stale lock
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT pg_try_advisory_lock($1) AS acquired`,
        [effectiveKey]
      );
      
      if (result.rows[0].acquired) {
        await client.query(`SELECT pg_advisory_unlock($1)`, [effectiveKey]);
        console.info(`[LockManager] Force released lock ${effectiveKey}`);
        this._dequeueNext(effectiveKey);
        return true;
      }
      
      console.warn(
        `[LockManager] Could not force release lock ${effectiveKey} - held by another session`
      );
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Check for potential deadlocks (optionally filtered by lock key).
   */
  async checkDeadlock(lockKey) {
    const effectiveKey = lockKey || this.lockId;
    const client = await this.pool.connect();

    try {
      const lockWaitQuery = `
        SELECT
          blocked.pid AS blocked_pid,
          blocked.query AS blocked_query,
          blocking.pid AS blocking_pid,
          blocking.query AS blocking_query,
          now() - blocked.query_start AS wait_duration,
          blocked_locks.objid AS lock_key
        FROM pg_stat_activity blocked
        JOIN pg_locks blocked_locks ON blocked_locks.pid = blocked.pid
        JOIN pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
          AND blocking_locks.database = blocked_locks.database
          AND blocking_locks.objid = blocked_locks.objid
          AND blocking_locks.pid != blocked_locks.pid
        JOIN pg_stat_activity blocking ON blocking.pid = blocking_locks.pid
        WHERE blocked_locks.granted = false
          AND blocked_locks.locktype = 'advisory'
      `;

      const result = await client.query(lockWaitQuery);

      // Filter by lock key if specified
      const filteredRows = effectiveKey 
        ? result.rows.filter(r => r.lock_key === effectiveKey)
        : result.rows;

      return {
        blockedQueries: filteredRows,
        hasPotentialDeadlock: filteredRows.length > 0,
        lockKey: effectiveKey,
      };

    } finally {
      client.release();
    }
  }

  /**
   * Get all advisory locks in the database.
   */
  async getAllLocks() {
    const client = await this.pool.connect();

    try {
      const result = await client.query(`
        SELECT
          locktype,
          objid AS lock_key,
          pid,
          mode,
          granted
        FROM pg_locks
        WHERE locktype = 'advisory'
      `);

      return result.rows;

    } finally {
      client.release();
    }
  }

  /**
   * Get information about a lock holder (for debugging).
   */
  async getLockHolder(lockKey) {
    const effectiveKey = lockKey || this.lockId;
    const result = await this.pool.query(`
      SELECT 
        l.objid AS lock_key,
        l.pid,
        a.query,
        a.state,
        a.query_start,
        a.application_name,
        now() - a.query_start AS duration
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.objid = $1 AND l.granted = true
    `, [effectiveKey]);

    return result.rows[0] || null;
  }

  /**
   * Sanitize timeout string to prevent injection and ensure valid format.
   */
  _sanitizeTimeout(timeout) {
    if (typeof timeout === 'number') {
      // Convert milliseconds to PostgreSQL format
      if (timeout >= 1000) {
        return `${Math.floor(timeout / 1000)}s`;
      }
      return `${timeout}ms`;
    }
    
    if (typeof timeout === 'string') {
      // Validate format: number + optional unit (ms, s, min)
      const valid = /^(\d+(\.\d+)?)\s*(ms|s|min|h)?$/i.test(timeout);
      if (!valid) {
        throw new Error(
          `Invalid timeout format: "${timeout}". ` +
          `Expected format: number + unit (e.g., "5s", "500ms", "1min")`
        );
      }
      return timeout;
    }
    
    throw new Error(
      `Timeout must be a number or string, got: ${typeof timeout}`
    );
  }
}
