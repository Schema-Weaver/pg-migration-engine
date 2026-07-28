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
    if (!snapshot?.schemas) return {};

    const parts = tableName.split('.');
    const schemaName = parts.length > 1 ? parts[0] : 'public';
    const table = parts.length > 1 ? parts[1] : parts[0];

    const schema = snapshot.schemas[schemaName];
    if (!schema?.tables) return {};

    const tableObj = schema.tables.find(t => t.name === table);
    if (!tableObj?.columns) return {};

    const cols = {};
    for (const col of tableObj.columns) {
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
