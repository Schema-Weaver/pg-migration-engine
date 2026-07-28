/**
 * Schema Weaver Migration Engine - Migration Executor
 * https://schemaweaver.vivekmind.com/
 */
export class SnapshotManager {
  /**
   * @param {import('../introspection/index.js').SchemaIntrospector} introspector
   * @param {import('../types/execution.js').StorageProvider} storage
   */
  constructor(introspector, storage) {
    this.introspector = introspector;
    this.storage = storage;
  }

  /** @returns {Promise<string>} */
  async capture() {
    const schema = await this.introspector.introspect();
    await this.storage.saveSnapshot(schema.checksum, schema);
    return schema.checksum;
  }

  /** @param {string} checksum */
  async restore(checksum) {
    return this.storage.loadSnapshot(checksum);
  }
}
