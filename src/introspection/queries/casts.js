/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const CASTS_QUERY = `
SELECT
  c.oid,
  format_type(c.castsource, NULL) AS source_type,
  format_type(c.casttarget, NULL) AS target_type,
  CASE WHEN c.castfunc = 0 THEN NULL ELSE c.castfunc::regproc::text END AS function,
  CASE c.castcontext
    WHEN 'e' THEN 'EXPLICIT'
    WHEN 'a' THEN 'ASSIGNMENT'
    WHEN 'i' THEN 'IMPLICIT'
  END AS context,
  CASE c.castmethod
    WHEN 'f' THEN 'FUNCTION'
    WHEN 'i' THEN 'INOUT'
    WHEN 'b' THEN 'BINARY'
  END AS method,
  pg_catalog.obj_description(c.oid, 'pg_cast') AS comment
FROM pg_catalog.pg_cast c
WHERE c.castsource NOT IN (
  SELECT oid FROM pg_type WHERE typnamespace = 'pg_catalog'::regnamespace
) AND c.casttarget NOT IN (
  SELECT oid FROM pg_type WHERE typnamespace = 'pg_catalog'::regnamespace
)
ORDER BY source_type, target_type
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryCasts(pool) {
  try {
    const result = await pool.query(CASTS_QUERY);
    return result.rows;
  } catch (error) {
    return [];
  }
}
