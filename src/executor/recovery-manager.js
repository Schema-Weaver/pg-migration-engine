/**
 * Schema Weaver Migration Engine - Migration Executor
 * https://schemaweaver.vivekmind.com/
 */
export class RecoveryManager {
  /** @param {import('../types/execution.js').StorageProvider} storage */
  constructor(storage) {
    this.storage = storage;
  }

  /**
   * @param {string} migrationId
   * @returns {Promise<import('../types/execution.js').RecoveryResult>}
   */
  async recover(migrationId) {
    const migration = await this.storage.getMigration(migrationId);
    if (!migration) {
      return { action: 'UNKNOWN', message: 'Migration not found' };
    }

    if (migration.status === 'COMPLETED') {
      return { action: 'NONE', message: 'Migration already completed' };
    }

    if (migration.status === 'FAILED') {
      return { action: 'RETRY', message: 'Database is consistent, migration can be retried' };
    }

    if (migration.status === 'RUNNING') {
      return { action: 'WAIT', message: 'Migration is still running' };
    }

    if (migration.status === 'STALE') {
      return { action: 'STALE_CLEANUP', message: 'Migration process died, cleaning up' };
    }

    return { action: 'UNKNOWN', message: `Unknown migration status: ${migration.status}` };
  }

  /**
   * @param {string} migrationId
   * @returns {Promise<void>}
   */
  async markFailed(migrationId) {
    const migration = await this.storage.getMigration(migrationId);
    if (migration) {
      migration.status = 'FAILED';
      await this.storage.saveMigration(migration);
    }
  }
}
