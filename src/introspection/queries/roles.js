/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const ROLES_QUERY = `
SELECT
  r.oid,
  r.rolname AS name,
  r.rolsuper AS is_superuser,
  r.rolinherit AS inherit,
  r.rolcreaterole AS can_create_role,
  r.rolcreatedb AS can_create_db,
  r.rolcanlogin AS can_login,
  r.rolreplication AS is_replication,
  r.rolconnlimit AS conn_limit,
  r.rolvaliduntil AS valid_until,
  pg_catalog.shobj_description(r.oid, 'pg_authid') AS comment
FROM pg_catalog.pg_roles r
WHERE r.rolname NOT LIKE 'pg_%'
ORDER BY r.rolname
`;

const ROLE_MEMBERSHIPS_QUERY = `
SELECT
  m.roleid::regrole::text AS role,
  m.member::regrole::text AS member,
  m.admin_option AS admin_option
FROM pg_catalog.pg_auth_members m
ORDER BY m.roleid, m.member
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryRoles(pool) {
  try {
    const [rolesResult, membershipsResult] = await Promise.all([
      pool.query(ROLES_QUERY),
      pool.query(ROLE_MEMBERSHIPS_QUERY),
    ]);

    const membershipMap = new Map();
    for (const m of membershipsResult.rows) {
      if (!membershipMap.has(m.role)) {
        membershipMap.set(m.role, []);
      }
      membershipMap.get(m.role).push({
        member: m.member,
        admin_option: m.admin_option,
      });
    }

    return rolesResult.rows.map(row => ({
      name: row.name,
      is_superuser: row.is_superuser,
      inherit: row.inherit,
      can_create_role: row.can_create_role,
      can_create_db: row.can_create_db,
      can_login: row.can_login,
      is_replication: row.is_replication,
      conn_limit: row.conn_limit,
      valid_until: row.valid_until,
      comment: row.comment || undefined,
      memberships: membershipMap.get(row.name) || [],
    }));
  } catch (error) {
    return [];
  }
}
