/**
 * Schema Weaver Migration Engine - Behavioral DDL
 * https://schemaweaver.vivekmind.com/
 */
export class BehavioralPuller {
  /** @param {import('pg').Pool} pool */
  constructor(pool) {
    this.pool = pool;
  }

  /** @returns {Promise<Array<{type:string,phase:number,sql:string,name:string}>>} */
  async pullFromDatabase() {
    const items = [];

    const extResult = await this.pool.query(`
      SELECT 'CREATE EXTENSION IF NOT EXISTS ' || extname || ' SCHEMA ' || nspname AS sql,
             extname AS name
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    `);
    for (const row of extResult.rows) {
      items.push({ type: 'EXTENSION', phase: 0, sql: row.sql, name: row.name });
    }

    const fnResult = await this.pool.query(`
      SELECT 'CREATE OR REPLACE FUNCTION ' || n.nspname || '.' || p.proname || '(' || 
             pg_get_function_identity_arguments(p.oid) || ') RETURNS ' || 
             pg_get_function_result(p.oid) || ' LANGUAGE ' || l.lanname || ' AS $$' || 
             p.prosrc || '$$;' AS sql,
             n.nspname || '.' || p.proname AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    `);
    for (const row of fnResult.rows) {
      items.push({ type: 'FUNCTION', phase: 2, sql: row.sql, name: row.name });
    }

    return items;
  }
}
