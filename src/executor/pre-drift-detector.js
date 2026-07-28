/**
 * Schema Weaver Migration Engine - Pre-Migration Drift Detector
 * https://schemaweaver.vivekmind.com/
 * 
 * L7-08: Pre-migration drift detection implementation.
 * Compares current database state against last migration snapshot
 * to detect external changes before migration starts.
 */

import { DriftDetectedError } from '../errors.js';

export class PreDriftDetector {
  /**
   * @param {import('../introspection/index.js').SchemaIntrospector} introspector
   * @param {import('../storage/migration-table.js').MigrationTable} storage
   */
  constructor(introspector, storage) {
    this.introspector = introspector;
    this.storage = storage;
  }

  /**
   * Check for drift before migration starts.
   * Compares current DB state against last recorded snapshot.
   * 
   * @param {string} connectionId - Database connection ID
   * @param {Object} options - Detection options
   * @returns {Promise<{detected: boolean, changes: Array, summary: Object}>}
   */
  async checkPreMigrationDrift(connectionId, options = {}) {
    const {
      failOnDrift = true,
      includeColumns = true,
      includeConstraints = true,
      includeIndexes = true,
      includeFunctions = false,
      includeViews = true,
    } = options;

    const lastMigration = await this.storage.getLastMigration(connectionId, true);
    
    if (!lastMigration || !lastMigration.snapshot_after) {
      return {
        detected: false,
        changes: [],
        summary: {
          message: 'No previous migration snapshot found. First migration or snapshot not captured.',
          lastMigrationId: lastMigration?.id || null,
        },
      };
    }

    const currentSnapshot = await this.introspector.introspect();
    const lastSnapshot = typeof lastMigration.snapshot_after === 'string' 
      ? JSON.parse(lastMigration.snapshot_after)
      : lastMigration.snapshot_after;

    const drift = this.compareSnapshots(lastSnapshot, currentSnapshot, {
      includeColumns,
      includeConstraints,
      includeIndexes,
      includeFunctions,
      includeViews,
    });

    const result = {
      detected: drift.changes.length > 0,
      changes: drift.changes,
      summary: {
        lastMigrationId: lastMigration.id,
        lastMigrationVersion: lastMigration.version,
        lastMigrationAt: lastMigration.applied_at,
        currentChecksum: currentSnapshot.checksum,
        previousChecksum: lastSnapshot.checksum,
        objectsAdded: drift.changes.filter(c => c.type === 'added').length,
        objectsDropped: drift.changes.filter(c => c.type === 'dropped').length,
        objectsModified: drift.changes.filter(c => c.type === 'modified').length,
        totalDriftCount: drift.changes.length,
      },
      currentSnapshot: options.includeSnapshot ? currentSnapshot : undefined,
      previousSnapshot: options.includeSnapshot ? lastSnapshot : undefined,
    };

    if (drift.changes.length > 0 && failOnDrift) {
      const driftDetails = drift.changes.slice(0, 10).map(c => 
        `  - ${c.type}: ${c.objectType} ${c.key}`
      ).join('\n');
      const moreCount = drift.changes.length > 10 ? `\n  ... and ${drift.changes.length - 10} more` : '';
      
      throw new DriftDetectedError(
        `Pre-migration drift detected: ${drift.changes.length} changes found since last migration.\n` +
        `Last migration: ${lastMigration.version} at ${lastMigration.applied_at}\n` +
        `Drift changes:\n${driftDetails}${moreCount}\n\n` +
        `Run with failOnDrift=false to allow drift, or use reconcileDrift() to update history.`,
        { drift: result }
      );
    }

    return result;
  }

  /**
   * Compare two schema snapshots to detect drift.
   * 
   * @param {Object} previous - Previous snapshot
   * @param {Object} current - Current snapshot
   * @param {Object} options - Comparison options
   * @returns {{changes: Array}}
   */
  compareSnapshots(previous, current, options = {}) {
    const changes = [];

    const previousTables = previous.tables || {};
    const currentTables = current.tables || {};

    for (const [key, currentTable] of Object.entries(currentTables)) {
      const previousTable = previousTables[key];
      
      if (!previousTable) {
        changes.push({
          type: 'added',
          objectType: 'table',
          key,
          details: { name: currentTable.name, schema: currentTable.schema },
        });
      } else if (options.includeColumns) {
        const columnDrift = this.compareColumns(key, previousTable, currentTable);
        changes.push(...columnDrift);
      }
    }

    for (const [key] of Object.entries(previousTables)) {
      if (!currentTables[key]) {
        changes.push({
          type: 'dropped',
          objectType: 'table',
          key,
          details: { key },
        });
      }
    }

    if (options.includeIndexes) {
      const indexDrift = this.compareIndexes(previous.indexes || {}, current.indexes || {});
      changes.push(...indexDrift);
    }

    if (options.includeConstraints) {
      const constraintDrift = this.compareConstraints(previous.constraints || {}, current.constraints || {});
      changes.push(...constraintDrift);
    }

    if (options.includeViews) {
      const viewDrift = this.compareViews(previous.views || {}, current.views || {});
      changes.push(...viewDrift);
    }

    if (options.includeFunctions) {
      const functionDrift = this.compareFunctions(previous.functions || {}, current.functions || {});
      changes.push(...functionDrift);
    }

    return { changes };
  }

