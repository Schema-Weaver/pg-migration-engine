/**
 * Schema Weaver Migration Engine - DDL Generator
 * https://schemaweaver.vivekmind.com/
 */
export function generateRenameSql(change) {
  if (!change.isRename) return '';

  const objType = (change.objectType || '').toLowerCase();
  const schemaPrefix = change.schema ? `${ident(change.schema)}.` : '';

  const getTableRef = () => {
    const t = change.after?.table || change.before?.table || change.after?.tableName || change.before?.tableName;
    if (!t) return '';
    return t.includes('.') ? t.split('.').map(ident).join('.') : (change.schema ? `${ident(change.schema)}.${ident(t)}` : ident(t));
  };

  switch (objType) {
    case 'table':
      return `ALTER TABLE ${schemaPrefix}${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;
      
    case 'column': {
      const table = change.objectKey.split('.').slice(0, -1).join('.');
      const formattedTable = table.split('.').map(ident).join('.');
      return `ALTER TABLE ${formattedTable} RENAME COLUMN ${ident(change.renameFrom)} TO ${ident(change.renameTo)};`;
    }
    
    case 'index':
      return `ALTER INDEX ${schemaPrefix}${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;
      
    case 'constraint': {
      const constrTable = change.before?.table || change.after?.table || change.before?.tableName || change.after?.tableName;
      const formattedConstrTable = constrTable.includes('.') ? constrTable.split('.').map(ident).join('.') : (change.schema ? `${ident(change.schema)}.${ident(constrTable)}` : ident(constrTable));
      return `ALTER TABLE ${formattedConstrTable} RENAME CONSTRAINT ${ident(change.renameFrom)} TO ${ident(change.renameTo)};`;
    }
    
    case 'type':
      return `ALTER TYPE ${schemaPrefix}${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;
      
    case 'function':
    case 'procedure':
      return `ALTER FUNCTION ${schemaPrefix}${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    case 'trigger':
      return `ALTER TRIGGER ${ident(change.renameFrom)} ON ${getTableRef()} RENAME TO ${ident(change.renameTo)};`;

    case 'schema':
      return `ALTER SCHEMA ${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    case 'foreigntable':
      return `ALTER FOREIGN TABLE ${schemaPrefix}${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    case 'foreignserver':
      return `ALTER SERVER ${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    case 'conversion':
      return `ALTER CONVERSION ${schemaPrefix}${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    case 'collation':
      return `ALTER COLLATION ${schemaPrefix}${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    case 'textsearchconfig':
      return `ALTER TEXT SEARCH CONFIGURATION ${schemaPrefix}${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    case 'textsearchdict':
      return `ALTER TEXT SEARCH DICTIONARY ${schemaPrefix}${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    case 'language':
      return `ALTER LANGUAGE ${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    case 'policy':
      return `ALTER POLICY ${ident(change.renameFrom)} ON ${getTableRef()} RENAME TO ${ident(change.renameTo)};`;

    case 'eventtrigger':
      return `ALTER EVENT TRIGGER ${ident(change.renameFrom)} RENAME TO ${ident(change.renameTo)};`;

    default:
      return `-- Unsupported RENAME for ${change.objectType}`;
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
