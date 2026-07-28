/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const INDEXES_QUERY_PG16 = `
SELECT c.relname AS index_name,
       n.nspname AS schema,
       c.relname AS index_relname,
       t.relname AS table_name,
       tn.nspname AS table_schema,
       c.relowner::regrole::text AS owner,
       ix.indisunique AS is_unique,
       ix.indisprimary AS is_primary,
       am.amname AS method,
       ix.indkey AS column_indices,
       pg_catalog.pg_get_indexdef(ix.indexrelid) AS definition,
       CASE WHEN ix.indpred IS NOT NULL THEN pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) ELSE NULL END AS where_clause,
       CASE WHEN c.reltablespace != 0 THEN (SELECT spcname FROM pg_catalog.pg_tablespace WHERE oid = c.reltablespace) ELSE NULL END AS tablespace,
       c.reloptions AS storage_options,
       pg_catalog.obj_description(ix.indexrelid, 'pg_class') AS comment,
       ix.indisvalid AS is_valid,
       ix.indisready AS is_ready,
       ix.indislive AS is_live,
       ix.indisreplident AS is_replica_identity,
       ix.indisclustered AS is_clustered,
       ix.indnkeyatts AS number_of_key_columns,
       ix.indoption AS column_options,
       ix.indnullsnotdistinct AS nulls_not_distinct,
       (SELECT (regexp_matches(unnest_opt, 'pages_per_range=(\\d+)'))[1]::int
        FROM unnest(COALESCE(c.reloptions, ARRAY[]::text[])) AS unnest_opt
        WHERE unnest_opt LIKE 'pages_per_range=%'
        LIMIT 1
       ) AS brin_pages_per_range
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class c ON c.oid = ix.indexrelid
JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_namespace tn ON tn.oid = t.relnamespace
JOIN pg_catalog.pg_am am ON am.oid = c.relam
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY tn.nspname, t.relname, c.relname
`;

const INDEXES_QUERY_PG15 = `
SELECT c.relname AS index_name,
       n.nspname AS schema,
       c.relname AS index_relname,
       t.relname AS table_name,
       tn.nspname AS table_schema,
       c.relowner::regrole::text AS owner,
       ix.indisunique AS is_unique,
       ix.indisprimary AS is_primary,
       am.amname AS method,
       ix.indkey AS column_indices,
       pg_catalog.pg_get_indexdef(ix.indexrelid) AS definition,
       CASE WHEN ix.indpred IS NOT NULL THEN pg_catalog.pg_get_expr(ix.indpred, ix.indrelid) ELSE NULL END AS where_clause,
       CASE WHEN c.reltablespace != 0 THEN (SELECT spcname FROM pg_catalog.pg_tablespace WHERE oid = c.reltablespace) ELSE NULL END AS tablespace,
       c.reloptions AS storage_options,
       pg_catalog.obj_description(ix.indexrelid, 'pg_class') AS comment,
       ix.indisvalid AS is_valid,
       ix.indisready AS is_ready,
       ix.indislive AS is_live,
       ix.indisreplident AS is_replica_identity,
       ix.indisclustered AS is_clustered,
       ix.indnkeyatts AS number_of_key_columns,
       ix.indoption AS column_options,
       false AS nulls_not_distinct,
       (SELECT (regexp_matches(unnest_opt, 'pages_per_range=(\\d+)'))[1]::int
        FROM unnest(COALESCE(c.reloptions, ARRAY[]::text[])) AS unnest_opt
        WHERE unnest_opt LIKE 'pages_per_range=%'
        LIMIT 1
       ) AS brin_pages_per_range
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class c ON c.oid = ix.indexrelid
JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_namespace tn ON tn.oid = t.relnamespace
JOIN pg_catalog.pg_am am ON am.oid = c.relam
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY tn.nspname, t.relname, c.relname
`;


const INDEX_COLUMNS_QUERY = `
WITH index_keys AS (
  SELECT 
    i.indexrelid,
    i.indrelid,
    i.indkey,
    i.indoption,
    i.indcollation,
    i.indclass,
    i.indexprs,
    t.idx,
    t.ordinality,
    t.ordinality - 1 AS idx_offset
  FROM pg_catalog.pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS t(idx, ordinality)
)
SELECT 
  ik.indexrelid::regclass::text AS index_name,
  n.nspname AS schema,
  c.relname AS index_relname,
  ik.idx AS attnum,
  CASE WHEN ik.idx = 0 THEN NULL ELSE a.attname END AS column_name,
  ik.ordinality AS position,
  COALESCE(coll.collname, NULL) AS collation,
  COALESCE(opc.opcname, NULL) AS opclass,
  CASE WHEN (ik.indoption[ik.idx_offset] & 1) = 1 THEN 'DESC' ELSE 'ASC' END AS direction,
  CASE WHEN (ik.indoption[ik.idx_offset] & 2) = 2 THEN 'NULLS FIRST' ELSE 'NULLS LAST' END AS nulls_order,
  pg_catalog.col_description(a.attrelid, a.attnum) AS column_comment,
  CASE WHEN ik.idx = 0 AND ik.indexprs IS NOT NULL THEN
    pg_catalog.pg_get_indexdef(ik.indexrelid, (ik.idx_offset + 1)::integer, true)
  ELSE NULL END AS expression
FROM index_keys ik
JOIN pg_catalog.pg_class c ON c.oid = ik.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = ik.indrelid AND a.attnum = ik.idx
LEFT JOIN pg_catalog.pg_collation coll ON coll.oid = ik.indcollation[ik.idx_offset]
LEFT JOIN pg_catalog.pg_opclass opc ON opc.oid = ik.indclass[ik.idx_offset]
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname, ik.ordinality
`;

/**
 * @param {import('pg').Pool} pool
 * @param {number} [version]
 * @returns {Promise<Array>}
 */
export async function queryIndexes(pool, version = 150000) {
  const query = version >= 160000 ? INDEXES_QUERY_PG16 : INDEXES_QUERY_PG15;
  const result = await pool.query(query);
  return result.rows;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryIndexColumns(pool) {
  const result = await pool.query(INDEX_COLUMNS_QUERY);
  return result.rows;
}
