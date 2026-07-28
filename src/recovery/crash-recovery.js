/**
 * Schema Weaver Migration Engine - Crash Recovery
 * https://schemaweaver.vivekmind.com/
 */

import { StorageError, RecoveryError } from '../errors.js';

export class CrashRecovery {
  constructor(pool, introspector, storage) {
    this.pool = pool;
    this.introspector = introspector;
    this.storage = storage;
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
      pendingMigrations: [],
      reconciled: [],
      failed: [],
      manualReview: [],
    };

    try {
      const runningMigrations = await this.storage.getByStatus(connectionId, 'running');
      results.runningMigrations = runningMigrations.map(m => ({
        id: m.id,
        version: m.version,
        name: m.name,
        status: m.status,
        createdAt: m.created_at,
      }));

      for (const migration of runningMigrations) {
        try {
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

    for (const change of expectedChanges) {
      const isApplied = await this.isChangeApplied(change, migration);
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
      result.status = 'partial_manual_review';
      result.detection = 'partial';
      result.message = 'Partial changes detected - manual review required';
      result.appliedChanges = appliedChanges.map(c => ({
        type: c.changeType,
        objectType: c.objectType,
        objectName: c.objectName || c.tableName,
      }));
      
      await this.updateMigrationStatus(migration.id, 'partial_manual_review', {
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
        return await this.functionExists(schemaName, objectName);
      
      case 'trigger':
        return await this.triggerExists(schemaName, objectName);
      
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
   * Check if a function exists
   */
  async functionExists(schemaName, functionName) {
    try {
      const result = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.routines 
          WHERE routine_schema = $1 AND routine_name = $2 AND routine_type = 'FUNCTION'
        )
      `, [schemaName || 'public', functionName]);
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
   */
  async updateMigrationStatus(migrationId, status, metadata) {
    try {
      await this.pool.query(`
        UPDATE migration_history 
        SET status = $1,
            applied_at = CASE WHEN $1 = 'completed' THEN COALESCE(applied_at, now()) ELSE applied_at END,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
        WHERE id = $3
      `, [status, JSON.stringify(metadata), migrationId]);
    } catch (error) {
      console.error(`[CrashRecovery] Failed to update migration ${migrationId}:`, error.message);
    }
  }
}
