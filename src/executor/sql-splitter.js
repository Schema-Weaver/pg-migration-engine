/**
 * Schema Weaver Migration Engine - Migration Executor
 * https://schemaweaver.vivekmind.com/
 */
const DOLLAR_QUOTE_REGEX = /\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/g;

export function splitSqlStatements(sql) {
  if (!sql || typeof sql !== 'string') return [];
  
  const statements = [];
  let current = '';
  let i = 0;
  
  while (i < sql.length) {
    if (sql[i] === '-' && i + 1 < sql.length && sql[i + 1] === '-') {
      current += sql[i];
      i++;
      while (i < sql.length && sql[i] !== '\n') {
        current += sql[i];
        i++;
      }
      if (i < sql.length) {
        current += sql[i];
        i++;
      }
      continue;
    }
    
    if (sql[i] === '/' && i + 1 < sql.length && sql[i + 1] === '*') {
      current += sql[i];
      i++;
      current += sql[i];
      i++;
      while (i < sql.length && !(sql[i - 1] === '*' && sql[i] === '/')) {
        current += sql[i];
        i++;
      }
      if (i < sql.length) {
        current += sql[i];
        i++;
      }
      continue;
    }
    
    if (sql[i] === '$') {
      const dollarMatch = sql.substring(i).match(DOLLAR_QUOTE_REGEX);
      if (dollarMatch) {
        const tag = dollarMatch[0];
        current += tag;
        i += tag.length;
        
        const endPattern = tag;
        while (i < sql.length) {
          if (sql.substring(i, i + tag.length) === endPattern) {
            current += tag;
            i += tag.length;
            break;
          }
          current += sql[i];
          i++;
        }
        continue;
      }
    }
    
    if (sql[i] === "'") {
      current += sql[i];
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          current += sql[i];
          i++;
          if (i < sql.length && sql[i] === "'") {
            current += sql[i];
            i++;
            continue;
          }
          break;
        }
        current += sql[i];
        i++;
      }
      continue;
    }
    
    if (sql[i] === '"') {
      current += sql[i];
      i++;
      while (i < sql.length && sql[i] !== '"') {
        current += sql[i];
        i++;
      }
      if (i < sql.length) {
        current += sql[i];
        i++;
      }
      continue;
    }
    
    if (sql[i] === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }
    
    current += sql[i];
    i++;
  }
  
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }
  
  return statements;
}

export function sanitizeSavepointName(str) {
  return str.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 63);
}
