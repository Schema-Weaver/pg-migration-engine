/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const POLICIES_QUERY = `
SELECT pol.polname AS name,
       n.nspname AS schema,
       c.relname AS table_name,
       CASE pol.polcmd
         WHEN '*' THEN 'ALL'
         WHEN 'r' THEN 'SELECT'
         WHEN 'a' THEN 'INSERT'
         WHEN 'w' THEN 'UPDATE'
         WHEN 'd' THEN 'DELETE'
       END AS command,
       pol.polpermissive AS is_permissive,
       CASE
         WHEN pol.polroles = '{0}' THEN ARRAY['PUBLIC']
         ELSE ARRAY(SELECT rolname FROM pg_catalog.pg_roles WHERE oid = ANY(pol.polroles))
       END AS roles,
       pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
       pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression,
       pg_catalog.obj_description(pol.oid, 'pg_policy') AS comment
FROM pg_catalog.pg_policy pol
JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname, pol.polname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryPolicies(pool) {
  const result = await pool.query(POLICIES_QUERY);
  return result.rows;
}
