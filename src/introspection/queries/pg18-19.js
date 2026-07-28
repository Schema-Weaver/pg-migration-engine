/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */

const PG_VERSION_18 = 180000;
const PG_VERSION_19 = 190000;

const PG18_NOT_ENFORCED_QUERY = `
SELECT n.nspname AS schema,
       c.conname AS name,
       c.conrelid::regclass::text AS table_ref,
       NOT c.conenforced AS not_enforced
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
WHERE c.conenforced = false
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
`;

const PG18_VIRTUAL_COLUMNS_QUERY = `
SELECT a.attrelid::regclass::text AS table_ref,
       n.nspname AS schema,
       c.relname AS table_name,
       a.attname AS name,
       a.attgenerated AS generated_type
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE a.attgenerated = 'v'
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname NOT LIKE 'pg_temp_%'
`;

const PG19_NOT_ENFORCED_CHECK_QUERY = `
SELECT n.nspname AS schema,
       c.conname AS name,
       c.conrelid::regclass::text AS table_ref,
       c.contype AS constraint_type,
       NOT c.conenforced AS not_enforced
FROM pg_catalog.pg_constraint c
JOIN pg_catalog.pg_namespace n ON n.oid = c.connamespace
WHERE c.conenforced = false
  AND c.contype IN ('c', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
`;

export async function queryPg18Features(pool) {
  const [notEnforced, virtualColumns] = await Promise.all([
    pool.query(PG18_NOT_ENFORCED_QUERY).then(r => r.rows),
    pool.query(PG18_VIRTUAL_COLUMNS_QUERY).then(r => r.rows),
  ]);
  return { notEnforced, virtualColumns };
}

export async function queryPg19Features(pool, version) {
  if (version < PG_VERSION_19) {
    return { 
      notEnforcedChecks: [],
      propertyGraphs: [] 
    };
  }

  const results = {
    notEnforcedChecks: [],
    propertyGraphs: [],
  };

  try {
    results.notEnforcedChecks = await pool.query(PG19_NOT_ENFORCED_CHECK_QUERY).then(r => r.rows);
  } catch (e) {
  }

  return results;
}

export function shouldQueryPropertyGraphs(version) {
  return false;
}

export function getNotEnforcedConstraintTypes(version) {
  if (version < PG_VERSION_18) {
    return [];
  }
  if (version < PG_VERSION_19) {
    return ['f'];
  }
  return ['c', 'f'];
}
