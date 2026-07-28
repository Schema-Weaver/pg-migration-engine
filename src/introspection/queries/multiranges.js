/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const MULTIRANGES_QUERY = `
SELECT
  t.oid,
  n.nspname AS schema,
  t.typname AS name,
  pg_catalog.pg_get_userbyid(t.typowner) AS owner,
  format_type(t.typbasetype, NULL) AS range_type,
  pg_catalog.obj_description(t.oid, 'pg_type') AS comment
FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE t.typtype = 'm'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, t.typname
`;

/**
 * @param {import('pg').Pool} pool
 * @param {number} version
 * @returns {Promise<Array>}
 */
export async function queryMultiranges(pool, version) {
  if (version < 140000) return [];

  try {
    const result = await pool.query(MULTIRANGES_QUERY);
    
    return result.rows.map(row => ({
      schema: row.schema,
      name: row.name,
      owner: row.owner,
      range_type: row.range_type,
      comment: row.comment || undefined,
    }));
  } catch (error) {
    return [];
  }
}
