/**
 * Schema Weaver Migration Engine - Migration Planner
 * https://schemaweaver.vivekmind.com/
 */
export class DryRun {
  /**
   * @param {import('pg').Pool} pool
   * @param {import('../types/migration.js').MigrationStep} step
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async execute(pool, step) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(step.sql);
      await client.query('ROLLBACK');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }
}
