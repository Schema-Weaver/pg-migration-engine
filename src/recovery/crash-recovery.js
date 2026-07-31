/**
 * Schema Weaver Migration Engine - Crash Recovery
 * https://schemaweaver.vivekmind.com/
 */

import { StorageError, RecoveryError } from '../errors.js';
import { MigrationStateMachine } from '../state-machine/migration-state-machine.js';

export class CrashRecovery {
  constructor(pool, introspector, storage) {
    this.pool = pool;
    this.introspector = introspector;
    this.storage = storage;
    this.stateMachine = storage.stateMachine || new MigrationStateMachine(pool);
  }

  /**
   * Check for incomplete migrations and reconcile
   * @param {string} connectionId
   * @returns {Promise<Object>} Reconciliation results
   */
  async reconcile(connectionId) {
    const startTime = Date.now();
    const results = {
      connectionId,
      checkedAt: new Date().toISOString(),
      runningMigrations: [],
      staleMigrations: [],
      pendingMigrations: [],
      reconciled: [],
      failed: [],
      manualReview: [],
    };

    try {
      // Heartbeat-based stale detection across ALL active statuses
      // (acquiring_lock, running, verifying, completing).
      const staleMigrations = await this.stateMachine.findStale(this.pool, connectionId);
      results.staleMigrations = staleMigrations.map(m => ({
        id: m.id,
        version: m.version,
        name: m.name,
        status: m.status,
        createdAt: m.created_at,
        lastHeartbeatAt: m.last_heartbeat_at,
      }));

      for (const migration of staleMigrations) {
        try {
          // Active status -> stale is always a valid transition.
          await this.stateMachine.transition(migration.id, 'stale', {
            reason: 'heartbeat_timeout',
            previous_status: migration.status,
          });

          const reconciliation = await this.reconcileMigration(migration);

          if (reconciliation.status === 'completed') {
            results.reconciled.push(reconciliation);
          } else if (reconciliation.status === 'failed') {
            results.failed.push(reconciliation);
          } else {
            results.manualReview.push(reconciliation);
          }
        } catch (error) {
          results.manualReview.push({
            migrationId: migration.id,
            version: migration.version,
            name: migration.name,
            error: error.message,
            status: 'reconcile_error',
          });
        }
      }

      const pendingMigrations = await this.storage.getByStatus(connectionId, 'pending');
      results.pendingMigrations = pendingMigrations.map(m => ({
        id: m.id,
        version: m.version,
        name: m.name,
        status: m.status,
        createdAt: m.created_at,
      }));

      for (const migration of pendingMigrations) {
        const ageMs = Date.now() - new Date(migration.created_at).getTime();
        const ageMinutes = Math.round(ageMs / 60000);
        
        if (ageMinutes > 5) {
          await this.storage.failRecord(migration.id, new Error('Stale pending migration - never started'));
          results.failed.push({
            migrationId: migration.id,
            version: migration.version,
            name: migration.name,
            status: 'failed',
            reason: 'Stale pending migration',
            ageMinutes,
          });
        }
      }

      results.durationMs = Date.now() - startTime;
      return results;

    } catch (error) {
      throw new RecoveryError(
        `Reconciliation failed for connection ${connectionId}: ${error.message}`,
        { cause: error, connectionId }
      );
    }
  }

