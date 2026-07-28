/**
 * Schema Weaver Migration Engine - Migration Storage
 * https://schemaweaver.vivekmind.com/
 */
import fs from 'fs/promises';
import path from 'path';

export class FileStorageProvider {
  /** @param {string} basePath */
  constructor(basePath) {
    this.basePath = basePath;
    this.snapshotsDir = path.join(basePath, 'snapshots');
    this.migrationsDir = path.join(basePath, 'migrations');
  }

  async init() {
    await fs.mkdir(this.snapshotsDir, { recursive: true });
    await fs.mkdir(this.migrationsDir, { recursive: true });
  }

  /**
   * @param {string} checksum
   * @param {import('../types/schema.js').SchemaModel} schema
   */
  async saveSnapshot(checksum, schema) {
    await fs.writeFile(
      path.join(this.snapshotsDir, `${checksum}.json`),
      JSON.stringify(schema, null, 2)
    );
  }

  /** @param {string} checksum */
  async loadSnapshot(checksum) {
    const data = await fs.readFile(path.join(this.snapshotsDir, `${checksum}.json`), 'utf-8');
    return JSON.parse(data);
  }

  /** @returns {Promise<Array<{checksum:string,timestamp:string}>>} */
  async listSnapshots() {
    const files = await fs.readdir(this.snapshotsDir);
    return files.filter(f => f.endsWith('.json')).map(f => ({
      checksum: f.replace('.json', ''),
      timestamp: '',
    }));
  }

  /** @param {import('../types/execution.js').MigrationRecord} migration */
  async saveMigration(migration) {
    await fs.writeFile(
      path.join(this.migrationsDir, `${migration.id}.json`),
      JSON.stringify(migration, null, 2)
    );
  }

  /** @param {string} id */
  async getMigration(id) {
    try {
      const data = await fs.readFile(path.join(this.migrationsDir, `${id}.json`), 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /** @returns {Promise<import('../types/execution.js').MigrationRecord|null>} */
  async getLatestMigration() {
    const files = await fs.readdir(this.migrationsDir);
    if (files.length === 0) return null;
    const latest = files.sort().pop();
    return this.getMigration(latest.replace('.json', ''));
  }

  /** @returns {Promise<import('../types/execution.js').MigrationRecord[]>} */
  async getMigrationHistory() {
    const files = await fs.readdir(this.migrationsDir);
    const migrations = [];
    for (const file of files.sort()) {
      migrations.push(await this.getMigration(file.replace('.json', '')));
    }
    return migrations.filter(Boolean);
  }

  /** @param {string} name @param {string} sql */
  async saveMigrationFile(name, sql) {
    await fs.writeFile(path.join(this.migrationsDir, name), sql);
  }

  /** @param {string} name */
  async loadMigrationFile(name) {
    return fs.readFile(path.join(this.migrationsDir, name), 'utf-8');
  }

  /** @returns {Promise<string[]>} */
  async listMigrationFiles() {
    const files = await fs.readdir(this.migrationsDir);
    return files.filter(f => f.endsWith('.sql'));
  }
}
