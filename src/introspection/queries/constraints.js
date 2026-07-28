/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const CONSTRAINTS_QUERY_PG16 = `
SELECT c.oid,
       n.nspname AS schema,
       c.conname AS name,
       c.contype AS type,
       tc.relname AS table_name,
       tn.nspname AS table_schema,
       c.conrelid::regclass::text AS table_ref,
       fc.relname AS referenced_table,
       fn.nspname AS referenced_schema,
       pg_catalog.pg_get_constraintdef(c.oid, true) AS definition,
       c.convalidated AS is_validated,
       c.condeferrable AS deferrable,
       c.condeferred AS initially_deferred,
       c.conkey AS column_indices,
       c.confkey AS foreign_column_indices,
       c.confupdtype AS on_update,
       c.confdeltype AS on_delete,
       c.confmatchtype AS match_type,
       c.coninhcount > 0 AS is_inherited,
       c.conislocal AS is_local,
       c.connoinherit AS no_inherit,
       i.indnullsnotdistinct AS nulls_not_distinct,
       pg_catalog.col_description(c.oid, 0) AS comment,
       CASE WHEN c.contype = 'x' THEN pg_catalog.pg_get_expr(c.conbin, c.conrelid) ELSE NULL END AS exclusion_expression
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
LEFT JOIN pg_catalog.pg_class tc ON tc.oid = c.conrelid
LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace
LEFT JOIN pg_catalog.pg_class fc ON fc.oid = c.confrelid
LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.conindid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, tc.relname, c.conname
`;

const CONSTRAINTS_QUERY_PG15 = `
SELECT c.oid,
       n.nspname AS schema,
       c.conname AS name,
       c.contype AS type,
       tc.relname AS table_name,
       tn.nspname AS table_schema,
       c.conrelid::regclass::text AS table_ref,
       fc.relname AS referenced_table,
       fn.nspname AS referenced_schema,
       pg_catalog.pg_get_constraintdef(c.oid, true) AS definition,
       c.convalidated AS is_validated,
       c.condeferrable AS deferrable,
       c.condeferred AS initially_deferred,
       c.conkey AS column_indices,
       c.confkey AS foreign_column_indices,
       c.confupdtype AS on_update,
       c.confdeltype AS on_delete,
       c.confmatchtype AS match_type,
       c.coninhcount > 0 AS is_inherited,
       c.conislocal AS is_local,
       c.connoinherit AS no_inherit,
       NULL AS nulls_not_distinct,
       pg_catalog.col_description(c.oid, 0) AS comment,
       CASE WHEN c.contype = 'x' THEN pg_catalog.pg_get_expr(c.conbin, c.conrelid) ELSE NULL END AS exclusion_expression
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
LEFT JOIN pg_catalog.pg_class tc ON tc.oid = c.conrelid
LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace
LEFT JOIN pg_catalog.pg_class fc ON fc.oid = c.confrelid
LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, tc.relname, c.conname
`;

const FK_ACTION_MAP = {
  'a': 'NO ACTION',
  'r': 'RESTRICT',
  'c': 'CASCADE',
  'n': 'SET NULL',
  'd': 'SET DEFAULT',
};

const FK_MATCH_MAP = {
  'f': 'FULL',
  'p': 'PARTIAL',
  's': 'SIMPLE',
};

const CONTYPE_MAP = {
  'p': 'primary_key',
  'u': 'unique',
  'f': 'foreign_key',
  'c': 'check',
  'x': 'exclusion',
  'n': 'not_null',
};

/**
 * @param {import('pg').Pool} pool
 * @param {number} version
 * @returns {Promise<Array>}
 */
export async function queryConstraints(pool, version) {
  const query = version >= 160000 ? CONSTRAINTS_QUERY_PG16 : CONSTRAINTS_QUERY_PG15;
  const result = await pool.query(query);
  return result.rows.map(row => ({
    ...row,
    type: CONTYPE_MAP[row.type] || row.type,
    on_update: FK_ACTION_MAP[row.on_update] || row.on_update,
    on_delete: FK_ACTION_MAP[row.on_delete] || row.on_delete,
    match_type: FK_MATCH_MAP[row.match_type] || row.match_type,
    nulls_not_distinct: version >= 160000 ? row.nulls_not_distinct : null,
  }));
}
