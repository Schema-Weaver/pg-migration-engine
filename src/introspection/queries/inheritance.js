/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const INHERITANCE_QUERY = `
SELECT child.relname AS child_table,
       cn.nspname AS child_schema,
       parent.relname AS parent_table,
       pn.nspname AS parent_schema
FROM pg_catalog.pg_inherits i
JOIN pg_catalog.pg_class child ON child.oid = i.inhrelid
JOIN pg_catalog.pg_namespace cn ON cn.oid = child.relnamespace
JOIN pg_catalog.pg_class parent ON parent.oid = i.inhparent
JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
WHERE parent.relkind != 'p'
  AND cn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND cn.nspname NOT LIKE 'pg_temp_%'
ORDER BY cn.nspname, child.relname, pn.nspname, parent.relname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryInheritance(pool) {
  const result = await pool.query(INHERITANCE_QUERY);
  return result.rows;
}
