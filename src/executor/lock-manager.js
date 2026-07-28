/**
 * Schema Weaver Migration Engine - Lock Manager
 * https://schemaweaver.vivekmind.com/
 * 
 * Thread-safe advisory lock management for PostgreSQL migrations.
 * Uses session-level advisory locks with proper cleanup handling.
 */
import crypto from 'crypto';
import { LockAcquisitionError } from '../errors.js';

export class LockManager {
  isLocked = false;
  lockId = null;
  connectionId = null;
  _heartbeatTimer = null;
  _releasingLocks = new Set(); // Guard against concurrent releases

  constructor(pool, options = {}) {
    this.pool = pool;
    this.locks = new Map();
    this.connectionId = options.connectionId || null;
    this.lockId = this.computeLockKey(this.connectionId);
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
   * Acquire advisory lock (non-blocking).
   * Returns true if acquired, false if already held by another session.
   */
  async acquire(lockKey, timeout) {
    const effectiveKey = lockKey || this.lockId;
    
    // Guard against double-acquire
    if (this.locks.has(effectiveKey)) {
      console.warn(
        `[LockManager] Attempt to re-acquire lock ${effectiveKey} ` +
        `that is already held by this instance. Lock was acquired at: ` +
        `${this.locks.get(effectiveKey)?.acquiredAt || 'unknown'}`
      );
      return true; // Already held
    }

    const client = await this.pool.connect();
    let acquired = false;

    try {
      if (timeout) {
        const sanitizedTimeout = this._sanitizeTimeout(timeout);
        await client.query(`SET lock_timeout = '${sanitizedTimeout}'`);
      }

      const result = await client.query(
        'SELECT pg_try_advisory_lock($1) as acquired',
        [effectiveKey]
      );

      acquired = result.rows[0].acquired;

      if (acquired) {
        this.isLocked = true;
        this.lockId = effectiveKey;
        this.locks.set(effectiveKey, {
          acquiredAt: new Date().toISOString(),
          client,
          key: effectiveKey,
        });
      }

      return acquired;

    } catch (error) {
      console.error(
        `[LockManager] Error during lock acquisition: ${error.message}`,
        { lockKey: effectiveKey, acquired, code: error.code }
      );
      
      if (!acquired) {
        client.release();
      }
      
      throw error;
    }
  }

  /**
   * Acquire advisory lock (blocking with timeout).
   * Returns true if acquired, false on timeout.
   */
  async acquireAndWait(lockKey, timeout) {
    const effectiveKey = lockKey || this.lockId;
    
    // Guard against double-acquire
    if (this.locks.has(effectiveKey)) {
      return true;
    }

    const client = await this.pool.connect();
    let acquired = false;

    try {
      if (timeout) {
        const sanitizedTimeout = this._sanitizeTimeout(timeout);
        await client.query(`SET lock_timeout = '${sanitizedTimeout}'`);
      }

      const startTime = Date.now();

      await client.query('SELECT pg_advisory_lock($1)', [effectiveKey]);
      acquired = true;

      this.isLocked = true;
      this.lockId = effectiveKey;
      this.locks.set(effectiveKey, {
        acquiredAt: new Date().toISOString(),
        client,
        key: effectiveKey,
        waitTime: Date.now() - startTime,
      });

      return true;

    } catch (error) {
      client.release();
      
      if (error.code === '55P03') {
        // Lock timeout - expected, not an error
        return false;
      }
      
      console.error(
        `[LockManager] Error during blocking lock acquisition: ${error.message}`,
        { lockKey: effectiveKey, code: error.code }
      );
      
      throw error;
    }
  }

  /**
   * Release advisory lock.
   * Only releases locks held by this instance.
   */
  async release(lockKey) {
    const effectiveKey = lockKey || this.lockId;
    
    // Guard against concurrent releases of the same key
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
        // Lock not in our Map - we don't hold it, can't release it
        // This is not an error condition, might have been released already
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
        return true;
      } catch (error) {
        // Log but don't throw - we still want to clean up state
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
      try {
        await this.heartbeat();
      } catch (error) {
        if (error.name === 'LockAcquisitionError') {
          console.error(
            `[LockManager] Heartbeat detected lock loss: ${error.message}`
          );
          // The heartbeat() method already throws LockAcquisitionError
          // The caller (MigrationExecutor) should handle this
        }
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
   * Perform heartbeat check - verify lock is still held.
   */
  async heartbeat() {
    if (!this.isLocked || !this.lockId) {
      return false;
    }

    const held = await this.isLockHeld(this.lockId);
    if (!held) {
      this.isLocked = false;
      this.stopHeartbeat();
      
      throw new LockAcquisitionError(
        `Advisory lock ${this.lockId} lost — connection may have been recycled. ` +
        `Lock was held for connectionId: ${this.connectionId}. ` +
        `To recover: Check migration history, verify current database state, ` +
        `and re-run introspection if necessary.`,
        { lockId: this.lockId, connectionId: this.connectionId }
      );
    }
    return true;
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
