/**
 * Schema Weaver Migration Engine - Migration Storage
 * https://schemaweaver.vivekmind.com/
 */
export class InMemoryStorageProvider {
  constructor() {
    this.snapshots = new Map();
    this.migrations = new Map();
    this.files = new Map();
  }

  async saveSnapshot(checksum, schema) {
    this.snapshots.set(checksum, { schema, timestamp: new Date().toISOString() });
  }

  async loadSnapshot(checksum) {
    const entry = this.snapshots.get(checksum);
    if (!entry) throw new Error(`Snapshot not found: ${checksum}`);
    return entry.schema;
  }

  async listSnapshots() {
    return Array.from(this.snapshots.entries()).map(([checksum, entry]) => ({
      checksum,
      timestamp: entry.timestamp,
    }));
  }

  async saveMigration(migration) {
    const connectionId = migration.connectionId || 'default';
    if (!this.migrations.has(connectionId)) {
      this.migrations.set(connectionId, []);
    }
    this.migrations.get(connectionId).push(migration);
    return migration;
  }

  async getMigration(id, connectionId) {
    const cid = connectionId || 'default';
    const migrations = this.migrations.get(cid) || [];
    return migrations.find(m => m.id === id) || null;
  }

  async getLatestMigration(connectionId) {
    const cid = connectionId || 'default';
    const migrations = this.migrations.get(cid) || [];
    if (migrations.length === 0) return null;
    return migrations[migrations.length - 1];
  }

  async getMigrationHistory(connectionId) {
    const cid = connectionId || 'default';
    return this.migrations.get(cid) || [];
  }

  async getStats(connectionId) {
    const cid = connectionId || 'default';
    const migrations = this.migrations.get(cid) || [];
    return {
      totalMigrations: migrations.length,
      total_migrations: migrations.length,
      completed: migrations.filter(m => m.status === 'completed').length,
      failed: migrations.filter(m => m.status === 'failed').length,
      running: migrations.filter(m => m.status === 'running').length,
    };
  }

  async saveMigrationFile(name, sql) {
    this.files.set(name, sql);
  }

  async loadMigrationFile(name) {
    const sql = this.files.get(name);
    if (!sql) throw new Error(`Migration file not found: ${name}`);
    return sql;
  }

  async listMigrationFiles() {
    return Array.from(this.files.keys());
  }

  async clearConnection(connectionId) {
    this.migrations.delete(connectionId);
  }

  async clearAll() {
    this.migrations.clear();
    this.snapshots.clear();
    this.files.clear();
  }
}
