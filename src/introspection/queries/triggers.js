/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const TRIGGERS_QUERY = `
SELECT t.tgname AS name,
       n.nspname AS schema,
       c.relname AS table_name,
       tn.nspname AS table_schema,
       CASE
         WHEN (t.tgtype::int & 2) != 0 THEN 'BEFORE'
         WHEN (t.tgtype::int & 64) != 0 THEN 'INSTEAD OF'
         ELSE 'AFTER'
       END AS timing,
       array_remove(ARRAY[
         CASE WHEN (t.tgtype::int & 4) != 0 THEN 'INSERT' ELSE NULL END,
         CASE WHEN (t.tgtype::int & 8) != 0 THEN 'DELETE' ELSE NULL END,
         CASE WHEN (t.tgtype::int & 16) != 0 THEN 'UPDATE' ELSE NULL END,
         CASE WHEN (t.tgtype::int & 32) != 0 THEN 'TRUNCATE' ELSE NULL END
       ], NULL) AS events,
       CASE WHEN (t.tgtype::int & 1) != 0 THEN 'ROW' ELSE 'STATEMENT' END AS level,
       (t.tgtype::int & 1) != 0 AS is_for_each_row,
        pg_catalog.pg_get_triggerdef(t.oid) AS definition,
        CASE t.tgenabled
          WHEN 'O' THEN 'ENABLED'
          WHEN 'D' THEN 'DISABLED'
          WHEN 'R' THEN 'REPLICA'
          WHEN 'A' THEN 'ALWAYS'
        END AS enabled,
        p.proname AS function_name,
        pn.nspname AS function_schema,
        NULL AS when_condition,
        t.tgconstraint IS NOT NULL AS is_constraint,
       t.tgdeferrable AS is_deferrable,
       t.tginitdeferred AS is_deferred,
       (SELECT array_agg(a.attname)
        FROM unnest(t.tgattr) AS uattnum
        JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = uattnum
       ) AS update_of_columns,
       t.tgoldtable AS old_table_name,
       t.tgnewtable AS new_table_name,
       pg_catalog.obj_description(t.oid, 'pg_trigger') AS comment
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_namespace tn ON tn.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND NOT t.tgisinternal
ORDER BY tn.nspname, c.relname, t.tgname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryTriggers(pool) {
  const result = await pool.query(TRIGGERS_QUERY);
  return result.rows.map(row => ({
    ...row,
    events: (row.events || []).filter(Boolean),
    function_call: `${row.function_schema}.${row.function_name}`,
  }));
}
