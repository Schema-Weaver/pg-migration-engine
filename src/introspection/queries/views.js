/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const VIEWS_QUERY = `
SELECT c.relname AS name,
       n.nspname AS schema,
       c.relowner::regrole::text AS owner,
       pg_catalog.pg_get_viewdef(c.oid, true) AS definition,
       CASE c.relkind WHEN 'v' THEN 'VIEW' ELSE 'MATERIALIZED_VIEW' END AS kind,
       CASE
         WHEN c.relkind = 'v' AND c.relchecks > 0 THEN
           CASE WHEN EXISTS (
             SELECT 1 FROM pg_catalog.pg_rewrite r
             WHERE r.ev_class = c.oid AND r.ev_type = '1'
             AND pg_catalog.pg_get_expr(r.ev_qual, r.ev_class) LIKE '%check_option=cascaded%'
           ) THEN 'CASCADED'
           WHEN EXISTS (
             SELECT 1 FROM pg_catalog.pg_rewrite r
             WHERE r.ev_class = c.oid AND r.ev_type = '1'
             AND pg_catalog.pg_get_expr(r.ev_qual, r.ev_class) LIKE '%check_option=local%'
           ) THEN 'LOCAL'
           ELSE NULL
           END
         ELSE NULL
       END AS check_option,
       c.reloptions AS rel_options,
       c.relacl AS privileges,
       pg_catalog.obj_description(c.oid, 'pg_class') AS comment
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname
`;

const VIEW_COLUMNS_QUERY = `
SELECT n.nspname AS schema,
       c.relname AS name,
       a.attname AS column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS column_type,
       NOT a.attnotnull AS nullable,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_value
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE c.relkind = 'v'
  AND a.attnum > 0 AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname, a.attnum
`;

const MATVIEW_EXTRA_QUERY = `
SELECT c.relname AS name,
       n.nspname AS schema,
       c.relispopulated AS is_populated,
       ts.spcname AS tablespace,
       c.reloptions AS storage_options,
       c.relacl AS privileges
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_tablespace ts ON ts.oid = c.reltablespace
WHERE c.relkind = 'm'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
`;

const MATVIEW_COLUMNS_QUERY = `
SELECT n.nspname AS schema,
       c.relname AS name,
       a.attname AS column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS column_type,
       NOT a.attnotnull AS nullable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
WHERE c.relkind = 'm'
  AND a.attnum > 0 AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname, a.attnum
`;


/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{views:Array,materializedViews:Array}>}
 */
export async function queryViews(pool) {
  const viewResult = await pool.query(VIEWS_QUERY);
  const matResult = await pool.query(MATVIEW_EXTRA_QUERY);
  const viewColsResult = await pool.query(VIEW_COLUMNS_QUERY);
  const matColsResult = await pool.query(MATVIEW_COLUMNS_QUERY);

  const matExtras = new Map();
  for (const row of matResult.rows) {
    matExtras.set(`${row.schema}.${row.name}`, row);
  }

  const viewColumns = new Map();
  for (const row of viewColsResult.rows) {
    const key = `${row.schema}.${row.name}`;
    if (!viewColumns.has(key)) viewColumns.set(key, []);
    viewColumns.get(key).push({
      name: row.column_name,
      type: row.column_type,
      nullable: row.nullable,
      default: row.default_value || undefined,
    });
  }

  const matColumns = new Map();
  for (const row of matColsResult.rows) {
    const key = `${row.schema}.${row.name}`;
    if (!matColumns.has(key)) matColumns.set(key, []);
    matColumns.get(key).push({
      name: row.column_name,
      type: row.column_type,
      nullable: row.nullable,
    });
  }

  const views = [];
  const materializedViews = [];

  for (const row of viewResult.rows) {
    const key = `${row.schema}.${row.name}`;
    if (row.kind === 'VIEW') {
      views.push({
        ...row,
        columns: viewColumns.get(key) || [],
      });
    } else {
      const extra = matExtras.get(key) || {};
      materializedViews.push({
        ...row,
        is_populated: extra.is_populated ?? true,
        tablespace: extra.tablespace ?? null,
        storage_options: extra.storage_options ?? null,
        columns: matColumns.get(key) || [],
        privileges: extra.privileges ?? null,
      });
    }
  }

  return { views, materializedViews };
}
