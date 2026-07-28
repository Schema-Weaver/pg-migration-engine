/**
 * Schema Weaver Migration Engine - Schema Introspection
 * https://schemaweaver.vivekmind.com/
 */
export async function detectPgVersion(pool) {
  const result = await pool.query("SELECT current_setting('server_version_num')::int AS version_num");
  return result.rows[0].version_num;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
export async function detectPgVersionString(pool) {
  const result = await pool.query("SELECT current_setting('server_version') AS version");
  return result.rows[0].version;
}

/**
 * @param {number} versionNum
 * @returns {number}
 */
export function majorVersion(versionNum) {
  return Math.floor(versionNum / 10000);
}
