/**
 * Schema Weaver Migration Engine - DDL Generator
 * https://schemaweaver.vivekmind.com/
 */
function ident(name) {
  if (!name) return '';
  if (name.includes('"') || name.includes(' ')) {
    return `"${name.replace(/"/g, '""')}"`;
  }
  return `"${name}"`;
}

/**
 * @param {import('../types/changes.js').SchemaChange} change
 * @returns {string}
 */
export function generateGrantSql(change) {
  const type = change.changeType || change.type;
  if (type === 'GRANT') {
    const g = change.after || {};
    const grantee = g.grantee || 'PUBLIC';
    const granteeRef = grantee.toUpperCase() === 'PUBLIC' ? 'PUBLIC' : ident(grantee);
    let sql = `GRANT ${g.privilege || 'ALL'} ON ${g.objectType || 'TABLE'} ${ident(g.schema)}.${ident(g.object)} TO ${granteeRef}`;
    if (g.isGrantable || g.withGrantOption) sql += ' WITH GRANT OPTION';
    return sql + ';';
  }
  if (type === 'REVOKE') {
    const g = change.before || {};
    const grantee = g.grantee || 'PUBLIC';
    const granteeRef = grantee.toUpperCase() === 'PUBLIC' ? 'PUBLIC' : ident(grantee);
    let sql = `REVOKE ${g.privilege || 'ALL'} ON ${g.objectType || 'TABLE'} ${ident(g.schema)}.${ident(g.object)} FROM ${granteeRef}`;
    return sql + ';';
  }
  return '';
}
