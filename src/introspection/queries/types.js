/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const ENUMS_QUERY = `
SELECT t.typname AS name,
       n.nspname AS schema,
       t.typowner::regrole::text AS owner,
       array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS enum_values,
       pg_catalog.obj_description(t.oid, 'pg_type') AS comment,
       t.typacl AS privileges,
       t.typarray::regtype AS array_type
FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
WHERE t.typtype = 'e'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
GROUP BY t.oid, t.typname, n.nspname, t.typowner, t.typacl, t.typarray
ORDER BY n.nspname, t.typname
`;

const COMPOSITES_QUERY = `
SELECT t.typname AS name,
       n.nspname AS schema,
       t.typowner::regrole::text AS owner,
       array_agg(
         json_build_object(
           'name', a.attname, 
           'type', format_type(a.atttypid, a.atttypmod),
           'collation', COALESCE(coll.collname, NULL)
         )
         ORDER BY a.attnum
       ) AS attributes,
       pg_catalog.obj_description(t.oid, 'pg_type') AS comment
FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
JOIN pg_catalog.pg_class c ON c.oid = t.typrelid
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_catalog.pg_collation coll ON coll.oid = a.attcollation
WHERE t.typtype = 'c'
  AND c.relkind = 'c'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
GROUP BY t.oid, t.typname, n.nspname, t.typowner
ORDER BY n.nspname, t.typname
`;

const DOMAINS_QUERY = `
SELECT t.typname AS name,
       n.nspname AS schema,
       t.typowner::regrole::text AS owner,
       format_type(t.typbasetype, t.typtypmod) AS base_type,
       (SELECT n2.nspname FROM pg_type bt JOIN pg_namespace n2 ON n2.oid = bt.typnamespace WHERE bt.oid = t.typbasetype) AS base_type_schema,
       t.typnotnull AS not_null,
       pg_catalog.pg_get_expr(t.typdefaultbin, t.typbasetype) AS default_value,
       pg_catalog.pg_get_constraintdef(con.oid) AS check_constraint,
       pg_catalog.obj_description(t.oid, 'pg_type') AS comment,
       CASE WHEN t.typcollation != 0 THEN t.typcollation::regcollation::text ELSE NULL END AS collation,
       t.typacl AS privileges,
       COALESCE(con.convalidated, true) AS is_validated,
       t.typtypmod AS typmod,
       bt.typlen AS length
FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_constraint con ON con.contypid = t.oid AND con.contype = 'c'
LEFT JOIN pg_catalog.pg_type bt ON bt.oid = t.typbasetype
WHERE t.typtype = 'd'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, t.typname
`;

const RANGES_QUERY_PG19 = `
SELECT t.typname AS name,
       n.nspname AS schema,
       t.typowner::regrole::text AS owner,
       format_type(r.rngsubtype, NULL) AS subtype,
       (SELECT n2.nspname FROM pg_type st JOIN pg_namespace n2 ON n2.oid = st.typnamespace WHERE st.oid = r.rngsubtype) AS subtype_schema,
       r.rngmultitypid::regtype AS multirange_type,
       CASE WHEN r.rngcollation != 0 THEN r.rngcollation::regcollation::text ELSE NULL END AS collation,
       opc.opcname AS subtype_opclass,
       CASE WHEN r.rngsubdiff != 0 THEN r.rngsubdiff::regproc::text ELSE NULL END AS subtype_diff,
       CASE WHEN r.rngcanonical != 0 THEN r.rngcanonical::regproc::text ELSE NULL END AS canonical_function,
       pg_catalog.obj_description(t.oid, 'pg_type') AS comment,
       t.typacl AS privileges,
       r.rngconstruct2 AS construct2,
       r.rngconstruct3 AS construct3,
       r.rngmltconstruct0 AS mltconstruct0,
       r.rngmltconstruct1 AS mltconstruct1,
       r.rngmltconstruct2 AS mltconstruct2
FROM pg_catalog.pg_range r
JOIN pg_catalog.pg_type t ON t.oid = r.rngtypid
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_opclass opc ON opc.oid = r.rngsubopc
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, t.typname
`;

const RANGES_QUERY_PRE_PG19 = `
SELECT t.typname AS name,
       n.nspname AS schema,
       t.typowner::regrole::text AS owner,
       format_type(r.rngsubtype, NULL) AS subtype,
       (SELECT n2.nspname FROM pg_type st JOIN pg_namespace n2 ON n2.oid = st.typnamespace WHERE st.oid = r.rngsubtype) AS subtype_schema,
       r.rngmultitypid::regtype AS multirange_type,
       CASE WHEN r.rngcollation != 0 THEN r.rngcollation::regcollation::text ELSE NULL END AS collation,
       opc.opcname AS subtype_opclass,
       CASE WHEN r.rngsubdiff != 0 THEN r.rngsubdiff::regproc::text ELSE NULL END AS subtype_diff,
       CASE WHEN r.rngcanonical != 0 THEN r.rngcanonical::regproc::text ELSE NULL END AS canonical_function,
       pg_catalog.obj_description(t.oid, 'pg_type') AS comment,
       t.typacl AS privileges,
       NULL::text AS construct2,
       NULL::text AS construct3,
       NULL::text AS mltconstruct0,
       NULL::text AS mltconstruct1,
       NULL::text AS mltconstruct2
FROM pg_catalog.pg_range r
JOIN pg_catalog.pg_type t ON t.oid = r.rngtypid
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_opclass opc ON opc.oid = r.rngsubopc
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, t.typname
`;

const PG_VERSION_19 = 190000;

/**
 * @param {import('pg').Pool} pool
 * @param {number} [version]
 * @returns {Promise<{enums:Array,composites:Array,domains:Array,ranges:Array}>}
 */
export async function queryTypes(pool, version = 150000) {
  const rangesQuery = version >= PG_VERSION_19 ? RANGES_QUERY_PG19 : RANGES_QUERY_PRE_PG19;
  
  const [enums, composites, domains, ranges] = await Promise.all([
    pool.query(ENUMS_QUERY).then(r => r.rows),
    pool.query(COMPOSITES_QUERY).then(r => r.rows),
    pool.query(DOMAINS_QUERY).then(r => r.rows),
    pool.query(rangesQuery).then(r => r.rows),
  ]);
  return { enums, composites, domains, ranges };
}
