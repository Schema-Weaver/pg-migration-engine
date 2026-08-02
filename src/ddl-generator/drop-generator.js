/**
 * Schema Weaver Migration Engine - DDL Generator
 * https://schemaweaver.vivekmind.com/
 */

export function generateDropSql(change) {
  const obj = change.before;
  const objectKey = change.objectKey;
  const objectType = change.objectType;
  const changeType = change.changeType;

  switch (objectType) {
    case 'schema':
      return `DROP SCHEMA IF EXISTS ${ident(obj?.name || objectKey)} CASCADE;`;

    case 'table':
      const tableParts = objectKey.split('.');
      const tableSchema = tableParts.length > 1 ? tableParts[0] : 'public';
      const tableName = tableParts.length > 1 ? tableParts.slice(1).join('.') : tableParts[0];
      return `DROP TABLE IF EXISTS ${ident(tableSchema)}.${ident(tableName)} CASCADE;`;

    case 'view':
      return `DROP VIEW IF EXISTS ${objectKey} CASCADE;`;

    case 'materializedView':
      return `DROP MATERIALIZED VIEW IF EXISTS ${objectKey} CASCADE;`;

    case 'function':
      // objectKey may already carry the signature (e.g. public.fn()) - never
      // append the argument list twice, which produced invalid "()()" SQL.
      const fnHasSig = typeof objectKey === 'string' && objectKey.includes('(');
      const fnArgs = obj?.argumentTypes && !fnHasSig ? `(${obj.argumentTypes.join(', ')})` : '';
      return `DROP FUNCTION IF EXISTS ${objectKey}${fnArgs} CASCADE;`;

    case 'procedure':
      const procHasSig = typeof objectKey === 'string' && objectKey.includes('(');
      const procArgs = obj?.argumentTypes && !procHasSig ? `(${obj.argumentTypes.join(', ')})` : '';
      return `DROP PROCEDURE IF EXISTS ${objectKey}${procArgs} CASCADE;`;

    case 'trigger':
      const trigTable = obj?.tableName || objectKey.split('.').slice(0, -1).join('.');
      const trigName = obj?.name || objectKey.split('.').pop();
      return `DROP TRIGGER IF EXISTS ${ident(trigName)} ON ${trigTable};`;

    case 'index':
      if (changeType === 'DROP_INDEX_CONCURRENTLY' || obj?.isConcurrent) {
        return `DROP INDEX CONCURRENTLY IF EXISTS ${objectKey};`;
      }
      return `DROP INDEX IF EXISTS ${objectKey};`;

    case 'constraint':
      const conTable = obj?._tableKey || obj?.tableKey || objectKey.split('.').slice(0, -1).join('.');
      const conName = obj?.name || objectKey.split('.').pop();
      return `ALTER TABLE ${conTable} DROP CONSTRAINT IF EXISTS ${ident(conName)};`;

    case 'policy':
      const polTable = obj?.table || objectKey.split('.').slice(0, -1).join('.');
      const polName = obj?.name || objectKey.split('.').pop();
      return `DROP POLICY IF EXISTS ${ident(polName)} ON ${polTable};`;

    case 'sequence':
      return `DROP SEQUENCE IF EXISTS ${objectKey} CASCADE;`;

    case 'extension':
      return `DROP EXTENSION IF EXISTS ${ident(obj?.name || objectKey)} CASCADE;`;

    case 'type':
      return `DROP TYPE IF EXISTS ${objectKey} CASCADE;`;

    case 'domain':
      return `DROP DOMAIN IF EXISTS ${objectKey} CASCADE;`;

    case 'rule':
      const ruleTable = obj?.tableName || objectKey.split('.').slice(0, -1).join('.');
      const ruleName = obj?.name || objectKey.split('.').pop();
      return `DROP RULE IF EXISTS ${ident(ruleName)} ON ${ruleTable};`;

    case 'aggregate':
      const aggArgs = obj?.argumentTypes ? `(${obj.argumentTypes.join(', ')})` : '()';
      return `DROP AGGREGATE IF EXISTS ${objectKey}${aggArgs} CASCADE;`;

    case 'eventTrigger':
      return `DROP EVENT TRIGGER IF EXISTS ${ident(obj?.name || objectKey)};`;

    case 'foreignTable':
      return `DROP FOREIGN TABLE IF EXISTS ${objectKey} CASCADE;`;

    case 'foreignServer':
      return `DROP SERVER IF EXISTS ${ident(obj?.name || objectKey)} CASCADE;`;

    case 'foreignDataWrapper':
      return `DROP FOREIGN DATA WRAPPER IF EXISTS ${ident(obj?.name || objectKey)} CASCADE;`;

    case 'userMapping':
      return `DROP USER MAPPING IF EXISTS FOR ${ident(obj?.user || 'PUBLIC')} SERVER ${ident(obj?.server || 'FOREIGN')};`;

    case 'cast':
      return `DROP CAST IF EXISTS (${obj?.sourceType || 'type'} AS ${obj?.targetType || 'type'});`;

    case 'operator':
      const opLeft = obj?.leftType || 'NONE';
      const opRight = obj?.rightType || 'NONE';
      return `DROP OPERATOR IF EXISTS ${objectKey} (${opLeft}, ${opRight}) CASCADE;`;

    case 'operatorClass':
      return `DROP OPERATOR CLASS IF EXISTS ${objectKey} USING ${obj?.accessMethod || 'btree'} CASCADE;`;

    case 'operatorFamily':
      return `DROP OPERATOR FAMILY IF EXISTS ${objectKey} USING ${obj?.accessMethod || 'btree'} CASCADE;`;

    case 'textSearchConfig':
      return `DROP TEXT SEARCH CONFIGURATION IF EXISTS ${objectKey} CASCADE;`;

    case 'textSearchDict':
      return `DROP TEXT SEARCH DICTIONARY IF EXISTS ${objectKey} CASCADE;`;

    case 'textSearchParser':
      return `DROP TEXT SEARCH PARSER IF EXISTS ${objectKey} CASCADE;`;

    case 'textSearchTemplate':
      return `DROP TEXT SEARCH TEMPLATE IF EXISTS ${objectKey} CASCADE;`;

    case 'statistics':
      return `DROP STATISTICS IF EXISTS ${objectKey};`;

    case 'publication':
      return `DROP PUBLICATION IF EXISTS ${ident(obj?.name || objectKey)};`;

    case 'subscription':
      return `DROP SUBSCRIPTION IF EXISTS ${ident(obj?.name || objectKey)};`;

    case 'language':
      return `DROP LANGUAGE IF EXISTS ${ident(obj?.name || objectKey)} CASCADE;`;

    case 'collation':
      return `DROP COLLATION IF EXISTS ${objectKey} CASCADE;`;

    case 'conversion':
      return `DROP CONVERSION IF EXISTS ${objectKey} CASCADE;`;

    case 'column':
      const colTable = objectKey.split('.').slice(0, -1).join('.');
      const colName = objectKey.split('.').pop();
      return `ALTER TABLE ${colTable} DROP COLUMN IF EXISTS ${ident(colName)};`;

    case 'database':
      return `-- DROP DATABASE must be run outside transaction: DROP DATABASE IF EXISTS ${ident(obj?.name || objectKey)};`;

    case 'tablespace':
      return `DROP TABLESPACE IF EXISTS ${ident(obj?.name || objectKey)};`;

    case 'role':
      return `DROP ROLE IF EXISTS ${ident(obj?.name || objectKey)};`;

    case 'defaultPrivileges':
      const dpSchema = obj?.schema;
      const dpForRole = obj?.forRole;
      return `ALTER DEFAULT PRIVILEGES${dpSchema ? ` IN SCHEMA ${ident(dpSchema)}` : ''}${dpForRole ? ` FOR ROLE ${ident(dpForRole)}` : ''} REVOKE ALL ON ALL FROM PUBLIC;`;

    case 'conversion':
      return `DROP CONVERSION IF EXISTS ${objectKey};`;

    case 'accessMethod':
      return `DROP ACCESS METHOD IF EXISTS ${ident(obj?.name || objectKey)};`;

    default:
      if (objectType.startsWith('RECREATE')) {
        return generateRecreateSql(change);
      }
      return `-- Unsupported DROP for ${objectType}`;
  }
}

function generateRecreateSql(change) {
  const dropSql = generateDropSql({
    ...change,
    changeType: 'DROP',
    before: change.before
  });
  
  const createChange = {
    ...change,
    changeType: 'CREATE',
    after: change.before,
  };

  switch (change.objectType) {
    case 'materializedView':
      return dropSql;
    default:
      return dropSql;
  }
}

function ident(name) {
  if (!name) return '';
  if (typeof name !== 'string') name = String(name);
  if (name.includes('"') || name.includes(' ')) {
    return `"${name.replace(/"/g, '""')}"`;
  }
  return `"${name}"`;
}
