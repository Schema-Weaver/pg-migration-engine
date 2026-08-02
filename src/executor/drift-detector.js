/**
 * Schema Weaver Migration Engine - Migration Executor
 * https://schemaweaver.vivekmind.com/
 */

export class DriftDetector {
  /**
   * Compare before/after snapshots to detect drift
   * @param {Object} snapshotBefore - Snapshot before migration
   * @param {Object} snapshotAfter - Snapshot after migration
   * @param {Object} expectedDiff - The diff we applied
   * @returns {Object} Drift report
   */
  detect(snapshotBefore, snapshotAfter, expectedDiff) {
    const drift = {
      detected: false,
      unexpectedChanges: [],
      missingChanges: [],
      extraChanges: [],
      summary: {
        objectsModified: 0,
        objectsCreated: 0,
        objectsDropped: 0,
        columnsModified: 0,
      },
    };

    if (!snapshotBefore?.checksums || !snapshotAfter?.checksums) {
      return drift;
    }

    const beforeMap = new Map(
      snapshotBefore.checksums.map(c => [`${c.schema}.${c.name}.${c.kind}`, c.checksum])
    );
    const afterMap = new Map(
      snapshotAfter.checksums.map(c => [`${c.schema}.${c.name}.${c.kind}`, c.checksum])
    );

    const ourPaths = new Set(
      (expectedDiff.changes || []).map(c => c.objectKey || c.path)
    );

    for (const [key, afterChecksum] of afterMap) {
      const beforeChecksum = beforeMap.get(key);

      if (beforeChecksum && beforeChecksum !== afterChecksum) {
        if (!ourPaths.has(key)) {
          drift.detected = true;
          drift.unexpectedChanges.push({
            path: key,
            type: 'modified',
            message: `Schema object ${key} was modified by another process during migration`,
          });
          drift.summary.objectsModified++;
        }
      }
    }

    for (const [key] of beforeMap) {
      if (!afterMap.has(key)) {
        const wasDropped = (expectedDiff.changes || []).some(
          c => (c.objectKey === key || c.path === key) && c.changeType?.startsWith('DROP')
        );
        if (!wasDropped) {
          drift.detected = true;
          drift.unexpectedChanges.push({
            path: key,
            type: 'dropped',
            message: `Schema object ${key} was dropped by another process during migration`,
          });
          drift.summary.objectsDropped++;
        }
      }
    }

    for (const [key] of afterMap) {
      if (!beforeMap.has(key)) {
        const wasCreated = (expectedDiff.changes || []).some(
          c => (c.objectKey === key || c.path === key) && c.changeType?.startsWith('CREATE')
        );
        if (!wasCreated) {
          drift.detected = true;
          drift.unexpectedChanges.push({
            path: key,
            type: 'created',
            message: `Schema object ${key} was created by another process during migration`,
          });
          drift.summary.objectsCreated++;
        }
      }
    }

    const expectedCreates = (expectedDiff.changes || []).filter(
      c => c.changeType?.startsWith('CREATE')
    );
    for (const expected of expectedCreates) {
      const key = expected.objectKey || expected.path;
      if (!afterMap.has(key)) {
        drift.missingChanges.push({
          path: key,
          expectedType: 'CREATE',
          message: `Expected object ${key} was not created`,
        });
      }
    }

    const tablePaths = new Set();
    // Checksum entries store the pg_class relkind letter ('r', 'p', 'f', ...),
    // NOT the string 'table' - keyed by `schema.name.kind`.
    for (const list of [snapshotBefore.checksums, snapshotAfter.checksums]) {
      for (const c of list || []) {
        if (c.kind === 'r' || c.kind === 'p' || c.kind === 'f') {
          tablePaths.add(`${c.schema}.${c.name}`);
        }
      }
    }
    
    for (const tablePath of tablePaths) {
      const columnDrift = this.detectColumnDrift(snapshotBefore, snapshotAfter, tablePath);
      if (columnDrift.hasDrift) {
        const columnChanges = (expectedDiff.changes || []).filter(c => 
          c.objectType === 'column' && c.objectKey?.startsWith(tablePath + '.')
        );
        
        for (const mod of columnDrift.columnsModified) {
          const colKey = `${tablePath}.${mod.name}`;
          if (!columnChanges.some(c => c.objectKey === colKey)) {
            drift.detected = true;
            drift.unexpectedChanges.push({
              path: colKey,
              type: 'column_modified',
              message: `Column ${colKey} was modified externally`,
              details: mod,
            });
            drift.summary.columnsModified++;
          }
        }
        for (const colName of columnDrift.columnsAdded) {
          const colKey = `${tablePath}.${colName}`;
          if (!columnChanges.some(c => c.objectKey === colKey)) {
            drift.detected = true;
            drift.unexpectedChanges.push({
              path: colKey,
              type: 'column_added',
              message: `Column ${colKey} was added externally`,
            });
            drift.summary.columnsModified++;
          }
        }
        for (const colName of columnDrift.columnsDropped) {
          const colKey = `${tablePath}.${colName}`;
          if (!columnChanges.some(c => c.objectKey === colKey)) {
            drift.detected = true;
            drift.unexpectedChanges.push({
              path: colKey,
              type: 'column_dropped',
              message: `Column ${colKey} was dropped externally`,
            });
            drift.summary.columnsModified++;
          }
        }
      }
    }

    return drift;
  }