  /**
   * Reconcile a single incomplete migration
   * @param {Object} migration - Migration record from history
   * @returns {Promise<Object>} Reconciliation result
   */
  async reconcileMigration(migration) {
    const result = {
      migrationId: migration.id,
      version: migration.version,
      name: migration.name,
      detectedAt: new Date().toISOString(),
      status: null,
      changes: {
        total: 0,
        applied: 0,
        notApplied: 0,
      },
    };

    const schemaDiff = migration.schema_diff;
    const expectedChanges = schemaDiff?.changes || [];
    result.changes.total = expectedChanges.length;

    if (expectedChanges.length === 0) {
      result.status = 'no_changes';
      await this.storage.failRecord(migration.id, new Error('No changes in migration'));
      return result;
    }

    const appliedChanges = [];
    const notAppliedChanges = [];

    // Execution-log trace: steps the engine logged as completed are trusted
    // as applied without re-introspection; entries logged as failed are
    // treated as not-applied. The trace augments (never overrides)
    // introspection, which remains the source of truth.
    const trace = await this.getExecutionTrace(migration.id);
    const logCompleted = new Set();
    const logFailed = new Set();
    if (trace && trace.length > 0) {
      for (const entry of trace) {
        const key = String(entry.step_id);
        if (entry.status === 'completed') logCompleted.add(key);
        else if (entry.status === 'failed') logFailed.add(key);
      }
    }
    result.executionTrace = trace
      ? { entries: trace.length, completed: logCompleted.size, failed: logFailed.size }
      : null;

    for (const change of expectedChanges) {
      const changeId = String(change.id ?? '');
      // Logged as failed -> definitely not applied (skip the DB round-trip).
      if (changeId && logFailed.has(changeId)) {
        notAppliedChanges.push(change);
        continue;
      }
      // Logged as completed -> trust the execution log, skip introspection.
      const isApplied = (changeId && logCompleted.has(changeId)) ||
        await this.isChangeApplied(change, migration);
      if (isApplied) {
        appliedChanges.push(change);
      } else {
        notAppliedChanges.push(change);
      }
    }

    result.changes.applied = appliedChanges.length;
    result.changes.notApplied = notAppliedChanges.length;

    if (appliedChanges.length === expectedChanges.length) {
      result.status = 'completed';
      result.detection = 'ghost_migration';
      result.message = 'All changes detected in database - DDL was committed before crash';
      
      await this.updateMigrationStatus(migration.id, 'completed', {
        reconciliation: {
          detected: 'ghost_migration',
          method: 'introspection',
          reconciledAt: new Date().toISOString(),
          appliedChanges: appliedChanges.length,
        }
      });
      
    } else if (appliedChanges.length === 0) {
      result.status = 'failed';
      result.detection = 'rollback';
      result.message = 'No changes detected - DDL was rolled back by PostgreSQL';
      
      await this.updateMigrationStatus(migration.id, 'failed', {
        reconciliation: {
          detected: 'rollback',
          method: 'introspection',
          reconciledAt: new Date().toISOString(),
        }
      });
      
    } else {
      result.status = 'needs_review';
      result.detection = 'partial';
      result.message = 'Partial changes detected - manual review required';
      result.appliedChanges = appliedChanges.map(c => ({
        type: c.changeType,
        objectType: c.objectType,
        objectName: c.objectName || c.tableName,
      }));
      
      await this.updateMigrationStatus(migration.id, 'needs_review', {
        reconciliation: {
          detected: 'partial',
          method: 'introspection',
          reconciledAt: new Date().toISOString(),
          appliedChangeCount: appliedChanges.length,
          notAppliedChangeCount: notAppliedChanges.length,
        }
      });
    }

    return result;
  }

  /**
   * Best-effort execution-log trace for a migration.
   * Returns null when logging is unavailable (table missing, storage without
   * an execution log) so reconciliation never depends on it.
   * @param {string} migrationId
   * @returns {Promise<Array<Object>|null>}
   */
  async getExecutionTrace(migrationId) {
    if (!this.storage?.executionLog?.getTrace) return null;
    try {
      return await this.storage.executionLog.getTrace(migrationId);
    } catch {
      return null;
    }
  }

  /**
   * Check if a schema change was applied
   * @param {Object} change - Change object from schema_diff
   * @param {Object} migration - Migration record for context
   * @returns {Promise<boolean>}
   */
  async isChangeApplied(change, migration) {
    const objectType = change.objectType?.toLowerCase();
    const objectName = change.objectName || change.tableName;
    const schemaName = change.schemaName || 'public';

    switch (objectType) {
      case 'table':
        return await this.objectExists('tables', schemaName, objectName);
      
      case 'column':
        return await this.columnExists(schemaName, change.tableName, objectName);
      
      case 'index':
        return await this.objectExists('indexes', schemaName, objectName);
      
      case 'constraint':
      case 'foreign_key':
        return await this.objectExists('constraints', schemaName, objectName);
      
      case 'view':
        return await this.objectExists('views', schemaName, objectName);
      
      case 'function':
        return await this.functionExists(schemaName, objectName, 'FUNCTION');
      
      case 'procedure':
        return await this.functionExists(schemaName, objectName, 'PROCEDURE');
      
      case 'trigger':
        return await this.triggerExists(schemaName, objectName);
      
      case 'materializedview':
      case 'matview':
        return await this.matviewExists(schemaName, objectName);
      
      case 'policy':
        return await this.policyExists(schemaName, objectName);
      
      case 'rule':
        return await this.ruleExists(schemaName, objectName);
      
      case 'domain':
      case 'enum':
      case 'type':
        return await this.typeExists(schemaName, objectName);
      
      case 'sequence':
        return await this.objectExists('sequences', schemaName, objectName);
      
      case 'extension':
        return await this.extensionExists(objectName);
      
      default:
        console.warn(`[CrashRecovery] Unknown object type: ${objectType}`);
        return false;
    }
  }

