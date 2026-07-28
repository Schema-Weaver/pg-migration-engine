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

function escapeString(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/'/g, "''");
}

/**
 * @param {import('../types/changes.js').SchemaChange} change
 * @returns {string}
 */
export function generateCommentSql(change) {
  const type = change.changeType || change.type;
  if (type !== 'COMMENT') return '';
  
  const typeMap = {
    table: 'TABLE',
    column: 'COLUMN',
    index: 'INDEX',
    constraint: 'CONSTRAINT',
    view: 'VIEW',
    materializedView: 'MATERIALIZED VIEW',
    function: 'FUNCTION',
    procedure: 'PROCEDURE',
    trigger: 'TRIGGER',
    eventTrigger: 'EVENT TRIGGER',
    policy: 'POLICY',
    rule: 'RULE',
    aggregate: 'AGGREGATE',
    sequence: 'SEQUENCE',
    type: 'TYPE',
    extension: 'EXTENSION',
    schema: 'SCHEMA',
    statistics: 'STATISTICS',
    collation: 'COLLATION',
    operator: 'OPERATOR',
    operatorClass: 'OPERATOR CLASS',
    operatorFamily: 'OPERATOR FAMILY',
    cast: 'CAST',
    foreignTable: 'FOREIGN TABLE',
    foreignDataWrapper: 'FOREIGN DATA WRAPPER',
    foreignServer: 'SERVER',
    publication: 'PUBLICATION',
    subscription: 'SUBSCRIPTION',
    textSearchConfig: 'TEXT SEARCH CONFIGURATION',
    textSearchDict: 'TEXT SEARCH DICTIONARY',
    textSearchParser: 'TEXT SEARCH PARSER',
    textSearchTemplate: 'TEXT SEARCH TEMPLATE',
  };

  const typeKeyword = typeMap[change.objectType] || change.objectType.toUpperCase();
  const name = change.objectKey;
  const val = change.desiredValue !== undefined ? change.desiredValue : (change.after?.comment || '');

  let formattedName = name;
  if (change.objectType === 'column') {
    const parts = name.split('.');
    const col = parts.pop();
    const tab = parts.join('.');
    formattedName = `${tab}.${ident(col)}`;
  } else if (change.objectType === 'constraint') {
    const parts = name.split('.');
    const conName = parts.pop();
    const tab = parts.join('.');
    formattedName = `${ident(conName)} ON ${tab}`;
  } else if (change.objectType === 'trigger' || change.objectType === 'rule' || change.objectType === 'policy') {
    const parts = name.split('.');
    const objName = parts.pop();
    const tab = parts.join('.');
    formattedName = `${ident(objName)} ON ${tab}`;
  } else if (change.objectType === 'function' || change.objectType === 'procedure') {
    const fn = change.after || change.before || {};
    const argTypesList = fn.argumentTypes || fn.arguments || [];
    const argsStr = Array.isArray(argTypesList) ? argTypesList.join(', ') : '';
    formattedName = `${name}(${argsStr})`;
  } else if (change.objectType === 'operator') {
    const leftType = change.before?.leftType || change.after?.leftType || 'NONE';
    const rightType = change.before?.rightType || change.after?.rightType || 'NONE';
    formattedName = `${name} (${leftType}, ${rightType})`;
  } else if (change.objectType === 'operatorClass' || change.objectType === 'operatorFamily') {
    const accessMethod = change.after?.accessMethod || change.before?.accessMethod || 'btree';
    formattedName = `${name} USING ${accessMethod}`;
  }

  if (val === null || val === undefined || val === '') {
    return `COMMENT ON ${typeKeyword} ${formattedName} IS NULL;`;
  }
  return `COMMENT ON ${typeKeyword} ${formattedName} IS '${escapeString(val)}';`;
}
