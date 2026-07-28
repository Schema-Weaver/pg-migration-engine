/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const ACCESS_METHODS_QUERY = `
SELECT
  a.oid,
  a.amname AS name,
  a.amtype AS type,
  a.amhandler::regproc::text AS handler
FROM pg_catalog.pg_am a
WHERE a.amname NOT IN ('heap', 'btree', 'hash', 'gist', 'gin', 'spgist', 'brin')
  OR a.amtype = 't'
ORDER BY a.amname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryInterfaceAccessMethods(pool) {
  try {
    const result = await pool.query(ACCESS_METHODS_QUERY);
    
    return result.rows.map(row => ({
      name: row.name,
      type: row.type === 't' ? 'TABLE' : 'INDEX',
      handler: row.handler || undefined,
    }));
  } catch (error) {
    return [];
  }
}
