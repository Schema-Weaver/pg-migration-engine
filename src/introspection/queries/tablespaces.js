/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const TABLESPACES_QUERY = `
SELECT
  t.oid,
  t.spcname AS name,
  pg_catalog.pg_get_userbyid(t.spcowner) AS owner,
  t.spclocation AS location,
  t.spcdefault AS is_default,
  t.spcacl AS acl,
  t.spcoptions AS options
FROM pg_catalog.pg_tablespace t
WHERE t.spcname NOT LIKE 'pg_%'
ORDER BY t.spcname
`;

const DEFAULT_TABLESPACES = ['pg_default', 'pg_global'];

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryInterfaceTablespaces(pool) {
  try {
    const result = await pool.query(TABLESPACES_QUERY);
    
    return result.rows.map(row => ({
      name: row.name,
      owner: row.owner,
      location: row.location || undefined,
      is_default: row.is_default || DEFAULT_TABLESPACES.includes(row.name),
      acl: row.acl || undefined,
      options: row.options || undefined,
    }));
  } catch (error) {
    return [];
  }
}