  /**
   * Compare two schema snapshots for column-level drift
   * @param {Object} snapshotBefore
   * @param {Object} snapshotAfter
   * @param {string} tableName - Table to check
   * @returns {Object} Column-level drift report
   */
  detectColumnDrift(snapshotBefore, snapshotAfter, tableName) {
    const drift = {
      tableName,
      columnsAdded: [],
      columnsDropped: [],
      columnsModified: [],
    };

    const beforeCols = this.getTableColumns(snapshotBefore, tableName);
    const afterCols = this.getTableColumns(snapshotAfter, tableName);

    for (const [colName, afterCol] of Object.entries(afterCols)) {
      if (!beforeCols[colName]) {
        drift.columnsAdded.push(colName);
      } else if (JSON.stringify(beforeCols[colName]) !== JSON.stringify(afterCol)) {
        drift.columnsModified.push({
          name: colName,
          before: beforeCols[colName],
          after: afterCol,
        });
      }
    }

    for (const colName of Object.keys(beforeCols)) {
      if (!afterCols[colName]) {
        drift.columnsDropped.push(colName);
      }
    }

    drift.hasDrift = drift.columnsAdded.length > 0 ||
                     drift.columnsDropped.length > 0 ||
                     drift.columnsModified.length > 0;

    return drift;
  }

  /**
   * Get columns for a table from snapshot
   * @param {Object} snapshot
   * @param {string} tableName
   * @returns {Object}
   */
  getTableColumns(snapshot, tableName) {
    // Canonical introspector snapshots use a flat `tables` map keyed by
    // "schema.table"; fall back to the nested schemas[schema].tables[] layout
    // for legacy snapshots.
    const tableKey = tableName.includes('.') ? tableName : `public.${tableName}`;
    let table = snapshot?.tables?.[tableKey];
    if (!table) {
      const parts = tableName.split('.');
      const schemaName = parts.length > 1 ? parts[0] : 'public';
      const name = parts.length > 1 ? parts[1] : parts[0];
      const schema = snapshot?.schemas?.[schemaName];
      if (schema?.tables) {
        table = Array.isArray(schema.tables)
          ? schema.tables.find(t => t.name === name)
          : schema.tables[tableKey] || schema.tables[name];
      }
    }
    if (!table?.columns) return {};

    const cols = {};
    for (const col of table.columns) {
      cols[col.name] = {
        dataType: col.dataType,
        isNullable: col.isNullable,
        defaultValue: col.defaultValue,
      };
    }
    return cols;
  }

  /**
   * Quick drift check using pg_stat_* system view activity
   * @param {import('pg').Pool} pool
   * @returns {Promise<Object>}
   */
  async quickDriftCheck(pool) {
    const client = await pool.connect();

    try {
      const activityQuery = `
        SELECT DISTINCT
          query,
          state,
          query_start,
          now() - query_start AS duration
        FROM pg_stat_activity
        WHERE state = 'active'
          AND query NOT LIKE 'pg_stat_activity%'
          AND pid != pg_backend_pid()
          AND now() - query_start < interval '5 minutes'
        ORDER BY query_start
      `;

      const activity = await client.query(activityQuery);

      const ddlActivity = activity.rows.filter(r =>
        r.query.toUpperCase().match(/^(CREATE|ALTER|DROP|TRUNCATE)\s/)
      );

      return {
        hasDDLActivity: ddlActivity.length > 0,
        activityCount: activity.rows.length,
        ddlActivityCount: ddlActivity.length,
        ddlQueries: ddlActivity,
      };

    } finally {
      client.release();
    }
  }
}
