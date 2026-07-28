/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const GRANTS_QUERY = `
SELECT n.nspname AS schema,
       c.relname AS object,
       CASE c.relkind
         WHEN 'r' THEN 'TABLE'
         WHEN 'p' THEN 'TABLE'
         WHEN 'v' THEN 'VIEW'
         WHEN 'm' THEN 'MATERIALIZED_VIEW'
         WHEN 'S' THEN 'SEQUENCE'
         WHEN 'f' THEN 'FOREIGN_TABLE'
       END AS object_type,
       a.grantee::regrole::text AS grantee,
       a.grantor::regrole::text AS grantor,
       a.privilege_type AS privilege,
       a.is_grantable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(
  CASE c.relkind
    WHEN 'S' THEN c.relacl
    ELSE c.relacl
  END
) a
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND a.grantee::regrole::text != a.grantor::regrole::text
ORDER BY n.nspname, c.relname, a.grantee::regrole::text
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryGrants(pool) {
  const result = await pool.query(GRANTS_QUERY);
  return result.rows;
}