  /**
   * Check if an object exists in a category
   */
  async objectExists(category, schemaName, objectName) {
    const queries = {
      tables: `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'
      )`,
      indexes: `SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = $1 AND indexname = $2
      )`,
      constraints: `SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_schema = $1 AND constraint_name = $2
      )`,
      views: `SELECT EXISTS (
        SELECT 1 FROM information_schema.views 
        WHERE table_schema = $1 AND table_name = $2
      )`,
      sequences: `SELECT EXISTS (
        SELECT 1 FROM information_schema.sequences 
        WHERE sequence_schema = $1 AND sequence_name = $2
      )`,
    };

    const query = queries[category];
    if (!query) return false;

    try {
      const result = await this.pool.query(query, [schemaName, objectName]);
      return result.rows[0]?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a column exists
   */
  async columnExists(schemaName, tableName, columnName) {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
        )
      `, [schemaName || 'public', tableName, columnName]);
      return result.rows[0]?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a function or procedure exists
   */
  async functionExists(schemaName, functionName, routineType = 'FUNCTION') {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.routines 
          WHERE routine_schema = $1 AND routine_name = $2 AND routine_type = $3
        )
      `, [schemaName || 'public', functionName, routineType]);
      return result.rows[0]?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a materialized view exists
   */
  async matviewExists(schemaName, matviewName) {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_matviews 
          WHERE schemaname = $1 AND matviewname = $2
        )
      `, [schemaName || 'public', matviewName]);
      return result.rows[0]?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a policy exists
   */
  async policyExists(schemaName, policyName) {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_policies 
          WHERE schemaname = $1 AND policyname = $2
        )
      `, [schemaName || 'public', policyName]);
      return result.rows[0]?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a rule exists
   */
  async ruleExists(schemaName, ruleName) {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_rules 
          WHERE schemaname = $1 AND rulename = $2
        )
      `, [schemaName || 'public', ruleName]);
      return result.rows[0]?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a trigger exists
   */
  async triggerExists(schemaName, triggerName) {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.triggers 
          WHERE trigger_schema = $1 AND trigger_name = $2
        )
      `, [schemaName || 'public', triggerName]);
      return result.rows[0]?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a type exists
   */
  async typeExists(schemaName, typeName) {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = $1 AND t.typname = $2
        )
      `, [schemaName || 'public', typeName]);
      return result.rows[0]?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Check if an extension exists
   */
  async extensionExists(extensionName) {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = $1
        )
      `, [extensionName]);
      return result.rows[0]?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Update migration status with metadata
   * Routes through the state machine when the transition is valid
   * (stale -> completed/failed/needs_review), otherwise falls back to a
   * direct update so a committed migration is never left stuck.
   */
  async updateMigrationStatus(migrationId, status, metadata) {
    try {
      const current = await this.stateMachine.getStatus(migrationId).catch(() => null);

      if (current && this.stateMachine.canTransition(current, status)) {
        await this.stateMachine.transition(migrationId, status, {
          reason: 'reconciliation',
          ...metadata,
        });
        return;
      }

      await this.pool.query(`
        UPDATE migration_history 
        SET status = $1,
            status_previous = status,
            status_changed_at = now(),
            applied_at = CASE WHEN $1 = 'completed' THEN COALESCE(applied_at, now()) ELSE applied_at END,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
        WHERE id = $3
      `, [status, JSON.stringify(metadata), migrationId]);
    } catch (error) {
      console.error(`[CrashRecovery] Failed to update migration ${migrationId}:`, error.message);
    }
  }
}
