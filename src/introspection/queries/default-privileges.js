/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const DEFAULT_PRIVILEGES_QUERY = `
SELECT
  n.nspname AS schema,
  pg_catalog.pg_get_userbyid(d.defaclrole) AS role,
  CASE d.defaclobjtype
    WHEN 'r' THEN 'TABLE'
    WHEN 'S' THEN 'SEQUENCE'
    WHEN 'f' THEN 'FUNCTION'
    WHEN 'T' THEN 'TYPE'
    WHEN 's' THEN 'SCHEMA'
    WHEN 'n' THEN 'SCHEMA'
  END AS object_type,
  d.defaclacl AS acl
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname IS NULL OR n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, d.defaclobjtype, pg_catalog.pg_get_userbyid(d.defaclrole)
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryDefaultPrivileges(pool) {
  try {
    const result = await pool.query(DEFAULT_PRIVILEGES_QUERY);
    
    return result.rows.map(row => ({
      schema: row.schema || null,
      role: row.role,
      object_type: row.object_type,
      acl: row.acl || [],
    }));
  } catch (error) {
    return [];
  }
}
