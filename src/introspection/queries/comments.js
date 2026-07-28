/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const TABLE_COMMENTS_QUERY = `
SELECT n.nspname || '.' || c.relname AS object_key,
       pg_catalog.obj_description(c.oid, 'pg_class') AS comment
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND pg_catalog.obj_description(c.oid, 'pg_class') IS NOT NULL
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
`;

const COLUMN_COMMENTS_QUERY = `
SELECT n.nspname || '.' || c.relname || '.' || a.attname AS object_key,
       pg_catalog.col_description(a.attrelid, a.attnum) AS comment
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND pg_catalog.col_description(a.attrelid, a.attnum) IS NOT NULL
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
`;

const TYPE_COMMENTS_QUERY = `
SELECT n.nspname || '.' || t.typname AS object_key,
       pg_catalog.obj_description(t.oid, 'pg_type') AS comment
FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE t.typtype IN ('e', 'c', 'd', 'r')
  AND pg_catalog.obj_description(t.oid, 'pg_type') IS NOT NULL
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
`;

const FUNCTION_COMMENTS_QUERY = `
SELECT n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS object_key,
       pg_catalog.obj_description(p.oid, 'pg_proc') AS comment
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE pg_catalog.obj_description(p.oid, 'pg_proc') IS NOT NULL
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Record<string,string>>}
 */
export async function queryComments(pool) {
  const [tables, columns, types, functions] = await Promise.all([
    pool.query(TABLE_COMMENTS_QUERY).then(r => r.rows),
    pool.query(COLUMN_COMMENTS_QUERY).then(r => r.rows),
    pool.query(TYPE_COMMENTS_QUERY).then(r => r.rows),
    pool.query(FUNCTION_COMMENTS_QUERY).then(r => r.rows),
  ]);

  const comments = {};
  for (const row of [...tables, ...columns, ...types, ...functions]) {
    if (row.comment) {
      comments[row.object_key] = row.comment;
    }
  }
  return comments;
}
