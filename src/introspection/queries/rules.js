/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const RULES_QUERY = `
SELECT
  r.oid,
  n.nspname AS schema,
  c.relname AS table,
  r.rulename AS name,
  pg_catalog.pg_get_ruledef(r.oid) AS definition,
  CASE r.ev_type
    WHEN '1' THEN 'SELECT'
    WHEN '2' THEN 'UPDATE'
    WHEN '3' THEN 'INSERT'
    WHEN '4' THEN 'DELETE'
  END AS event,
  r.is_instead AS is_instead,
  r.ev_enabled AS is_enabled,
  pg_catalog.pg_get_expr(r.ev_qual, r.ev_class) AS qual,
  pg_catalog.obj_description(r.oid, 'pg_rewrite') AS comment
FROM pg_catalog.pg_rewrite r
JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE r.rulename != '_RETURN'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname, r.rulename
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryRules(pool) {
  try {
    const result = await pool.query(RULES_QUERY);
    
    return result.rows.map(row => ({
      schema: row.schema,
      table: row.table,
      name: row.name,
      definition: row.definition,
      event: row.event,
      is_instead: row.is_instead,
      is_enabled: row.is_enabled === 'O' || row.is_enabled === 'A',
      qual: row.qual,
      comment: row.comment,
    }));
  } catch (error) {
    return [];
  }
}
