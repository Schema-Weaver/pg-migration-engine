/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const FDW_QUERY = `
SELECT
  f.oid,
  f.fdwname AS name,
  pg_catalog.pg_get_userbyid(f.fdwowner) AS owner,
  f.fdwhandler::regproc::text AS handler,
  f.fdwvalidator::regproc::text AS validator,
  f.fdwoptions AS options,
  f.fdwacl AS privileges,
  pg_catalog.obj_description(f.oid, 'pg_foreign_data_wrapper') AS comment
FROM pg_catalog.pg_foreign_data_wrapper f
ORDER BY f.fdwname
`;

const FOREIGN_SERVERS_QUERY = `
SELECT
  s.oid,
  s.srvname AS name,
  pg_catalog.pg_get_userbyid(s.srvowner) AS owner,
  s.srvtype AS type,
  s.srvversion AS version,
  f.fdwname AS fdw,
  s.srvoptions AS options,
  s.srvacl AS privileges,
  pg_catalog.obj_description(s.oid, 'pg_foreign_server') AS comment
FROM pg_catalog.pg_foreign_server s
JOIN pg_catalog.pg_foreign_data_wrapper f ON f.oid = s.srvfdw
ORDER BY s.srvname
`;

const USER_MAPPINGS_QUERY = `
SELECT
  u.oid,
  pg_catalog.pg_get_userbyid(u.umuser) AS user,
  s.srvname AS server,
  u.umoptions AS options
FROM pg_catalog.pg_user_mapping u
JOIN pg_catalog.pg_foreign_server s ON s.oid = u.umserver
ORDER BY s.srvname, u.umuser
`;

const FOREIGN_TABLES_QUERY = `
SELECT
  c.oid,
  n.nspname AS schema,
  c.relname AS name,
  s.srvname AS server_name,
  f.ftoptions AS options,
  pg_catalog.obj_description(c.oid, 'pg_class') AS comment,
  c.relacl AS privileges
FROM pg_catalog.pg_foreign_table f
JOIN pg_catalog.pg_class c ON c.oid = f.ftrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_foreign_server s ON s.oid = f.ftserver
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname
`;

const FOREIGN_TABLE_COLUMNS_QUERY = `
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  a.attname AS column_name,
  a.attfdwoptions AS options
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_foreign_table f ON f.ftrelid = c.oid
WHERE a.attnum > 0 AND NOT a.attisdropped
  AND a.attfdwoptions IS NOT NULL
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp_%'
ORDER BY n.nspname, c.relname, a.attnum
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryForeignDataWrappers(pool) {
  try {
    const result = await pool.query(FDW_QUERY);
    return result.rows;
  } catch (error) {
    return [];
  }
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryForeignServers(pool) {
  try {
    const result = await pool.query(FOREIGN_SERVERS_QUERY);
    return result.rows;
  } catch (error) {
    return [];
  }
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryUserMappings(pool) {
  try {
    const result = await pool.query(USER_MAPPINGS_QUERY);
    return result.rows;
  } catch (error) {
    return [];
  }
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{tables: Array, columnOptions: Array}>}
 */
export async function queryForeignTables(pool) {
  try {
    const tablesResult = await pool.query(FOREIGN_TABLES_QUERY);
    let columnsResult = { rows: [] };
    try {
      columnsResult = await pool.query(FOREIGN_TABLE_COLUMNS_QUERY);
    } catch (e) {
      // Column options query may fail on older PG versions
    }
    return {
      tables: tablesResult.rows,
      columnOptions: columnsResult.rows,
    };
  } catch (error) {
    return { tables: [], columnOptions: [] };
  }
}
