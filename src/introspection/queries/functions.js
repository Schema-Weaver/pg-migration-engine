/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const FUNCTIONS_QUERY = `
SELECT p.oid,
       n.nspname AS schema,
       p.proname AS name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS argument_types,
       p.proargnames AS argument_names,
       pg_catalog.pg_get_expr(p.proargdefaults, 0) AS argument_defaults,
       p.proargmodes AS argument_modes,
       pg_catalog.pg_get_function_result(p.oid) AS return_type,
       p.proretset AS return_set,
       l.lanname AS language,
       p.prosrc AS source,
       p.probin AS precompiled_body,
       CASE p.provolatile
         WHEN 'i' THEN 'IMMUTABLE'
         WHEN 's' THEN 'STABLE'
         WHEN 'v' THEN 'VOLATILE'
       END AS volatility,
       p.proisstrict AS is_strict,
       CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END AS security,
       CASE p.proparallel
         WHEN 's' THEN 'SAFE'
         WHEN 'u' THEN 'UNSAFE'
         WHEN 'r' THEN 'RESTRICTED'
       END AS parallel,
       p.proleakproof AS is_leakproof,
       p.procost AS cost,
       p.prorows AS rows,
       CASE p.prokind
         WHEN 'f' THEN 'FUNCTION'
         WHEN 'p' THEN 'PROCEDURE'
         WHEN 'a' THEN 'AGGREGATE'
         WHEN 'w' THEN 'WINDOW'
       END AS kind,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.proconfig AS configuration,
       p.proacl AS privileges,
       CASE WHEN p.prosupport != 0 THEN p.prosupport::regproc::text ELSE NULL END AS support_function,
       pg_catalog.obj_description(p.oid, 'pg_proc') AS comment,
       a.aggtransfn::text AS agg_sfunc,
       a.aggfinalfn::text AS agg_finalfunc,
       a.aggcombinefn::text AS agg_combinefunc,
       a.aggtranstype::regtype::text AS agg_stype,
       a.agginitval AS agg_initcond,
       a.aggtransspace AS agg_sspace,
       a.aggfinalextra AS agg_finalfunc_extra,
       CASE a.aggfinalmodify
         WHEN 'r' THEN 'READ_ONLY'
         WHEN 's' THEN 'SHAREABLE'
         WHEN 'w' THEN 'READ_WRITE'
       END AS agg_finalfunc_modify,
       a.aggserialfn::text AS agg_serialfunc,
       a.aggdeserialfn::text AS agg_deserialfunc,
       CASE WHEN a.aggsortop != 0 THEN a.aggsortop::regoper::text ELSE NULL END AS agg_sortop,
       CASE a.aggkind
         WHEN 'n' THEN false
         WHEN 'h' THEN true
       END AS agg_hypothetical
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language l ON l.oid = p.prolang
LEFT JOIN pg_catalog.pg_aggregate a ON a.aggfnoid = p.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, p.proname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryFunctions(pool) {
  const result = await pool.query(FUNCTIONS_QUERY);
  return result.rows;
}