  /**
   * Compare columns between two tables.
   */
  compareColumns(tableKey, previousTable, currentTable) {
    const changes = [];
    const prevCols = previousTable.columns || [];
    const currCols = currentTable.columns || [];

    const prevColMap = new Map(prevCols.map(c => [c.name, c]));
    const currColMap = new Map(currCols.map(c => [c.name, c]));

    for (const [colName, currCol] of currColMap) {
      const prevCol = prevColMap.get(colName);
      if (!prevCol) {
        changes.push({
          type: 'added',
          objectType: 'column',
          key: `${tableKey}.${colName}`,
          details: { table: tableKey, column: colName, dataType: currCol.dataType },
        });
      } else if (this.columnChanged(prevCol, currCol)) {
        changes.push({
          type: 'modified',
          objectType: 'column',
          key: `${tableKey}.${colName}`,
          details: { 
            table: tableKey, 
            column: colName,
            previous: { dataType: prevCol.dataType, isNullable: prevCol.isNullable },
            current: { dataType: currCol.dataType, isNullable: currCol.isNullable },
          },
        });
      }
    }

    for (const [colName] of prevColMap) {
      if (!currColMap.has(colName)) {
        changes.push({
          type: 'dropped',
          objectType: 'column',
          key: `${tableKey}.${colName}`,
          details: { table: tableKey, column: colName },
        });
      }
    }

    return changes;
  }

  /**
   * Check if a column has changed.
   */
  columnChanged(prev, curr) {
    return prev.dataType !== curr.dataType ||
           prev.isNullable !== curr.isNullable ||
           prev.defaultValue !== curr.defaultValue;
  }

  /**
   * Compare indexes between snapshots.
   */
  compareIndexes(prevIndexes, currIndexes) {
    const changes = [];

    for (const [key, currIdx] of Object.entries(currIndexes)) {
      const prevIdx = prevIndexes[key];
      if (!prevIdx) {
        changes.push({
          type: 'added',
          objectType: 'index',
          key,
          details: { name: currIdx.name || currIdx.indexName },
        });
      }
    }

    for (const [key] of Object.entries(prevIndexes)) {
      if (!currIndexes[key]) {
        changes.push({
          type: 'dropped',
          objectType: 'index',
          key,
          details: { key },
        });
      }
    }

    return changes;
  }

  /**
   * Compare constraints between snapshots.
   */
  compareConstraints(prevConstraints, currConstraints) {
    const changes = [];

    for (const [key, currCon] of Object.entries(currConstraints)) {
      const prevCon = prevConstraints[key];
      if (!prevCon) {
        changes.push({
          type: 'added',
          objectType: 'constraint',
          key,
          details: { name: currCon.name, constraintType: currCon.constraintType || currCon.type },
        });
      }
    }

    for (const [key] of Object.entries(prevConstraints)) {
      if (!currConstraints[key]) {
        changes.push({
          type: 'dropped',
          objectType: 'constraint',
          key,
          details: { key },
        });
      }
    }

    return changes;
  }

  /**
   * Compare views between snapshots.
   */
  compareViews(prevViews, currViews) {
    const changes = [];

    for (const [key, currView] of Object.entries(currViews)) {
      const prevView = prevViews[key];
      if (!prevView) {
        changes.push({
          type: 'added',
          objectType: 'view',
          key,
          details: { name: currView.name },
        });
      } else if (prevView.definition !== currView.definition) {
        changes.push({
          type: 'modified',
          objectType: 'view',
          key,
          details: { name: currView.name },
        });
      }
    }

    for (const [key] of Object.entries(prevViews)) {
      if (!currViews[key]) {
        changes.push({
          type: 'dropped',
          objectType: 'view',
          key,
          details: { key },
        });
      }
    }

    return changes;
  }

  /**
   * Compare functions between snapshots.
   */
  compareFunctions(prevFuncs, currFuncs) {
    const changes = [];

    for (const [key, currFunc] of Object.entries(currFuncs)) {
      const prevFunc = prevFuncs[key];
      if (!prevFunc) {
        changes.push({
          type: 'added',
          objectType: 'function',
          key,
          details: { name: currFunc.name },
        });
      }
    }

    for (const [key] of Object.entries(prevFuncs)) {
      if (!currFuncs[key]) {
        changes.push({
          type: 'dropped',
          objectType: 'function',
          key,
          details: { key },
        });
      }
    }

    return changes;
  }

  /**
   * Get a quick drift summary without full comparison.
   * Useful for health checks.
   * 
   * @param {string} connectionId
   * @returns {Promise<{hasDrift: boolean, summary: Object}>}
   */
  async getDriftSummary(connectionId) {
    const lastMigration = await this.storage.getLastMigration(connectionId, true);
    
    if (!lastMigration || !lastMigration.snapshot_after) {
      return {
        hasDrift: false,
        summary: { message: 'No previous snapshot available' },
      };
    }

    const currentSnapshot = await this.introspector.introspect();
    const lastSnapshot = typeof lastMigration.snapshot_after === 'string'
      ? JSON.parse(lastMigration.snapshot_after)
      : lastMigration.snapshot_after;

    const tableCountPrev = Object.keys(lastSnapshot.tables || {}).length;
    const tableCountCurr = Object.keys(currentSnapshot.tables || {}).length;

    return {
      hasDrift: lastSnapshot.checksum !== currentSnapshot.checksum,
      summary: {
        lastMigrationVersion: lastMigration.version,
        lastMigrationAt: lastMigration.applied_at,
        previousChecksum: lastSnapshot.checksum,
        currentChecksum: currentSnapshot.checksum,
        tableCountPrevious: tableCountPrev,
        tableCountCurrent: tableCountCurr,
        tableCountDifference: tableCountCurr - tableCountPrev,
      },
    };
  }
}
