/**
 * Schema Weaver Migration Engine - Drift Reconciliation
 * https://schemaweaver.vivekmind.com/
 * 
 * L7-08: Drift Reconciliation API.
 * Reconciles detected drift by updating migration history to match current state.
 */

export class DriftReconciler {
  /**
   * @param {import('../introspection/index.js').SchemaIntrospector} introspector
   * @param {import('../storage/migration-table.js').MigrationTable} storage
   */
  constructor(introspector, storage) {
    this.introspector = introspector;
    this.storage = storage;
  }

  /**
   * Reconcile drift by updating history to match current state.
   * Creates a reconciliation record that acknowledges the drift.
   * 
   * @param {string} connectionId - Database connection ID
   * @param {Object} options - Reconciliation options
   * @returns {Promise<{reconciled: boolean, record: Object, summary: Object}>}
   */
  async reconcileDrift(connectionId, options = {}) {
    const {
      reason = 'Manual drift reconciliation',
      appliedBy = null,
      createReconciliationRecord = true,
    } = options;

    const currentSnapshot = await this.introspector.introspect();
    const lastMigration = await this.storage.getLastMigration(connectionId, true);

    let previousChecksum = null;
    let previousSnapshot = null;

    if (lastMigration?.snapshot_after) {
      previousSnapshot = typeof lastMigration.snapshot_after === 'string'
        ? JSON.parse(lastMigration.snapshot_after)
        : lastMigration.snapshot_after;
      previousChecksum = previousSnapshot.checksum;
    }

    const driftSummary = {
      previousChecksum,
      currentChecksum: currentSnapshot.checksum,
      tableCountPrevious: previousSnapshot ? Object.keys(previousSnapshot.tables || {}).length : 0,
      tableCountCurrent: Object.keys(currentSnapshot.tables || {}).length,
      reconciledAt: new Date().toISOString(),
      reason,
    };

    let reconciliationRecord = null;

    if (createReconciliationRecord) {
      reconciliationRecord = await this.storage.insertReconciliationRecord({
        connectionId,
        name: 'drift_reconciliation',
        checksum: currentSnapshot.checksum,
        schemaDiff: {
          previousChecksum,
          currentChecksum: currentSnapshot.checksum,
          driftDetected: previousChecksum !== currentSnapshot.checksum,
        },
        snapshotBefore: previousSnapshot,
        snapshotAfter: currentSnapshot,
        driftSummary,
        appliedBy,
        up_sql: '-- Reconciliation: no DDL applied, history updated to match current state',
      });
    }

    return {
      reconciled: true,
      record: reconciliationRecord,
      summary: driftSummary,
      message: previousChecksum === currentSnapshot.checksum
        ? 'No drift detected. History already matches current state.'
        : `Reconciliation complete. History updated to match ${Object.keys(currentSnapshot.tables || {}).length} tables.`,
    };
  }

  /**
   * Accept untracked objects into the schema.
   * Updates history to acknowledge manually created objects.
   * 
   * @param {string} connectionId
   * @param {Array<{objectType: string, key: string}>} objects - Objects to accept
   * @param {Object} options
   * @returns {Promise<{accepted: number, summary: Object}>}
   */
  async acceptUntrackedObjects(connectionId, objects, options = {}) {
    const {
      reason = 'Accepted untracked objects',
      appliedBy = null,
    } = options;

    if (!objects || objects.length === 0) {
      return { accepted: 0, summary: { message: 'No objects to accept' } };
    }

    const currentSnapshot = await this.introspector.introspect();

    const grouped = this.groupObjectsByType(objects);
    
    const acceptedObjects = [];
    for (const obj of objects) {
      let exists = false;
      const parts = obj.key.split('.');
      
      switch (obj.objectType) {
        case 'table':
          exists = !!(currentSnapshot.tables?.[obj.key]);
          break;
        case 'index':
          exists = !!(currentSnapshot.indexes?.[obj.key]);
          break;
        case 'constraint':
          exists = !!(currentSnapshot.constraints?.[obj.key]);
          break;
        case 'view':
          exists = !!(currentSnapshot.views?.[obj.key]);
          break;
        case 'function':
          exists = !!(currentSnapshot.functions?.[obj.key]);
          break;
      }

      if (exists) {
        acceptedObjects.push(obj);
      }
    }

    if (acceptedObjects.length > 0) {
      await this.storage.insertReconciliationRecord({
        connectionId,
        name: 'accept_untracked_objects',
        checksum: currentSnapshot.checksum,
        schemaDiff: {
          acceptedObjects: acceptedObjects,
          action: 'accept_untracked',
        },
        snapshotBefore: null,
        snapshotAfter: currentSnapshot,
        driftSummary: {
          acceptedCount: acceptedObjects.length,
          acceptedTypes: grouped,
          reason,
        },
        appliedBy,
        up_sql: `-- Accepted ${acceptedObjects.length} untracked objects into schema history`,
      });
    }

    return {
      accepted: acceptedObjects.length,
      summary: {
        total: objects.length,
        accepted: acceptedObjects.length,
        skipped: objects.length - acceptedObjects.length,
        byType: grouped,
      },
    };
  }

  /**
   * Group objects by type for summary.
   */
  groupObjectsByType(objects) {
    const grouped = {};
    for (const obj of objects) {
      if (!grouped[obj.objectType]) {
        grouped[obj.objectType] = [];
      }
      grouped[obj.objectType].push(obj.key);
    }
    return grouped;
  }

  /**
   * Get drift status for a connection.
   * Returns detailed information for manual review.
   * 
   * @param {string} connectionId
   * @returns {Promise<{status: string, lastMigration: Object, drift: Object}>}
   */
  async getDriftStatus(connectionId) {
    const lastMigration = await this.storage.getLastMigration(connectionId, true);
    
    if (!lastMigration) {
      return {
        status: 'no_history',
        lastMigration: null,
        drift: null,
        message: 'No migration history found. This may be a new database.',
      };
    }

    const currentSnapshot = await this.introspector.introspect();
    const lastSnapshot = lastMigration.snapshot_after 
      ? (typeof lastMigration.snapshot_after === 'string'
          ? JSON.parse(lastMigration.snapshot_after)
          : lastMigration.snapshot_after)
      : null;

    if (!lastSnapshot) {
      return {
        status: 'no_snapshot',
        lastMigration: {
          id: lastMigration.id,
          version: lastMigration.version,
          appliedAt: lastMigration.applied_at,
        },
        drift: null,
        message: 'Last migration has no snapshot. Cannot detect drift.',
      };
    }

    const hasDrift = lastSnapshot.checksum !== currentSnapshot.checksum;

    return {
      status: hasDrift ? 'drift_detected' : 'in_sync',
      lastMigration: {
        id: lastMigration.id,
        version: lastMigration.version,
        appliedAt: lastMigration.applied_at,
        checksum: lastSnapshot.checksum,
      },
      drift: hasDrift ? {
        previousChecksum: lastSnapshot.checksum,
        currentChecksum: currentSnapshot.checksum,
        tableCountPrevious: Object.keys(lastSnapshot.tables || {}).length,
        tableCountCurrent: Object.keys(currentSnapshot.tables || {}).length,
      } : null,
      message: hasDrift
        ? 'Drift detected. Current state differs from last migration snapshot.'
        : 'Database is in sync with migration history.',
    };
  }
}
