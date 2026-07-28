/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const PARTITIONS_QUERY = `
SELECT parent.relname AS parent_table,
       pn.nspname AS parent_schema,
       child.relname AS child_table,
       cn.nspname AS child_schema,
       pt.partstrat AS strategy,
       pt.partnatts AS num_columns,
       array_agg(pa.attname ORDER BY array_position(pt.partattrs, pa.attnum)) AS partition_columns,
       pg_catalog.pg_get_expr(child.relpartbound, child.oid) AS partition_bound,
       child.relispartition AS is_partition,
       COALESCE(
         (SELECT true FROM pg_catalog.pg_partitioned_table cp WHERE cp.partrelid = child.oid),
         false
       ) AS is_default,
       pg_catalog.pg_get_expr(pt.partexprs, pt.partrelid) AS partition_expression
FROM pg_catalog.pg_inherits i
JOIN pg_catalog.pg_class parent ON parent.oid = i.inhparent
JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
JOIN pg_catalog.pg_class child ON child.oid = i.inhrelid
JOIN pg_catalog.pg_namespace cn ON cn.oid = child.relnamespace
JOIN pg_catalog.pg_partitioned_table pt ON pt.partrelid = parent.oid
LEFT JOIN pg_catalog.pg_attribute pa ON pa.attrelid = parent.oid
  AND pa.attnum = ANY(pt.partattrs)
  AND pa.attnum > 0
  AND NOT pa.attisdropped
WHERE parent.relkind = 'p'
  AND pn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND pn.nspname NOT LIKE 'pg_temp_%'
GROUP BY parent.oid, parent.relname, pn.nspname,
         child.oid, child.relname, cn.nspname,
         pt.partstrat, pt.partnatts, child.relpartbound, child.relispartition, 
         pt.partexprs, pt.partrelid
ORDER BY pn.nspname, parent.relname, child.relname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryPartitions(pool) {
  const result = await pool.query(PARTITIONS_QUERY);
  return result.rows;
}
