/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const SEQUENCES_QUERY = `
SELECT s.relname AS name,
       n.nspname AS schema,
       s.relowner::regrole::text AS owner,
       seq.seqtypid::regtype::text AS data_type,
       seq.seqstart AS start_value,
       seq.seqincrement AS increment,
       seq.seqmin AS min_value,
       seq.seqmax AS max_value,
       seq.seqcache AS cache,
       seq.seqcycle AS cycle,
       CASE
         WHEN d.refobjid IS NOT NULL THEN
            d.refobjid::regclass::text || '.'::text || a.attname
         ELSE NULL
       END AS owned_by,
       CASE WHEN s.reltablespace != 0 THEN (SELECT spcname FROM pg_catalog.pg_tablespace WHERE oid = s.reltablespace) ELSE NULL END AS tablespace,
       pg_catalog.obj_description(s.oid, 'pg_class') AS comment,
       pg_catalog.pg_sequence_last_value(seq.seqrelid) AS current_value
FROM pg_catalog.pg_sequence seq
JOIN pg_catalog.pg_class s ON s.oid = seq.seqrelid
JOIN pg_catalog.pg_namespace n ON n.oid = s.relnamespace
LEFT JOIN pg_catalog.pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i') AND d.classid = 'pg_class'::regclass
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, s.relname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function querySequences(pool) {
  const result = await pool.query(SEQUENCES_QUERY);
  return result.rows;
}
