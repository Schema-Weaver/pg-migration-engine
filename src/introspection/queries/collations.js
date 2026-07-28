/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
function buildCollationsQuery(version) {
  const icuRulesField = version >= 160000
    ? 'c.collicurules AS icu_rules,'
    : 'NULL::text AS icu_rules,';

  const icuLocaleField = version >= 170000
    ? 'c.colllocale AS icu_locale,'
    : 'NULL::text AS icu_locale,';

  return `
SELECT
  c.oid,
  n.nspname AS schema,
  c.collname AS name,
  pg_catalog.pg_get_userbyid(c.collowner) AS owner,
  CASE c.collprovider
    WHEN 'b' THEN 'builtin'
    WHEN 'c' THEN 'libc'
    WHEN 'i' THEN 'icu'
    WHEN 'd' THEN 'default'
  END AS provider,
  c.collcollate AS lc_collate,
  c.collctype AS lc_ctype,
  c.collcollate AS locale,
  c.collencoding AS encoding,
  COALESCE(c.collisdeterministic, true) AS is_deterministic,
  c.collversion AS version,
  ${icuRulesField}
  ${icuLocaleField}
  pg_catalog.obj_description(c.oid, 'pg_collation') AS comment
FROM pg_catalog.pg_collation c
JOIN pg_catalog.pg_namespace n ON n.oid = c.collnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND c.collname NOT LIKE 'pg_%'
ORDER BY n.nspname, c.collname
`;
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} version
 * @returns {Promise<Array>}
 */
export async function queryCollations(pool, version) {
  try {
    const query = buildCollationsQuery(version);
    const result = await pool.query(query);

    return result.rows.map(row => ({
      schema: row.schema,
      name: row.name,
      owner: row.owner,
      provider: row.provider,
      locale: row.locale,
      lcCollate: row.lc_collate || undefined,
      lcCtype: row.lc_ctype || undefined,
      encoding: row.encoding,
      isDeterministic: row.is_deterministic,
      version: row.version || undefined,
      icuRules: row.icu_rules || undefined,
      icuLocale: row.icu_locale || undefined,
      comment: row.comment || undefined,
    }));
  } catch (error) {
    return [];
  }
}
