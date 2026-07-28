/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const CONVERSIONS_QUERY = `
SELECT
  c.oid,
  n.nspname AS schema,
  c.conname AS name,
  pg_catalog.pg_get_userbyid(c.conowner) AS owner,
  c.conproc::regproc::text AS proc,
  c.condefault AS is_default,
  pg_catalog.pg_encoding_to_char(c.conforencoding) AS source_encoding,
  pg_catalog.pg_encoding_to_char(c.contoencoding) AS target_encoding,
  pg_catalog.obj_description(c.oid, 'pg_conversion') AS comment
FROM pg_catalog.pg_conversion c
JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.conname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryConversions(pool) {
  try {
    const result = await pool.query(CONVERSIONS_QUERY);
    
    return result.rows.map(row => ({
      schema: row.schema,
      name: row.name,
      owner: row.owner,
      proc: row.proc,
      is_default: row.is_default,
      source_encoding: row.source_encoding,
      target_encoding: row.target_encoding,
      comment: row.comment || undefined,
    }));
  } catch (error) {
    return [];
  }
}
