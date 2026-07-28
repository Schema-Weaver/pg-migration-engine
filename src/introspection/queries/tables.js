/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const SCHEMAS_QUERY = `
SELECT n.nspname AS name,
       n.nspowner::regrole::text AS owner,
       n.nspacl AS privileges,
       pg_catalog.obj_description(n.oid, 'pg_namespace') AS comment
FROM pg_catalog.pg_namespace n
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND n.nspname NOT LIKE 'pg_toast_temp_%'
ORDER BY n.nspname
`;

const TABLES_QUERY = `
SELECT c.oid,
       n.nspname AS schema,
       c.relname AS name,
       c.relkind AS kind,
       c.relowner::regrole::text AS owner,
       c.relpersistence AS persistence,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.reloptions AS storage_options,
       CASE WHEN c.reltablespace != 0 THEN (SELECT spcname FROM pg_catalog.pg_tablespace WHERE oid = c.reltablespace) ELSE NULL END AS tablespace,
       CASE WHEN c.relkind = 'p' THEN pt.partstrat ELSE NULL END AS partition_strategy,
       pg_catalog.pg_get_expr(c.relpartbound, c.oid) AS partition_bound,
       c.relreplident AS replica_identity,
       (SELECT idx.relname FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid WHERE i.indrelid = c.oid AND i.indisreplident = true LIMIT 1) AS replica_identity_index,
       pg_catalog.pg_get_partkeydef(c.oid) AS partition_key_def,
       /* HAS_OIDS_PLACEHOLDER */,
       EXISTS (SELECT 1 FROM pg_catalog.pg_class tc JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace JOIN pg_catalog.pg_depend d ON d.objid = tc.oid WHERE tc.relkind = 't' AND tn.nspname = 'pg_toast' AND d.refobjid = c.oid AND d.classid = 'pg_class'::regclass) AS has_toast_table,
       EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_class'::regclass AND d.deptype = 'e') AS user_catalog_table,
       am.amname AS access_method
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_partitioned_table pt ON pt.partrelid = c.oid
LEFT JOIN pg_catalog.pg_am am ON am.oid = c.relam
WHERE c.relkind IN ('r', 'p', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname
`;

const TOAST_OPTIONS_QUERY = `
SELECT 
       n.nspname AS schema,
       c.relname AS table_name,
       tc.relname AS toast_table_name,
       tc.reloptions AS toast_storage_options
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_depend d ON d.refobjid = c.oid AND d.classid = 'pg_class'::regclass
JOIN pg_catalog.pg_class tc ON tc.oid = d.objid AND tc.relkind = 't'
JOIN pg_catalog.pg_namespace tn ON tn.oid = tc.relnamespace AND tn.nspname = 'pg_toast'
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname
`;

const COLUMNS_QUERY = `
SELECT a.attrelid::regclass::text AS table_ref,
       n.nspname AS schema,
       c.relname AS table_name,
       a.attname AS name,
       a.attnum AS ordinal_position,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS is_nullable,
       a.attgenerated AS generated,
       CASE WHEN a.attgenerated IN ('s', 'v') AND d.adbin IS NOT NULL
            THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) 
            ELSE NULL END AS generated_expression,
       CASE WHEN (a.attgenerated IS NULL OR a.attgenerated = '') AND d.adbin IS NOT NULL
            THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) 
            ELSE NULL END AS default_value,
       a.attidentity AS identity,
       CASE WHEN a.attcollation != 0 AND a.attcollation != 100
            THEN a.attcollation::regcollation::text ELSE NULL END AS collation,
       a.attstorage::text AS storage,
       pg_catalog.col_description(a.attrelid, a.attnum) AS comment,
       a.attstattarget AS statistics_target,
       /* COMPRESSION_PLACEHOLDER */
       s.seqstart AS identity_start,
       s.seqincrement AS identity_increment,
       s.seqmin AS identity_min,
       s.seqmax AS identity_max,
       s.seqcycle AS identity_cycle,
        s.seqcache AS identity_cache,
        a.attinhcount AS inherited_count,
        a.attislocal AS is_local,
        a.attacl AS privileges,
        EXISTS (SELECT 1 FROM pg_catalog.pg_constraint con WHERE con.conrelid = a.attrelid AND con.contype = 'p' AND a.attnum = ANY(con.conkey)) AS is_primary_key,
        EXISTS (SELECT 1 FROM pg_catalog.pg_index idx WHERE idx.indrelid = a.attrelid AND idx.indisunique AND a.attnum = ANY(idx.indkey) AND NOT idx.indisprimary) AS is_unique,
        a.attlen AS length,
        a.attndims AS array_dimensions
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
LEFT JOIN pg_catalog.pg_sequence s ON s.seqrelid = (
  SELECT seq.oid FROM pg_catalog.pg_class seq 
  JOIN pg_catalog.pg_namespace seqn ON seqn.oid = seq.relnamespace
  JOIN pg_catalog.pg_depend dep ON dep.objid = seq.oid AND dep.classid = 'pg_class'::regclass
  WHERE seq.relkind = 'S' AND dep.refobjid = a.attrelid AND dep.refobjsubid = a.attnum
    AND seqn.nspname NOT LIKE 'pg_temp_%'
  LIMIT 1
)
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND c.relkind IN ('r', 'p', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname, a.attnum
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{name:string,owner:string}>>}
 */
export async function querySchemas(pool) {
  const result = await pool.query(SCHEMAS_QUERY);
  return result.rows;
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} version
 * @returns {Promise<Array>}
 */
export async function queryTables(pool, version = 150000) {
  const hasOidsCol = (version < 120000) ? 'c.relhasoids' : 'false';
  const query = TABLES_QUERY.replace('/* HAS_OIDS_PLACEHOLDER */', `${hasOidsCol} AS has_oids`);
  const result = await pool.query(query);
  return result.rows;
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} version
 * @returns {Promise<Array>}
 */
export async function queryColumns(pool, version = 150000) {
  const hasCompression = (version >= 140000) ? "a.attcompression::text AS compression," : "NULL AS compression,";
  const query = COLUMNS_QUERY.replace('/* COMPRESSION_PLACEHOLDER */', hasCompression);
  const result = await pool.query(query);
  return result.rows;
}

export async function queryToastOptions(pool) {
  const result = await pool.query(TOAST_OPTIONS_QUERY);
  return result.rows;
}
