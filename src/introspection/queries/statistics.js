/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const STATISTICS_QUERY = `
SELECT
  s.oid,
  n.nspname AS schema,
  s.stxname AS name,
  pg_catalog.pg_get_userbyid(s.stxowner) AS owner,
  s.stxkind AS kinds,
  s.stxkeys AS columns_raw,
  c.relname AS table_name,
  n2.nspname AS table_schema,
  pg_catalog.pg_get_statisticsobjdef(s.oid) AS definition,
  s.stxstattarget AS statistics_target,
  pg_catalog.obj_description(s.oid, 'pg_statistic_ext') AS comment,
  pg_catalog.pg_relation_size(s.oid) AS size
FROM pg_catalog.pg_statistic_ext s
JOIN pg_catalog.pg_namespace n ON n.oid = s.stxnamespace
JOIN pg_catalog.pg_class c ON c.oid = s.stxrelid
JOIN pg_catalog.pg_namespace n2 ON n2.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, s.stxname
`;

const KIND_MAP = {
  'd': 'ndistinct',
  'f': 'dependencies',
  'm': 'mcv',
};

/**
 * @param {import('pg').Pool} pool
 * @param {number} version
 * @returns {Promise<Array>}
 */
export async function queryStatistics(pool, version) {
  if (version < 100000) return [];

  try {
    const result = await pool.query(STATISTICS_QUERY);
    
    return result.rows.map(row => {
      let kinds = [];
      if (row.kinds && typeof row.kinds === 'string') {
        kinds = row.kinds.split('').map(k => KIND_MAP[k] || k);
      } else if (Array.isArray(row.kinds)) {
        kinds = row.kinds.map(k => KIND_MAP[k] || k);
      }

      let columns = [];
      if (row.columns_raw) {
        if (typeof row.columns_raw === 'string') {
          columns = row.columns_raw.split(' ').filter(Boolean);
        } else if (Array.isArray(row.columns_raw)) {
          columns = row.columns_raw.map(String);
        }
      }

      return {
        schema: row.schema,
        name: row.name,
        owner: row.owner,
        kinds,
        columns,
        table_name: row.table_name,
        table_schema: row.table_schema,
        definition: row.definition,
        statisticsTarget: row.statistics_target ?? undefined,
        comment: row.comment || undefined,
        size: row.size ?? undefined,
      };
    });
  } catch (error) {
    return [];
  }
}
