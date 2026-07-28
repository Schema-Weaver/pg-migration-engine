/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const TEXT_SEARCH_CONFIGS_QUERY = `
SELECT
  t.oid,
  n.nspname AS schema,
  t.cfgname AS name,
  pg_catalog.pg_get_userbyid(t.cfgowner) AS owner,
  format_type(t.cfgparser, NULL) AS parser,
  n2.nspname AS parser_schema,
  pg_catalog.obj_description(t.oid, 'pg_ts_config') AS comment
FROM pg_catalog.pg_ts_config t
JOIN pg_catalog.pg_namespace n ON n.oid = t.cfgnamespace
LEFT JOIN pg_catalog.pg_ts_parser p ON p.oid = t.cfgparser
LEFT JOIN pg_catalog.pg_namespace n2 ON n2.oid = p.prsnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, t.cfgname
`;

const TEXT_SEARCH_CONFIG_MAP_QUERY = `
SELECT
  n.nspname AS schema,
  t.cfgname AS config_name,
  m.maptokentype AS token_type,
  m.mapseqno AS seq,
  d.dictname AS dictionary,
  nd.nspname AS dict_schema,
  m.mapdict AS dict_oid
FROM pg_catalog.pg_ts_config_map m
JOIN pg_catalog.pg_ts_config t ON t.oid = m.mapcfg
JOIN pg_catalog.pg_namespace n ON n.oid = t.cfgnamespace
JOIN pg_catalog.pg_ts_dict d ON d.oid = m.mapdict
JOIN pg_catalog.pg_namespace nd ON nd.oid = d.dictnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, t.cfgname, m.mapseqno
`;

const TEXT_SEARCH_DICTIONARIES_QUERY = `
SELECT
  d.oid,
  n.nspname AS schema,
  d.dictname AS name,
  pg_catalog.pg_get_userbyid(d.dictowner) AS owner,
  format_type(d.dicttemplate, NULL) AS template,
  n2.nspname AS template_schema,
  d.dictinitoption AS options,
  pg_catalog.obj_description(d.oid, 'pg_ts_dict') AS comment
FROM pg_catalog.pg_ts_dict d
JOIN pg_catalog.pg_namespace n ON n.oid = d.dictnamespace
LEFT JOIN pg_catalog.pg_ts_template t ON t.oid = d.dicttemplate
LEFT JOIN pg_catalog.pg_namespace n2 ON n2.oid = t.tmplnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, d.dictname
`;

const TEXT_SEARCH_PARSERS_QUERY = `
SELECT
  p.oid,
  n.nspname AS schema,
  p.prsname AS name,
  pg_catalog.pg_get_userbyid(p.prsowner) AS owner,
  p.prsstart::regproc::text AS start,
  p.prstoken::regproc::text AS get_token,
  p.prsend::regproc::text AS end,
  p.prsheadline::regproc::text AS headline,
  p.prslextype::regproc::text AS lextypes,
  pg_catalog.obj_description(p.oid, 'pg_ts_parser') AS comment
FROM pg_catalog.pg_ts_parser p
JOIN pg_catalog.pg_namespace n ON n.oid = p.prsnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, p.prsname
`;

const TEXT_SEARCH_TEMPLATES_QUERY = `
SELECT
  t.oid,
  n.nspname AS schema,
  t.tmplname AS name,
  pg_catalog.pg_get_userbyid(t.tmplowner) AS owner,
  t.tmplinit::regproc::text AS init,
  t.tmpllexize::regproc::text AS lexize,
  pg_catalog.obj_description(t.oid, 'pg_ts_template') AS comment
FROM pg_catalog.pg_ts_template t
JOIN pg_catalog.pg_namespace n ON n.oid = t.tmplnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, t.tmplname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{configs: Array, tokenMappings: Array}>}
 */
export async function queryTextSearchConfigs(pool) {
  try {
    const configsResult = await pool.query(TEXT_SEARCH_CONFIGS_QUERY);
    let mappingsResult = { rows: [] };
    try {
      mappingsResult = await pool.query(TEXT_SEARCH_CONFIG_MAP_QUERY);
    } catch (e) {
      // May fail on older versions
    }
    return {
      configs: configsResult.rows,
      tokenMappings: mappingsResult.rows,
    };
  } catch (error) {
    return { configs: [], tokenMappings: [] };
  }
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryTextSearchDictionaries(pool) {
  try {
    const result = await pool.query(TEXT_SEARCH_DICTIONARIES_QUERY);
    return result.rows;
  } catch (error) {
    return [];
  }
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryTextSearchParsers(pool) {
  try {
    const result = await pool.query(TEXT_SEARCH_PARSERS_QUERY);
    return result.rows;
  } catch (error) {
    return [];
  }
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryTextSearchTemplates(pool) {
  try {
    const result = await pool.query(TEXT_SEARCH_TEMPLATES_QUERY);
    return result.rows;
  } catch (error) {
    return [];
  }
}
