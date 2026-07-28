/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const EXTENSIONS_QUERY = `
SELECT e.extname AS name,
       n.nspname AS schema,
       e.extversion AS version,
       pg_catalog.pg_get_userbyid(e.extowner) AS owner,
       e.extrelocatable AS is_relocatable,
       pg_catalog.obj_description(e.oid, 'pg_extension') AS comment,
       true AS is_available
FROM pg_catalog.pg_extension e
JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryExtensions(pool) {
  const result = await pool.query(EXTENSIONS_QUERY);
  return result.rows;
}
