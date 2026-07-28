/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const LANGUAGES_QUERY = `
SELECT
  l.oid,
  l.lanname AS name,
  pg_catalog.pg_get_userbyid(l.lanowner) AS owner,
  l.lanispl AS is_pl,
  l.lanpltrusted AS is_trusted,
  CASE WHEN l.lanplcallfoid = 0 THEN NULL ELSE l.lanplcallfoid::regproc::text END AS handler,
  CASE WHEN l.laninline = 0 THEN NULL ELSE l.laninline::regproc::text END AS inline,
  CASE WHEN l.lanvalidator = 0 THEN NULL ELSE l.lanvalidator::regproc::text END AS validator
FROM pg_catalog.pg_language l
WHERE l.lanispl OR l.lanname NOT IN ('internal', 'sql', 'c')
ORDER BY l.lanname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryProceduralLanguages(pool) {
  try {
    const result = await pool.query(LANGUAGES_QUERY);
    
    return result.rows.map(row => ({
      name: row.name,
      owner: row.owner,
      is_pl: row.is_pl,
      is_trusted: row.is_trusted,
      handler: row.handler,
      inline: row.inline,
      validator: row.validator,
    }));
  } catch (error) {
    return [];
  }
}
