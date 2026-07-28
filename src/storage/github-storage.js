/**
 * Schema Weaver Migration Engine - Migration Storage
 * https://schemaweaver.vivekmind.com/
 */
import { Octokit } from 'octokit';

export class GitHubStorageProvider {
  /**
   * @param {Object} config
   * @param {string} config.token
   * @param {string} config.owner
   * @param {string} config.repo
   * @param {string} [config.branch]
   */
  constructor(config) {
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch || 'main';
    this.snapshotsPath = 'snapshots';
    this.migrationsPath = 'migrations';
  }

  /**
   * @param {string} checksum
   * @param {import('../types/schema.js').SchemaModel} schema
   */
  async saveSnapshot(checksum, schema) {
    const path = `${this.snapshotsPath}/${checksum}.json`;
    const content = Buffer.from(JSON.stringify(schema, null, 2)).toString('base64');
    
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner, repo: this.repo, path, ref: this.branch
      });
      await this.octokit.rest.repos.createOrUpdateFileContents({
        owner: this.owner, repo: this.repo, path, message: `Update snapshot ${checksum}`,
        content, sha: data.sha, branch: this.branch
      });
    } catch (e) {
      await this.octokit.rest.repos.createOrUpdateFileContents({
        owner: this.owner, repo: this.repo, path, message: `Create snapshot ${checksum}`,
        content, branch: this.branch
      });
    }
  }

  /** @param {string} checksum */
  async loadSnapshot(checksum) {
    const path = `${this.snapshotsPath}/${checksum}.json`;
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.owner, repo: this.repo, path, ref: this.branch
    });
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  }

  /** @returns {Promise<Array<{checksum:string,timestamp:string}>>} */
  async listSnapshots() {
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.owner, repo: this.repo, path: this.snapshotsPath, ref: this.branch
    });
    return (Array.isArray(data) ? data : []).map(f => ({
      checksum: f.name.replace('.json', ''),
      timestamp: '',
    }));
  }

  /** @param {import('../types/execution.js').MigrationRecord} migration */
  async saveMigration(migration) {
    const path = `${this.migrationsPath}/${migration.id}.json`;
    const content = Buffer.from(JSON.stringify(migration, null, 2)).toString('base64');
    await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner, repo: this.repo, path, message: `Save migration ${migration.id}`,
      content, branch: this.branch
    });
  }

  /** @param {string} id */
  async getMigration(id) {
    try {
      const path = `${this.migrationsPath}/${id}.json`;
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner, repo: this.repo, path, ref: this.branch
      });
      return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
    } catch {
      return null;
    }
  }

  /** @returns {Promise<import('../types/execution.js').MigrationRecord|null>} */
  async getLatestMigration() {
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.owner, repo: this.repo, path: this.migrationsPath, ref: this.branch
    });
    const files = Array.isArray(data) ? data : [];
    if (files.length === 0) return null;
    const latest = files.sort((a, b) => a.name.localeCompare(b.name)).pop();
    return this.getMigration(latest.name.replace('.json', ''));
  }

  /** @returns {Promise<import('../types/execution.js').MigrationRecord[]>} */
  async getMigrationHistory() {
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.owner, repo: this.repo, path: this.migrationsPath, ref: this.branch
    });
    const files = Array.isArray(data) ? data : [];
    const migrations = [];
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const m = await this.getMigration(f.name.replace('.json', ''));
      if (m) migrations.push(m);
    }
    return migrations;
  }

  /** @param {string} name @param {string} sql */
  async saveMigrationFile(name, sql) {
    const path = `${this.migrationsPath}/${name}`;
    const content = Buffer.from(sql).toString('base64');
    await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner, repo: this.repo, path, message: `Save migration file ${name}`,
      content, branch: this.branch
    });
  }

  /** @param {string} name */
  async loadMigrationFile(name) {
    const path = `${this.migrationsPath}/${name}`;
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.owner, repo: this.repo, path, ref: this.branch
    });
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }

  /** @returns {Promise<string[]>} */
  async listMigrationFiles() {
    const { data } = await this.octokit.rest.repos.getContent({
      owner: this.owner, repo: this.repo, path: this.migrationsPath, ref: this.branch
    });
    return (Array.isArray(data) ? data : []).map(f => f.name).filter(f => f.endsWith('.sql'));
  }
}
