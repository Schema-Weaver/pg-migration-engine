/**
 * Schema Weaver Migration Engine - DDL Generator
 * https://schemaweaver.vivekmind.com/
 */

export function generateCreateSql(change) {
  const obj = change.after;
  if (!obj) return '';

  let sql = generateBaseCreateSql(change);
  if (!sql || sql.startsWith('--')) {
    return sql;
  }

  if (!sql.endsWith(';')) {
    sql += ';';
  }

  const s = obj.schema || change.schema;
  const name = obj.name;
  const t = obj.table || obj.tableName || change.table || change.tableName;

  const objName = (() => {
    switch (change.objectType) {
      case 'column':
        return `${ident(s || 'public')}.${ident(t)}.${ident(name)}`;
      case 'constraint':
        return `${ident(name)} ON ${ident(s || 'public')}.${ident(t)}`;
      case 'trigger':
      case 'rule':
      case 'policy':
        return `${ident(name)} ON ${ident(s || 'public')}.${ident(t)}`;
      case 'function':
      case 'procedure':
        const args = (obj.argumentTypes || obj.arguments || []).join(', ');
        return `${ident(s || 'public')}.${ident(name)}(${args})`;
      case 'operator':
        return `${ident(s || 'public')}.${name} (${obj.leftType || 'NONE'}, ${obj.rightType || 'NONE'})`;
      case 'operatorClass':
      case 'operatorFamily':
        return `${ident(s || 'public')}.${ident(name)} USING ${obj.accessMethod || 'btree'}`;
      case 'schema':
      case 'language':
      case 'eventTrigger':
      case 'foreignServer':
      case 'foreignDataWrapper':
      case 'publication':
      case 'subscription':
        return ident(name);
      default:
        return s ? `${ident(s)}.${ident(name)}` : ident(name);
    }
  })();

  const typeMap = {
    table: 'TABLE',
    view: 'VIEW',
    materializedView: 'MATERIALIZED VIEW',
    function: 'FUNCTION',
    procedure: 'PROCEDURE',
    sequence: 'SEQUENCE',
    schema: 'SCHEMA',
    type: 'TYPE',
    domain: 'DOMAIN',
    foreignTable: 'FOREIGN TABLE',
    foreignDataWrapper: 'FOREIGN DATA WRAPPER',
    foreignServer: 'SERVER',
    publication: 'PUBLICATION',
    subscription: 'SUBSCRIPTION',
    textSearchConfig: 'TEXT SEARCH CONFIGURATION',
    textSearchDict: 'TEXT SEARCH DICTIONARY',
    conversion: 'CONVERSION',
    language: 'LANGUAGE',
    operator: 'OPERATOR',
    operatorClass: 'OPERATOR CLASS',
    operatorFamily: 'OPERATOR FAMILY',
    eventTrigger: 'EVENT TRIGGER',
    policy: 'POLICY',
    rule: 'RULE',
    trigger: 'TRIGGER',
    constraint: 'CONSTRAINT',
    index: 'INDEX',
    collation: 'COLLATION',
    cast: 'CAST'
  };

  const typeKeyword = typeMap[change.objectType];

  if (typeKeyword) {
    const skipOwner = ['cast', 'accessMethod', 'defaultPrivileges', 'constraint', 'policy', 'rule', 'trigger'];
    if (obj.owner && !skipOwner.includes(change.objectType) && !sql.includes('OWNER TO')) {
      sql += `\nALTER ${typeKeyword} ${objName} OWNER TO ${ident(obj.owner)};`;
    }

    if (obj.comment && !sql.includes('COMMENT ON ')) {
      sql += `\nCOMMENT ON ${typeKeyword} ${objName} IS '${escapeString(obj.comment)}';`;
    }

    const supportsGrants = [
      'table', 'column', 'view', 'materializedView', 'function', 'procedure',
      'sequence', 'type', 'schema', 'foreignTable', 'foreignDataWrapper',
      'foreignServer', 'publication', 'subscription', 'textSearchConfig',
      'textSearchDict', 'conversion', 'language'
    ];
    if (supportsGrants.includes(change.objectType) && obj.privileges && obj.privileges.length > 0 && !sql.includes('GRANT ')) {
      for (const g of obj.privileges) {
        let grantSql = `GRANT ${g.privilege} ON ${typeKeyword} ${objName} TO ${ident(g.grantee)}`;
        if (g.isGrantable) grantSql += ' WITH GRANT OPTION';
        sql += `\n${grantSql};`;
      }
    }
  }

  return sql;
}

function generateBaseCreateSql(change) {
  const obj = change.after;
  if (!obj) return '';

  switch (change.objectType) {
    case 'schema':
      return `CREATE SCHEMA IF NOT EXISTS ${ident(obj.name)};`;
      
    case 'table':
      return generateCreateTableSql(obj);
      
    case 'view':
      return generateCreateViewSql(obj, change);
      
    case 'materializedView':
      return generateCreateMaterializedViewSql(obj);
      
    case 'function':
    case 'procedure':
      return generateCreateFunctionSql(obj, change.objectType === 'procedure');
      
    case 'trigger':
      return generateCreateTriggerSql(obj);
      
    case 'index':
      return generateCreateIndexSql(obj);
      
    case 'constraint':
      return generateCreateConstraintSql(obj);
      
    case 'sequence':
      return generateCreateSequenceSql(obj);
      
    case 'extension':
      return generateCreateExtensionSql(obj);
      
    case 'policy':
      return generateCreatePolicySql(obj);
      
    case 'type':
      return generateCreateTypeSql(obj);
      
    case 'domain':
      return generateCreateDomainSql(obj);
      
    case 'rule':
      return generateCreateRuleSql(obj);
      
    case 'aggregate':
      return generateCreateAggregateSql(obj);
      
    case 'textSearchParser':
      return generateCreateTextSearchParserSql(obj);
      
    case 'textSearchTemplate':
      return generateCreateTextSearchTemplateSql(obj);
      
    case 'textSearchDict':
      return generateCreateTextSearchDictSql(obj);
      
    case 'textSearchConfig':
      return generateCreateTextSearchConfigSql(obj);
      
    case 'operator':
      return generateCreateOperatorSql(obj);
      
    case 'operatorClass':
      return generateCreateOperatorClassSql(obj);
      
    case 'operatorFamily':
      return generateCreateOperatorFamilySql(obj);
      
    case 'publication':
      return generateCreatePublicationSql(obj);
      
    case 'subscription':
      return generateCreateSubscriptionSql(obj);
      
    case 'statistics':
      return generateCreateStatisticsSql(obj);
      
    case 'collation':
      return generateCreateCollationSql(obj);
      
    case 'cast':
      return generateCreateCastSql(obj);
      
    case 'foreignServer':
      return generateCreateForeignServerSql(obj);
      
    case 'foreignDataWrapper':
      return generateCreateForeignDataWrapperSql(obj);
      
    case 'userMapping':
      return generateCreateUserMappingSql(obj);
      
    case 'foreignTable':
      return generateCreateForeignTableSql(obj);
      
    case 'eventTrigger':
      return generateCreateEventTriggerSql(obj);
      
    case 'role':
      return generateCreateRoleSql(obj);
      
    case 'database':
      return generateCreateDatabaseSql(obj);
      
    case 'tablespace':
      return generateCreateTablespaceSql(obj);
      
    case 'column':
      return generateCreateColumnSql(change);
      
    case 'language':
      return generateCreateLanguageSql(obj);
      
    case 'defaultPrivileges':
      return generateCreateDefaultPrivilegesSql(obj);
      
    case 'conversion':
      return generateCreateConversionSql(obj);
      
    case 'accessMethod':
      return generateCreateAccessMethodSql(obj);
      
    default:
      return `-- Unsupported CREATE for ${change.objectType}`;
  }
}

function generateCreateColumnSql(change) {
  const col = change.after || change.desired || {};
  const parts = change.objectKey.split('.');
  const colName = ident(parts.pop());
  const tableName = parts.map(ident).join('.');
  
  const dataType = col.dataType || col.type;
  if (!dataType) {
    throw new Error(
      `Column type is required for column "${col.name || colName}". ` +
      `Provide either "dataType" or "type" property. ` +
      `Example: { name: "created_at", dataType: "timestamp" }`
    );
  }
  
  const ifNotExists = col.ifNotExists !== false ? 'IF NOT EXISTS ' : '';
  let sql = `ALTER TABLE ${tableName} ADD COLUMN ${ifNotExists}${colName} ${dataType}`;
  
  if (col.collation) {
    sql += ` COLLATE ${col.collation}`;
  }
  
  if (col.nullable === false || col.isNullable === false) {
    sql += ' NOT NULL';
  }
  
  if (col.defaultValue !== undefined && col.defaultValue !== null) {
    sql += ` DEFAULT ${escapeDefaultValue(col.defaultValue)}`;
  }
  
  if (col.isIdentity) {
    const rawMode = col.identityMode || col.identityType || (col.isAlwaysIdentity ? 'ALWAYS' : 'BY DEFAULT');
    const mode = rawMode === 'BY_DEFAULT' ? 'BY DEFAULT' : rawMode;
    sql += ` GENERATED ${mode} AS IDENTITY`;
    const seqOpts = [];
    if (col.identityStart != null) seqOpts.push(`START ${col.identityStart}`);
    if (col.identityIncrement != null) seqOpts.push(`INCREMENT ${col.identityIncrement}`);
    if (col.identityMinimum != null || col.identityMin != null) {
      seqOpts.push(`MINVALUE ${col.identityMinimum ?? col.identityMin}`);
    }
    if (col.identityMaximum != null || col.identityMax != null) {
      seqOpts.push(`MAXVALUE ${col.identityMaximum ?? col.identityMax}`);
    }
    if (col.identityCycle) seqOpts.push('CYCLE');
    if (col.identityCache != null) seqOpts.push(`CACHE ${col.identityCache}`);
    if (seqOpts.length > 0) sql += ` (${seqOpts.join(', ')})`;
  } else if (col.generatedExpression) {
    sql += ` GENERATED ALWAYS AS (${col.generatedExpression}) STORED`;
  }
  
  sql += ';';
  
  if (col.comment) {
    sql += `\nCOMMENT ON COLUMN ${tableName}.${colName} IS '${escapeString(col.comment)}';`;
  }
  
  return sql;
}

function generateCreateTableSql(table) {
  const tableKey = `${ident(table.schema)}.${ident(table.name)}`;

  // Helper to generate replica identity DDL
  function getReplicaIdentitySql(replIdent) {
    if (!replIdent) return '';
    const ri = replIdent.toLowerCase();
    if (ri === 'default') {
      return `\nALTER TABLE ${tableKey} REPLICA IDENTITY DEFAULT;`;
    } else if (ri === 'full') {
      return `\nALTER TABLE ${tableKey} REPLICA IDENTITY FULL;`;
    } else if (ri === 'nothing') {
      return `\nALTER TABLE ${tableKey} REPLICA IDENTITY NOTHING;`;
    } else if (ri.startsWith('index:')) {
      const idxName = replIdent.split(':')[1];
      return `\nALTER TABLE ${tableKey} REPLICA IDENTITY USING INDEX ${ident(idxName)};`;
    } else {
      return `\nALTER TABLE ${tableKey} REPLICA IDENTITY ${replIdent.toUpperCase()};`;
    }
  }

  // Handle child partition creation syntax (does not define columns directly)
  if (table.isPartition && table.partitionParent && table.partitionBound) {
    const parentParts = table.partitionParent.split('.');
    const parentRef = parentParts.map(ident).join('.');
    let sql = `CREATE TABLE ${tableKey} PARTITION OF ${parentRef} ${table.partitionBound}`;
    if (table.accessMethod) {
      sql += ` USING ${ident(table.accessMethod)}`;
    }
    if (table.tablespace) sql += ` TABLESPACE ${ident(table.tablespace)}`;
    sql += ';';

    if (table.owner) {
      sql += `\nALTER TABLE ${tableKey} OWNER TO ${ident(table.owner)};`;
    }

    if (table.comment) {
      sql += `\nCOMMENT ON TABLE ${tableKey} IS '${table.comment.replace(/'/g, "''")}';`;
    }
    if (table.privileges && table.privileges.length > 0) {
      for (const g of table.privileges) {
        let grantSql = `GRANT ${g.privilege} ON TABLE ${tableKey} TO ${ident(g.grantee)}`;
        if (g.isGrantable) grantSql += ' WITH GRANT OPTION';
        sql += `\n${grantSql};`;
      }
    }

    // RLS handling for partition child
    if (table.rlsEnabled) {
      sql += `\nALTER TABLE ${tableKey} ENABLE ROW LEVEL SECURITY;`;
    }
    if (table.rlsForced) {
      sql += `\nALTER TABLE ${tableKey} FORCE ROW LEVEL SECURITY;`;
    }
    if (table.rlsForced && table.rlsForcedRoles && table.rlsForcedRoles.length > 0) {
      for (const role of table.rlsForcedRoles) {
        sql += `\nALTER TABLE ${tableKey} FORCE ROW LEVEL SECURITY FOR ${ident(role)};`;
      }
    }

    // Replica Identity handling for partition child
    if (table.replicaIdentity) {
      sql += getReplicaIdentitySql(table.replicaIdentity);
    }

    return sql;
  }

  const colDefs = (table.columns || []).map(c => {
    let typeStr = c.dataType || c.type || 'text';
    const typeSchema = c.dataTypeSchema || c.udtSchema;
    const lowerType = typeStr.toLowerCase();
    const isStd = lowerType.startsWith('character varying') || 
                  lowerType.startsWith('varchar') || 
                  lowerType.startsWith('char') || 
                  lowerType.startsWith('numeric') || 
                  lowerType.startsWith('decimal') || 
                  lowerType.startsWith('timestamp') || 
                  ['bigint', 'integer', 'int', 'smallint', 'boolean', 'bool', 'text', 'date', 'uuid', 'json', 'jsonb', 'bytea', 'real', 'double precision'].some(t => lowerType.startsWith(t)) || 
                  typeStr.endsWith('[]');
    if (!isStd && !typeStr.includes('.')) {
      const sch = typeSchema || table.schema;
      if (sch && sch !== 'pg_catalog' && sch !== 'public') {
        typeStr = `${ident(sch)}.${ident(typeStr)}`;
      }
    }
    let def = `${ident(c.name)} ${typeStr}`;
    if (!c.isNullable) def += ' NOT NULL';
    if (c.defaultValue !== undefined && c.defaultValue !== null) {
      def += ` DEFAULT ${escapeDefaultValue(c.defaultValue)}`;
    }
    if (c.isGenerated && c.generatedExpression) {
      def += ` GENERATED ALWAYS AS (${c.generatedExpression}) STORED`;
    } else if (c.isIdentity) {
      // identityMode: 'ALWAYS' | 'BY_DEFAULT' (Differ/types); map BY_DEFAULT → SQL "BY DEFAULT"
      const rawMode = c.identityMode || c.identityType || (c.isAlwaysIdentity ? 'ALWAYS' : 'BY DEFAULT');
      const mode = rawMode === 'BY_DEFAULT' ? 'BY DEFAULT' : rawMode;
      def += ` GENERATED ${mode} AS IDENTITY`;
      const seqOpts = [];
      if (c.identityStart != null) seqOpts.push(`START ${c.identityStart}`);
      if (c.identityIncrement != null) seqOpts.push(`INCREMENT ${c.identityIncrement}`);
      if (c.identityMinimum != null) seqOpts.push(`MINVALUE ${c.identityMinimum}`);
      if (c.identityMaximum != null) seqOpts.push(`MAXVALUE ${c.identityMaximum}`);
      if (c.identityCycle) seqOpts.push('CYCLE');
      if (c.identityCache != null) seqOpts.push(`CACHE ${c.identityCache}`);
      if (seqOpts.length > 0) def += ` (${seqOpts.join(', ')})`;
    }
    if (c.collation) def += ` COLLATE ${c.collation}`;
    return def;
  });

  const constraints = table.constraints || [];
  for (const con of constraints) {
    const conDef = generateInlineConstraint(con);
    if (conDef) colDefs.push(conDef);
  }

  // Handle UNLOGGED and TEMPORARY keywords placement
  let typePrefix = 'TABLE';
  if (table.isTemporary) {
    typePrefix = 'TEMP TABLE';
  } else if (table.unlogged || table.isUnlogged || table.rlsEnabled || table.rlsForced) {
    if (table.unlogged || table.isUnlogged) typePrefix = 'UNLOGGED TABLE';
  } else if (table.isLogged === false) {
    typePrefix = 'UNLOGGED TABLE';
  }

  const ifNotExists = table.ifNotExists !== false ? 'IF NOT EXISTS ' : '';
  let sql = `CREATE ${typePrefix} ${ifNotExists}${tableKey} (\n  ${colDefs.join(',\n  ')}\n)`;

  // WITH storage options
  const withOpts = [];
  if (table.storageParameters) {
    for (const [k, v] of Object.entries(table.storageParameters)) {
      withOpts.push(`${k}=${v}`);
    }
  }
  if (table.hasOids) {
    withOpts.push('oids=true');
  }
  if (withOpts.length > 0) {
    sql += ` WITH (${withOpts.join(', ')})`;
  }

  // PARTITION BY
  if (table.partitionKeyDef) {
    sql += ` PARTITION BY ${table.partitionKeyDef}`;
  } else if (table.partitionStrategy && table.partitionColumns && table.partitionColumns.length > 0) {
    sql += ` PARTITION BY ${table.partitionStrategy} (${table.partitionColumns.map(ident).join(', ')})`;
  }

  // INHERITS
  if (table.inheritsFrom && table.inheritsFrom.length > 0) {
    sql += ` INHERITS (${table.inheritsFrom.join(', ')})`;
  }

  if (table.accessMethod) {
    sql += ` USING ${ident(table.accessMethod)}`;
  }

  if (table.tablespace) {
    sql += ` TABLESPACE ${ident(table.tablespace)}`;
  }

  sql += ';';

  if (table.owner) {
    sql += `\nALTER TABLE ${tableKey} OWNER TO ${ident(table.owner)};`;
  }

  // Appending table comment
  if (table.comment) {
    sql += `\nCOMMENT ON TABLE ${tableKey} IS '${table.comment.replace(/'/g, "''")}';`;
  }

  // Appending privileges/grants
  if (table.privileges && table.privileges.length > 0) {
    for (const g of table.privileges) {
      let grantSql = `GRANT ${g.privilege} ON TABLE ${tableKey} TO ${ident(g.grantee)}`;
      if (g.isGrantable) grantSql += ' WITH GRANT OPTION';
      sql += `\n${grantSql};`;
    }
  }

  // RLS handling
  if (table.rlsEnabled) {
    sql += `\nALTER TABLE ${tableKey} ENABLE ROW LEVEL SECURITY;`;
  }
  if (table.rlsForced) {
    sql += `\nALTER TABLE ${tableKey} FORCE ROW LEVEL SECURITY;`;
  }
  if (table.rlsForced && table.rlsForcedRoles && table.rlsForcedRoles.length > 0) {
    for (const role of table.rlsForcedRoles) {
      sql += `\nALTER TABLE ${tableKey} FORCE ROW LEVEL SECURITY FOR ${ident(role)};`;
    }
  }

  // Replica Identity handling
  if (table.replicaIdentity) {
    sql += getReplicaIdentitySql(table.replicaIdentity);
  }

  return sql;
}

/**
 * Validate and sanitize a CHECK constraint expression.
 * SECURITY: Detects potential SQL injection patterns in CHECK expressions.
 */
function validateCheckExpression(expr) {
  if (!expr || typeof expr !== 'string') return expr;
  
  let check = expr.trim();
  
  // Remove CHECK wrapper if present
  if (check.toUpperCase().startsWith('CHECK')) {
    check = check.replace(/^CHECK\s*\(/i, '').replace(/\)$/, '');
  }
  
  // Validate parentheses balance
  let depth = 0;
  for (let i = 0; i < check.length; i++) {
    const char = check[i];
    if (char === '(') depth++;
    if (char === ')') {
      depth--;
      if (depth < 0) {
        throw new Error(
          `Invalid CHECK expression: unbalanced closing parenthesis at position ${i}. ` +
          `Expression: "${check.substring(0, 50)}${check.length > 50 ? '...' : ''}"`
        );
      }
    }
  }
  if (depth !== 0) {
    throw new Error(
      `Invalid CHECK expression: unbalanced parentheses (${depth} unclosed). ` +
      `Expression: "${check.substring(0, 50)}${check.length > 50 ? '...' : ''}"`
    );
  }
  
  // Warn about potential injection patterns
  const suspiciousPatterns = [
    { pattern: /\)\s*;/, message: 'Closing parenthesis followed by semicolon' },
    { pattern: /;\s*--/, message: 'Semicolon followed by comment' },
    { pattern: /;\s*DROP\s+/i, message: 'Potential DROP statement injection' },
    { pattern: /;\s*DELETE\s+/i, message: 'Potential DELETE statement injection' },
    { pattern: /;\s*INSERT\s+/i, message: 'Potential INSERT statement injection' },
    { pattern: /;\s*UPDATE\s+/i, message: 'Potential UPDATE statement injection' },
  ];
  
  for (const { pattern, message } of suspiciousPatterns) {
    if (pattern.test(check)) {
      console.warn(
        `[Security] CHECK expression contains suspicious pattern: ${message}. ` +
        `Please verify expression is safe.`
      );
    }
  }
  
  return check;
}

function generateInlineConstraint(con) {
  if (!con.name) return null;
  
  switch (con.constraintType) {
    case 'PRIMARY KEY':
    case 'PRIMARY_KEY':
      return `CONSTRAINT ${ident(con.name)} PRIMARY KEY (${(con.columns || []).map(ident).join(', ')})`;
    case 'UNIQUE': {
      const nullsNotDistinct = con.nullsNotDistinct !== undefined && con.nullsNotDistinct !== null && con.nullsNotDistinct ? ' NULLS NOT DISTINCT' : '';
      return `CONSTRAINT ${ident(con.name)} UNIQUE (${(con.columns || []).map(ident).join(', ')})${nullsNotDistinct}`;
    }
    case 'CHECK': {
      const validatedExpr = validateCheckExpression(
        con.checkExpression || con.expression || con.definition || ''
      );
      return `CONSTRAINT ${ident(con.name)} CHECK (${validatedExpr})`;
    }
    default:
      return null;
  }
}

function generateCreateViewSql(view, change = {}) {
  const isRecursive = view.isRecursive === true;
  const viewKeyword = isRecursive ? 'RECURSIVE VIEW' : 'VIEW';
  let sql = `CREATE OR REPLACE ${viewKeyword} ${ident(view.schema)}.${ident(view.name)}`;
  
  if (view.columns && view.columns.length > 0) {
    const colNames = view.columns.map(c => typeof c === 'string' ? c : c.name || c);
    sql += ` (${colNames.map(ident).join(', ')})`;
  }
  
  const withOpts = [];
  if (view.securityBarrier !== undefined) {
    withOpts.push(`security_barrier = ${view.securityBarrier}`);
  }
  
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 140000;
  if (view.securityInvoker !== undefined && pgVersion >= 150000) {
    withOpts.push(`security_invoker = ${view.securityInvoker}`);
  }
  
  if (view.checkOption && (view.checkOption.toLowerCase() === 'local' || view.checkOption.toLowerCase() === 'cascaded')) {
    withOpts.push(`check_option = '${view.checkOption.toLowerCase()}'`);
  }
  
  if (withOpts.length > 0) {
    sql += ` WITH (${withOpts.join(', ')})`;
  }
  
  sql += ` AS ${view.definition}`;
  
  if (view.checkOption && view.checkOption !== 'NONE' && withOpts.length === 0) {
    const opt = view.checkOption.toUpperCase();
    sql += ` WITH ${opt} CHECK OPTION`;
  }
  
  sql += ';';

  const viewKey = `${ident(view.schema)}.${ident(view.name)}`;
  if (view.owner) {
    sql += `\nALTER VIEW ${viewKey} OWNER TO ${ident(view.owner)};`;
  }
  if (view.comment) {
    sql += `\nCOMMENT ON VIEW ${viewKey} IS '${escapeString(view.comment)}';`;
  }
  if (view.privileges && view.privileges.length > 0) {
    for (const g of view.privileges) {
      let grantSql = `GRANT ${g.privilege} ON VIEW ${viewKey} TO ${ident(g.grantee)}`;
      if (g.isGrantable) grantSql += ' WITH GRANT OPTION';
      sql += `\n${grantSql};`;
    }
  }
  
  return sql;
}

function generateCreateFunctionSql(fn, isProcedure = false) {
  if (fn.language === 'internal') {
    return `-- Skipping internal system function ${fn.name}`;
  }
  const keyword = isProcedure ? 'PROCEDURE' : 'FUNCTION';
  let args = '';
  if (fn.argumentTypes && fn.argumentTypes.length > 0) {
    args = fn.argumentTypes.map((a, i) => `$${i + 1} ${a}`).join(', ');
  }
  
  let sql = `CREATE OR REPLACE ${keyword} ${ident(fn.schema)}.${ident(fn.name)}(${args})`;
  
  if (!isProcedure && fn.returnType) {
    sql += ` RETURNS ${fn.returnType}`;
  } else if (!isProcedure) {
    sql += ' RETURNS void';
  }
  
  sql += ` LANGUAGE ${fn.language || 'sql'}`;
  
  if (fn.volatility === 'IMMUTABLE' || fn.volatility === 'STABLE') {
    sql += ` ${fn.volatility}`;
  }
  if (fn.isNullCall === true) sql += ' CALLED ON NULL INPUT';
  if (fn.isNullCall === false) sql += ' RETURNS NULL ON NULL INPUT';
  if (fn.securityType === 'DEFINER') sql += ' SECURITY DEFINER';
  if (fn.cost) sql += ` COST ${fn.cost}`;
  if (fn.parallelSafety) sql += ` PARALLEL ${fn.parallelSafety}`;
  if (fn.rowsEstimate) sql += ` ROWS ${fn.rowsEstimate}`;
  
  sql += ` AS $$${fn.source || ''}$$;`;
  
  return sql;
}

function generateCreateTriggerSql(trig) {
  let sql = `CREATE TRIGGER ${ident(trig.name)}\n  `;
  
  sql += trig.timing;
  if (Array.isArray(trig.events)) {
    sql += ` ${trig.events.join(' OR ')}`;
  }
  
  const tName = trig.tableName || trig.table || '';
  let tableRef = '';
  if (tName.includes('.')) {
    tableRef = tName.split('.').map(ident).join('.');
  } else {
    tableRef = `${ident(trig.schema || 'public')}.${ident(tName)}`;
  }
  sql += ` ON ${tableRef}`;
  
  if (trig.isConstraint) {
    sql += ' FOR EACH ROW';
    if (trig.constraint) sql += ` FROM ${trig.constraint}`;
    if (trig.isDeferrable) {
      sql += ` DEFERRABLE INITIALLY ${trig.deferred ? 'DEFERRED' : 'IMMEDIATE'}`;
    }
  } else {
    const granular = trig.level || (trig.isForEachRow ? 'ROW' : 'STATEMENT');
    sql += ` FOR EACH ${granular}`;
  }
  
  if (trig.condition) sql += ` WHEN (${trig.condition})`;
  
  const funcName = trig.function || '';
  let funcRef = '';
  if (funcName.includes('.')) {
    funcRef = funcName.split('.').map(ident).join('.');
  } else {
    funcRef = `${ident(trig.schema || 'public')}.${ident(funcName)}`;
  }
  const args = trig.functionArguments || '';
  sql += ` EXECUTE FUNCTION ${funcRef}(${args});`;
  
  return sql;
}

function generateCreateIndexSql(idx) {
  if (idx.isConstraintIndex || idx.isPrimaryKeyIndex || (idx.name && (idx.name.endsWith('_pkey') || idx.name.endsWith('_key')))) {
    return `-- Index ${idx.name} automatically backing PK/Unique constraint`;
  }
  let sql = '';
  if (idx.definition) {
    sql = idx.definition;
    if (!sql.endsWith(';')) sql += ';';
  } else {
    sql = 'CREATE ';
    if (idx.isUnique) sql += 'UNIQUE ';
    
    sql += 'INDEX';
    if (idx.isConcurrent) sql += ' CONCURRENTLY';
    
    const ifNotExists = idx.ifNotExists !== false && !idx.isConcurrent ? 'IF NOT EXISTS ' : '';
    
    const tableIdent = (() => {
      if (!idx.table) return '';
      const tableStr = String(idx.table);
      if (tableStr.includes('.') && tableStr.split('.').length === 2) {
        const parts = tableStr.split('.');
        return `${ident(parts[0])}.${ident(parts[1])}`;
      }
      return `${ident(idx.schema)}.${ident(tableStr)}`;
    })();
    
    sql += ` ${ifNotExists}${ident(idx.name)} ON ${tableIdent}`;
    
    if (idx.accessMethod && idx.accessMethod !== 'btree') {
      sql += ` USING ${idx.accessMethod}`;
    }
    
    const cols = (idx.columns || []).map(c => {
      if (typeof c === 'string') {
        return ident(c);
      }
      let col = c.expression || ident(c.name);
      if (c.collation) col += ` COLLATE ${c.collation}`;
      if (c.opclass) col += ` ${c.opclass}`;
      if (c.isAscending === false) col += ' DESC';
      if (c.isNullsFirst) col += ' NULLS FIRST';
      if (c.isNullsLast) col += ' NULLS LAST';
      return col;
    });
    
    sql += ` (${cols.join(', ')})`;

    const includeCols = idx.include || idx.includeColumns;
    if (includeCols && includeCols.length > 0) {
      sql += ` INCLUDE (${includeCols.map(ident).join(', ')})`;
    }
    
    if (idx.where || idx.whereClause) {
      sql += ` WHERE ${idx.where || idx.whereClause}`;
    }
    if (idx.tablespace) sql += ` TABLESPACE ${ident(idx.tablespace)}`;
    if (idx.fillfactor) sql += ` WITH (fillfactor=${idx.fillfactor})`;
    
    sql += ';';
  }

  const idxKey = `${ident(idx.schema)}.${ident(idx.name)}`;
  if (idx.owner) {
    sql += `\nALTER INDEX ${idxKey} OWNER TO ${ident(idx.owner)};`;
  }
  if (idx.comment) {
    sql += `\nCOMMENT ON INDEX ${idxKey} IS '${escapeString(idx.comment)}';`;
  }

  return sql;
}

function generateCreateConstraintSql(con) {
  const tableNameClean = con.tableName || (con.table ? con.table.split('.').pop() : '');
  if (!tableNameClean || tableNameClean === 'null' || con.domain || con.domainName) {
    return '';
  }
  const table = con.tableKey || `${ident(con.schema)}.${ident(tableNameClean)}`;
  const constraintType = con.constraintType || con.type;
  const isDeferred = con.initiallyDeferred || con.deferred || con.isDeferred;
  const deferClause = con.deferrable ? (isDeferred ? ' DEFERRABLE INITIALLY DEFERRED' : ' DEFERRABLE INITIALLY IMMEDIATE') : '';
  const enforceClause = con.enforced === false ? ' NOT ENFORCED' : '';

  let sql = '';
  switch (constraintType) {
    case 'PRIMARY KEY':
    case 'PRIMARY_KEY':
      return `-- Primary key ${con.name} created inline during CREATE TABLE`;
      
    case 'FOREIGN KEY':
    case 'FOREIGN_KEY': {
      const refSchema = con.referencedSchema || con.refSchema || con.schema;
      const refTableClean = con.referencedTable || con.refTable || '';
      const refTableName = refTableClean.includes('.') ? refTableClean.split('.').pop() : refTableClean;
      const refTableRef = `${ident(refSchema)}.${ident(refTableName)}`;
      sql = `ALTER TABLE ${table} ADD CONSTRAINT ${ident(con.name)} FOREIGN KEY (${(con.columns || []).map(ident).join(', ')}) REFERENCES ${refTableRef} (${(con.referencedColumns || []).map(ident).join(', ')})`;
      if (con.onDelete) sql += ` ON DELETE ${con.onDelete}`;
      if (con.onUpdate) sql += ` ON UPDATE ${con.onUpdate}`;
      sql += `${deferClause}${enforceClause};`;
      break;
    }

    case 'UNIQUE':
      if (con.createdWithTable || con.isInline || con.generatedInTable || (con.name && con.name.endsWith('_key'))) {
        return `-- Unique constraint ${con.name} created inline during CREATE TABLE`;
      }
      const nullsNotDistinct = con.nullsNotDistinct !== undefined && con.nullsNotDistinct !== null && con.nullsNotDistinct ? ' NULLS NOT DISTINCT' : '';
      sql = `ALTER TABLE ${table} ADD CONSTRAINT ${ident(con.name)} UNIQUE (${(con.columns || []).map(ident).join(', ')})${nullsNotDistinct}${deferClause}${enforceClause};`;
      break;
      
    case 'CHECK': {
      if (con.createdWithTable || con.isInline || con.generatedInTable || (con.name && con.name.endsWith('_check'))) {
        return `-- Check constraint ${con.name} created inline during CREATE TABLE`;
      }
      const validatedExpr = validateCheckExpression(
        con.checkExpression || con.expression || con.definition || ''
      );
      sql = `ALTER TABLE ${table} ADD CONSTRAINT ${ident(con.name)} CHECK (${validatedExpr})${enforceClause};`;
      break;
    }
      
    case 'EXCLUSION':
      sql = `ALTER TABLE ${table} ADD CONSTRAINT ${ident(con.name)} EXCLUDE ${con.accessMethod || 'GIST'} (${con.exclusions?.map(e => `${e.expression} WITH ${e.operator}`).join(', ') || ''})${con.where ? ` WHERE ${con.where}` : ''}${deferClause};`;
      break;
      
    default:
      return `-- Unsupported constraint type: ${constraintType}`;
  }

  if (con.comment) {
    sql += `\nCOMMENT ON CONSTRAINT ${ident(con.name)} ON ${table} IS '${escapeString(con.comment)}';`;
  }

  return sql;
}

function generateCreateSequenceSql(seq) {
  let sql = `CREATE SEQUENCE ${ident(seq.schema)}.${ident(seq.name)}`;
  
  const increment = seq.increment;
  const minValue = seq.minimumValue ?? seq.minValue;
  const maxValue = seq.maximumValue ?? seq.maxValue;
  const startValue = seq.startValue;
  const cache = seq.cacheSize ?? seq.cache;
  const cycle = seq.isCycled ?? seq.cycle;

  if (increment) sql += ` INCREMENT ${increment}`;
  if (minValue !== undefined) sql += ` MINVALUE ${minValue}`;
  if (maxValue !== undefined) sql += ` MAXVALUE ${maxValue}`;
  if (startValue !== undefined) sql += ` START ${startValue}`;
  if (cache !== undefined) sql += ` CACHE ${cache}`;
  if (cycle) sql += ' CYCLE';

  // OWNED BY is omitted during CREATE SEQUENCE to allow creation before dependent tables
  // Table columns reference sequences via DEFAULT nextval(...) during CREATE TABLE

  sql += ';';

  const seqKey = `${ident(seq.schema)}.${ident(seq.name)}`;
  if (seq.owner) {
    sql += `\nALTER SEQUENCE ${seqKey} OWNER TO ${ident(seq.owner)};`;
  }
  if (seq.comment) {
    sql += `\nCOMMENT ON SEQUENCE ${seqKey} IS '${escapeString(seq.comment)}';`;
  }
  if (seq.privileges && seq.privileges.length > 0) {
    for (const g of seq.privileges) {
      let grantSql = `GRANT ${g.privilege} ON SEQUENCE ${seqKey} TO ${ident(g.grantee)}`;
      if (g.isGrantable) grantSql += ' WITH GRANT OPTION';
      sql += `\n${grantSql};`;
    }
  }

  return sql;
}

function generateCreateExtensionSql(ext) {
  let sql = `CREATE EXTENSION IF NOT EXISTS ${ident(ext.name)}`;
  if (ext.schema) sql += ` SCHEMA ${ident(ext.schema)}`;
  if (ext.version) sql += ` VERSION ${ext.version}`;
  return sql + ';';
}

function generateCreatePolicySql(pol) {
  let sql = '';
  const isPermissive = pol.isPermissive !== false;
  
  sql += `CREATE POLICY ${ident(pol.name)} ON ${ident(pol.schema)}.${ident(pol.table)}`;
  
  if (!isPermissive) sql += ' AS RESTRICTIVE';
  
  if (pol.command) sql += ` FOR ${pol.command}`;
  
  const roles = pol.roles && Array.isArray(pol.roles) ? pol.roles : ['PUBLIC'];
  if (roles.length > 0) {
    sql += ` TO ${roles.map(r => r === 'PUBLIC' ? 'PUBLIC' : ident(r)).join(', ')}`;
  } else {
    sql += ' TO PUBLIC';
  }
  
  if (pol.using) sql += ` USING (${pol.using})`;
  if (pol.withCheck) sql += ` WITH CHECK (${pol.withCheck})`;
  
  return sql + ';';
}

function generateCreateTypeSql(type) {
  if (type.kind === 'DOMAIN' || type.baseType) {
    return generateCreateDomainSql(type);
  }
  if (type.kind === 'ENUM' || type.enumValues) {
    const values = (type.enumValues || []).map(v => {
      const val = typeof v === 'string' ? v : v.value;
      // SECURITY: Escape single quotes in enum values to prevent SQL injection
      return `'${String(val).replace(/'/g, "''")}'`;
    }).join(', ');
    return `CREATE TYPE ${ident(type.schema)}.${ident(type.name)} AS ENUM (${values});`;
  }
  
  if (type.kind === 'COMPOSITE') {
    if (!type.attributes) return `-- Composite type ${type.name} has no attributes`;
    return `CREATE TYPE ${ident(type.schema)}.${ident(type.name)} AS (${type.attributes.map(a => `${ident(a.name)} ${a.dataType || a.type || a.data_type || 'text'}`).join(', ')});`;
  }
  
  if (type.kind === 'RANGE') {
    return `CREATE TYPE ${ident(type.schema)}.${ident(type.name)} AS RANGE (SUBTYPE = ${type.subtype}${type.subtypeOpclass ? `, SUBTYPE_OPCLASS = ${type.subtypeOpclass}` : ''}${type.canonicalFunction ? `, CANONICAL = ${type.canonicalFunction}` : ''}${type.subtypeDiff ? `, SUBTYPE_DIFF = ${type.subtypeDiff}` : ''});`;
  }
  
  return `-- Unsupported type creation: ${type.kind}`;
}

function generateCreateDomainSql(domain) {
  let sql = `CREATE DOMAIN ${ident(domain.schema)}.${ident(domain.name)} AS ${domain.baseType}`;
  if (domain.default) sql += ` DEFAULT ${domain.default}`;
  if (domain.notNull) sql += ' NOT NULL';
  if (domain.check) sql += ` CHECK (${domain.check})`;
  return sql + ';';
}

function generateCreateRuleSql(rule) {
  let sql = `CREATE RULE ${ident(rule.name)} AS`;
  const isInstead = rule.isInstead !== undefined ? rule.isInstead : rule.instead;
  if (isInstead) sql += ' ON INSTEAD';
  else sql += ' ON';
  
  if (rule.events) {
    sql += ` ${rule.events.join(' OR ')}`;
  }
  
  const tName = rule.tableName || rule.table || '';
  let tableRef = '';
  if (tName.includes('.')) {
    tableRef = tName.split('.').map(ident).join('.');
  } else {
    tableRef = `${ident(rule.schema || 'public')}.${ident(tName)}`;
  }
  sql += ` TO ${tableRef}`;
  
  if (rule.condition) sql += ` WHERE ${rule.condition}`;
  
  if (rule.commands) {
    sql += ' DO ' + (rule.commands.length > 1 ? `(${rule.commands.join('; ')})` : rule.commands[0]);
  } else {
    sql += ' DO INSTEAD NOTHING';
  }
  
  return sql + ';';
}

function generateCreateAggregateSql(agg) {
  const args = (agg.argumentTypes || []).join(', ');
  let sql = `CREATE AGGREGATE ${ident(agg.schema)}.${ident(agg.name)}(${args}) (`;
  const parts = [];
  if (agg.sfunc) parts.push(`SFUNC = ${agg.sfunc}`);
  if (agg.stype) parts.push(`STYPE = ${agg.stype}`);
  if (agg.finalfunc) parts.push(`FINALFUNC = ${agg.finalfunc}`);
  if (agg.combinefunc) parts.push(`COMBINEFUNC = ${agg.combinefunc}`);
  if (agg.serialfunc) parts.push(`SERIALFUNC = ${agg.serialfunc}`);
  if (agg.deserializefunc) parts.push(`DESERIALFUNC = ${agg.deserializefunc}`);
  if (agg.initcond) parts.push(`INITCOND = '${agg.initcond}'`);
  if (agg.mtransType) parts.push(`STYPE = ${agg.mtransType}`);
  if (agg.msfunc) parts.push(`MSTYPE = ${agg.msfunc}`);
  if (agg.mfinalfunc) parts.push(`MSTYPE = ${agg.mfinalfunc}`);
  if (agg.sortOp) parts.push(`SORTOP = ${agg.sortOp}`);
  sql += parts.join(', ') + ');';
  return sql;
}

function generateCreateTextSearchParserSql(parser) {
  let sql = `CREATE TEXT SEARCH PARSER ${ident(parser.schema)}.${ident(parser.name)} (`;
  const parts = [];
  if (parser.start) parts.push(`START = ${parser.start}`);
  if (parser.getToken) parts.push(`GETTOKEN = ${parser.getToken}`);
  if (parser.end) parts.push(`END = ${parser.end}`);
  if (parser.lextypes) parts.push(`LEXTYPES = ${parser.lextypes}`);
  if (parser.headline) parts.push(`HEADLINE = ${parser.headline}`);
  sql += parts.join(', ') + ');';
  return sql;
}

function generateCreateTextSearchTemplateSql(template) {
  let sql = `CREATE TEXT SEARCH TEMPLATE ${ident(template.schema)}.${ident(template.name)} (`;
  const parts = [];
  if (template.lexize) parts.push(`LEXIZE = ${template.lexize}`);
  if (template.init) parts.push(`INIT = ${template.init}`);
  sql += parts.join(', ') + ');';
  return sql;
}

function generateCreateTextSearchDictSql(dict) {
  let sql = `CREATE TEXT SEARCH DICTIONARY ${ident(dict.schema)}.${ident(dict.name)} (`;
  sql += `TEMPLATE = ${dict.template}`;
  if (dict.options && Object.keys(dict.options).length > 0) {
    sql += ', ' + Object.entries(dict.options).map(([k, v]) => `${k} = '${v}'`).join(', ');
  }
  sql += ');';
  return sql;
}

function generateCreateTextSearchConfigSql(config) {
  let sql = `CREATE TEXT SEARCH CONFIGURATION ${ident(config.schema)}.${ident(config.name)} (`;
  sql += `PARSER = ${config.parser || 'default'}`;
  sql += ');';
  
  if (config.tokenMappings && config.tokenMappings.length > 0) {
    for (const mapping of config.tokenMappings) {
      sql += `\nALTER TEXT SEARCH CONFIGURATION ${ident(config.schema)}.${ident(config.name)} ADD MAPPING FOR ${mapping.tokens.join(', ')} WITH ${mapping.dictionaries.join(', ')};`;
    }
  }
  
  return sql;
}

function generateCreateOperatorSql(op) {
  let sql = `CREATE OPERATOR ${ident(op.schema)}.${ident(op.name)} (`;
  const parts = [];
  const left = op.leftarg || op.leftType;
  const right = op.rightarg || op.rightType;
  const proc = op.procedure || op.proc;
  const restrict = op.restrict || op.restrictFunction;
  const join = op.join || op.joinFunction;
  const hashes = op.hashes !== undefined ? op.hashes : op.canHash;
  const merges = op.merges !== undefined ? op.merges : op.canMerge;

  if (left) parts.push(`LEFTARG = ${left}`);
  if (right) parts.push(`RIGHTARG = ${right}`);
  if (proc) parts.push(`PROCEDURE = ${proc}`);
  if (op.commutator) parts.push(`COMMUTATOR = ${op.commutator}`);
  if (op.negator) parts.push(`NEGATOR = ${op.negator}`);
  if (restrict) parts.push(`RESTRICT = ${restrict}`);
  if (join) parts.push(`JOIN = ${join}`);
  if (hashes) parts.push('HASHES');
  if (merges) parts.push('MERGES');
  sql += parts.join(', ') + ');';
  return sql;
}

function generateCreateOperatorClassSql(opClass) {
  let sql = `CREATE OPERATOR CLASS ${ident(opClass.schema)}.${ident(opClass.name)}`;
  if (opClass.isDefault) sql += ' DEFAULT';
  const forType = opClass.inputType || opClass.forType;
  sql += ` FOR TYPE ${forType} USING ${opClass.accessMethod || 'btree'}`;
  if (opClass.family) sql += ` FAMILY ${opClass.family}`;
  sql += ' AS ';
  
  const items = [];
  if (opClass.operators) {
    for (const op of opClass.operators) {
      items.push(`OPERATOR ${op.number} ${op.name}${op.recheck ? ' RECHECK' : ''}`);
    }
  }
  if (opClass.functions) {
    for (const fn of opClass.functions) {
      items.push(`FUNCTION ${fn.number} ${fn.name}`);
    }
  }
  if (opClass.storages) {
    for (const st of opClass.storages) {
      items.push(`STORAGE ${st.type}`);
    }
  }
  
  sql += items.join(', ') + ';';
  return sql;
}

function generateCreateOperatorFamilySql(opFamily) {
  return `CREATE OPERATOR FAMILY ${ident(opFamily.schema)}.${ident(opFamily.name)} USING ${opFamily.accessMethod || 'btree'};`;
}

function generateCreatePublicationSql(pub) {
  let sql = `CREATE PUBLICATION ${ident(pub.name)}`;
  
  if (pub.tables && pub.tables.length > 0) {
    sql += ' FOR TABLE ' + pub.tables.map(t => {
      let tableRef = t.schema ? `${ident(t.schema)}.${ident(t.name)}` : ident(t.name);
      if (t.columns) tableRef += ` (${t.columns.map(c => ident(c)).join(', ')})`;
      return tableRef;
    }).join(', ');
  } else if (pub.forAllTables) {
    sql += ' FOR ALL TABLES';
  } else {
    sql += ' FOR ALL TABLES';
  }
  
  const withOpts = [];
  if (pub.publishInsert !== false) withOpts.push('publish = \'insert\'');
  if (pub.publishUpdate !== false) withOpts.push('publish = \'update\'');
  if (pub.publishDelete !== false) withOpts.push('publish = \'delete\'');
  if (pub.publishTruncate !== false) withOpts.push('publish = \'truncate\'');
  
  if (withOpts.length > 0) {
    sql += ' WITH (' + withOpts.join(', ') + ')';
  }
  
  return sql + ';';
}

/**
 * Escape a connection string for safe inclusion in DDL.
 * SECURITY: Escapes single quotes to prevent SQL injection.
 * Note: Connection strings may contain credentials - consider sanitizing for logs.
 */
function escapeConnectionString(connStr) {
  if (!connStr || typeof connStr !== 'string') return connStr;
  // Escape single quotes for PostgreSQL string literal
  return connStr.replace(/'/g, "''");
}

function generateCreateSubscriptionSql(sub) {
  let sql = `CREATE SUBSCRIPTION ${ident(sub.name)}`;
  const conn = sub.conninfo || sub.connectionString || sub.connection;
  // SECURITY: Escape single quotes in connection string
  // Note: Connection string may contain credentials - PostgreSQL stores this encrypted in pg_subscription
  sql += ` CONNECTION '${escapeConnectionString(conn)}'`;
  sql += ` PUBLICATION ${Array.isArray(sub.publications) ? sub.publications.join(', ') : sub.publications}`;
  
  const withOpts = [];
  if (sub.enabled !== false) withOpts.push('enabled = true');
  if (sub.createSlot !== false) withOpts.push('create_slot = true');
  if (sub.slotName) withOpts.push(`slot_name = '${sub.slotName}'`);
  
  const sync = sub.syncCommit || sub.synchronousCommit;
  if (sync !== undefined) {
    withOpts.push(`synchronous_commit = ${typeof sync === 'boolean' ? (sync ? "'on'" : "'off'") : `'${sync}'`}`);
  }
  
  const binary = sub.binaryTransfer || sub.binary;
  if (binary !== undefined) {
    withOpts.push(`binary = ${binary ? 'true' : 'false'}`);
  }
  
  const streaming = sub.streaming;
  if (streaming !== undefined) {
    withOpts.push(`streaming = ${typeof streaming === 'boolean' ? (streaming ? "'on'" : "'off'") : `'${streaming}'`}`);
  }
  
  if (sub.twoPhase !== undefined) {
    withOpts.push(`two_phase = ${sub.twoPhase ? 'true' : 'false'}`);
  }
  if (sub.disableOnError !== undefined) {
    withOpts.push(`disable_on_error = ${sub.disableOnError ? 'true' : 'false'}`);
  }
  if (sub.origin !== undefined) {
    withOpts.push(`origin = ${typeof sub.origin === 'boolean' ? (sub.origin ? "'any'" : "'none'") : `'${sub.origin}'`}`);
  }
  
  if (withOpts.length > 0) {
    sql += ' WITH (' + withOpts.join(', ') + ')';
  }
  
  return sql + ';';
}

function generateCreateStatisticsSql(stat) {
  if (stat.definition) {
    let sql = stat.definition;
    if (!sql.endsWith(';')) sql += ';';
    return sql;
  }
  let sql = `CREATE STATISTICS ${ident(stat.schema)}.${ident(stat.name)}`;
  if (stat.kinds && stat.kinds.length > 0) {
    sql += ` (${stat.kinds.join(', ')})`;
  }
  sql += ` ON ${stat.columns.map(c => ident(c)).join(', ')}`;
  const formattedTable = stat.table.includes('.') ? stat.table.split('.').map(ident).join('.') : ident(stat.table);
  sql += ` FROM ${formattedTable}`;
  return sql + ';';
}

function generateCreateCollationSql(coll) {
  let sql = `CREATE COLLATION ${ident(coll.schema)}.${ident(coll.name)}`;
  
  if (coll.fromCollation) {
    sql += ` FROM ${coll.fromCollation}`;
  } else {
    const params = [];
    if (coll.locale) params.push(`locale = '${coll.locale}'`);
    if (coll.lcCollate) params.push(`lc_collate = '${coll.lcCollate}'`);
    if (coll.lcCtype) params.push(`lc_ctype = '${coll.lcCtype}'`);
    if (coll.provider) params.push(`provider = ${coll.provider}`);
    
    const det = coll.isDeterministic !== undefined ? coll.isDeterministic : coll.deterministic;
    if (det !== undefined) params.push(`deterministic = ${det}`);
    
    if (coll.version) params.push(`version = '${coll.version}'`);
    if (coll.encoding) params.push(`encoding = '${coll.encoding}'`);
    
    if (params.length > 0) {
      sql += ' (' + params.join(', ') + ')';
    }
  }
  
  return sql + ';';
}

function generateCreateCastSql(cast) {
  let sql = `CREATE CAST (${cast.sourceType} AS ${cast.targetType})`;
  
  if (cast.function) {
    sql += ` WITH FUNCTION ${cast.function}`;
  } else if (cast.inout) {
    sql += ' WITH INOUT';
  } else {
    sql += ' WITHOUT FUNCTION';
  }
  
  if (cast.context === 'IMPLICIT') {
    sql += ' AS IMPLICIT';
  } else if (cast.context === 'ASSIGNMENT') {
    sql += ' AS ASSIGNMENT';
  }
  
  return sql + ';';
}

function generateCreateForeignServerSql(server) {
  let sql = `CREATE SERVER ${ident(server.name)}`;
  if (server.type) sql += ` TYPE '${server.type}'`;
  if (server.version) sql += ` VERSION '${server.version}'`;
  sql += ` FOREIGN DATA WRAPPER ${server.foreignDataWrapper}`;
  
  if (server.options && Object.keys(server.options).length > 0) {
    sql += ' OPTIONS (' + Object.entries(server.options).map(([k, v]) => `${k} '${v}'`).join(', ') + ')';
  }
  
  return sql + ';';
}

function generateCreateForeignDataWrapperSql(fdw) {
  let sql = `CREATE FOREIGN DATA WRAPPER ${ident(fdw.name)}`;
  
  if (fdw.handler) {
    sql += ` HANDLER ${fdw.handler}`;
  }
  if (fdw.validator) {
    sql += ` VALIDATOR ${fdw.validator}`;
  }
  if (fdw.options && Object.keys(fdw.options).length > 0) {
    sql += ' OPTIONS (' + Object.entries(fdw.options).map(([k, v]) => `${k} '${v}'`).join(', ') + ')';
  }
  
  return sql + ';';
}

function generateCreateUserMappingSql(mapping) {
  let sql = `CREATE USER MAPPING FOR ${mapping.user === 'PUBLIC' ? 'PUBLIC' : ident(mapping.user)}`;
  sql += ` SERVER ${ident(mapping.server)}`;
  
  if (mapping.options && Object.keys(mapping.options).length > 0) {
    sql += ' OPTIONS (' + Object.entries(mapping.options).map(([k, v]) => {
      if (k === 'password') return `${k} '[REDACTED]'`;
      return `${k} '${v}'`;
    }).join(', ') + ')';
  }
  
  return sql + ';';
}

function generateCreateForeignTableSql(ft) {
  let sql = `CREATE FOREIGN TABLE ${ident(ft.schema)}.${ident(ft.name)} (`;
  sql += (ft.columns || []).map(c => {
    let col = `${ident(c.name)} ${c.dataType}`;
    if (c.collation) col += ` COLLATE ${c.collation}`;
    return col;
  }).join(', ');
  sql += `) SERVER ${ident(ft.server)}`;
  
  if (ft.options && Object.keys(ft.options).length > 0) {
    sql += ' OPTIONS (' + Object.entries(ft.options).map(([k, v]) => `${k} '${v}'`).join(', ') + ')';
  }
  sql += ';';

  const key = `${ident(ft.schema)}.${ident(ft.name)}`;
  if (ft.rlsEnabled) {
    sql += `\nALTER FOREIGN TABLE ${key} ENABLE ROW LEVEL SECURITY;`;
  }
  if (ft.rlsForced) {
    sql += `\nALTER FOREIGN TABLE ${key} FORCE ROW LEVEL SECURITY;`;
  }

  return sql;
}

function generateCreateEventTriggerSql(et) {
  let sql = `CREATE EVENT TRIGGER ${ident(et.name)} ON ${et.event}`;
  
  if (et.tags && et.tags.length > 0) {
    sql += ` WHEN TAG IN (${et.tags.map(t => `'${t}'`).join(', ')})`;
  }
  
  sql += ` EXECUTE FUNCTION ${et.function}`;
  if (et.functionArguments) {
    sql += `(${et.functionArguments})`;
  }
  
  return sql + ';';
}

function generateCreateRoleSql(role) {
  let sql = `CREATE ROLE ${ident(role.name)}`;
  const opts = [];
  if (role.superuser) opts.push('SUPERUSER');
  if (role.createdb) opts.push('CREATEDB');
  if (role.createrole) opts.push('CREATEROLE');
  if (role.inherit !== false) opts.push('INHERIT');
  if (role.login) opts.push('LOGIN');
  if (role.replication) opts.push('REPLICATION');
  if (role.connectionLimit !== undefined) opts.push(`CONNECTION LIMIT ${role.connectionLimit}`);
  if (role.password) opts.push(`PASSWORD '[REDACTED]'`);
  if (role.validUntil) opts.push(`VALID UNTIL '${role.validUntil}'`);
  
  if (opts.length > 0) {
    sql += ' ' + opts.join(' ');
  }
  
  return sql + ';';
}

function generateCreateDatabaseSql(db) {
  let sql = `CREATE DATABASE ${ident(db.name)}`;
  if (db.owner) sql += ` OWNER ${ident(db.owner)}`;
  if (db.template) sql += ` TEMPLATE ${ident(db.template)}`;
  if (db.encoding) sql += ` ENCODING '${db.encoding}'`;
  if (db.collation) sql += ` COLLATE ${db.collation}`;
  if (db.tablespace) sql += ` TABLESPACE ${ident(db.tablespace)}`;
  if (db.connectionLimit !== undefined) sql += ` CONNECTION LIMIT ${db.connectionLimit}`;
  
  return sql + ';';
}

function generateCreateTablespaceSql(ts) {
  let sql = `CREATE TABLESPACE ${ident(ts.name)}`;
  if (ts.owner) sql += ` OWNER ${ident(ts.owner)}`;
  sql += ` LOCATION '${ts.location}'`;
  
  if (ts.options && Object.keys(ts.options).length > 0) {
    sql += ' WITH (' + Object.entries(ts.options).map(([k, v]) => `${k} = ${v}`).join(', ') + ')';
  }
  
  return sql + ';';
}

function generateCreateLanguageSql(lang) {
  let sql = `CREATE LANGUAGE ${ident(lang.name)}`;
  
  if (lang.isTrusted) {
    sql += ' TRUSTED';
  }
  
  if (lang.handler) {
    sql += ` HANDLER ${lang.handler}`;
  }
  if (lang.inline) {
    sql += ` INLINE ${lang.inline}`;
  }
  if (lang.validator) {
    sql += ` VALIDATOR ${lang.validator}`;
  }
  
  return sql + ';';
}

function parseAclItem(item, objectType) {
  const parts = item.split('/');
  const left = parts[0];
  const eqIdx = left.indexOf('=');
  let grantee = 'PUBLIC';
  let privsStr = left;
  if (eqIdx !== -1) {
    grantee = left.substring(0, eqIdx) || 'PUBLIC';
    privsStr = left.substring(eqIdx + 1);
  }

  const charMap = {
    r: 'SELECT',
    w: 'UPDATE',
    a: 'INSERT',
    d: 'DELETE',
    D: 'TRUNCATE',
    x: 'REFERENCES',
    t: 'TRIGGER',
    X: 'EXECUTE',
    U: 'USAGE',
    C: 'CREATE',
    c: 'CONNECT',
    T: 'TEMPORARY'
  };

  const privs = [];
  let isGrantable = false;
  for (let i = 0; i < privsStr.length; i++) {
    const c = privsStr[i];
    if (c === '*') {
      isGrantable = true;
      continue;
    }
    const mapped = charMap[c];
    if (mapped) privs.push(mapped);
  }

  return { grantee, privileges: privs.join(', '), isGrantable };
}

function generateCreateDefaultPrivilegesSql(dp) {
  let sqlPrefix = 'ALTER DEFAULT PRIVILEGES';
  
  if (dp.schema && dp.schema !== 'public') {
    sqlPrefix += ` IN SCHEMA ${ident(dp.schema)}`;
  }
  
  const role = dp.forRole || dp.role;
  if (role) {
    sqlPrefix += ` FOR ROLE ${ident(role)}`;
  }
  
  const objType = (dp.objectType || dp.object_type || 'TABLES').toUpperCase();
  const acl = dp.acl || [];

  if (acl.length > 0) {
    const stmts = [];
    for (const item of acl) {
      const { grantee, privileges, isGrantable } = parseAclItem(item, objType);
      let stmt = `${sqlPrefix} GRANT ${privileges || 'ALL'} ON ${objType} TO ${ident(grantee)}`;
      if (isGrantable) stmt += ' WITH GRANT OPTION';
      stmts.push(stmt + ';');
    }
    return stmts.join('\n');
  }

  const grantees = dp.grantees || dp.grantee || 'PUBLIC';
  const privs = dp.privileges || dp.privilege || 'ALL';
  let stmt = `${sqlPrefix} GRANT ${privs} ON ${objType} TO ${Array.isArray(grantees) ? grantees.map(g => ident(g)).join(', ') : ident(grantees)}`;
  if (dp.withGrantOption) stmt += ' WITH GRANT OPTION';
  return stmt + ';';
}

function generateCreateConversionSql(conv) {
  // PostgreSQL: CREATE [ DEFAULT ] CONVERSION name FOR 'src' TO 'dest' FROM func
  const defaultKw = conv.isDefault ? 'DEFAULT ' : '';
  const target = conv.targetEncoding || conv.destEncoding;
  const proc = conv.proc || conv.function;
  let sql = `CREATE ${defaultKw}CONVERSION ${ident(conv.schema || 'public')}.${ident(conv.name)}`;
  sql += ` FOR '${conv.sourceEncoding}' TO '${target}' FROM ${proc}`;
  return sql + ';';
}

function generateCreateAccessMethodSql(am) {
  let sql = `CREATE ACCESS METHOD ${ident(am.name)}`;
  sql += ` TYPE ${am.type.toUpperCase()} HANDLER ${am.handler}`;
  return sql + ';';
}

/**
 * CREATE MATERIALIZED VIEW — PostgreSQL clause order:
 *   [ (columns) ] [ WITH (storage) ] [ TABLESPACE ts ] AS query [ WITH [ NO ] DATA ]
 * Accepts both property aliases used across the codebase
 * (withData/isWithData, storageParameters/storageOptions/storageSettings).
 */
function generateCreateMaterializedViewSql(mv) {
  let sql = `CREATE MATERIALIZED VIEW ${ident(mv.schema || 'public')}.${ident(mv.name)}`;

  if (mv.columns && mv.columns.length > 0) {
    sql += ` (${mv.columns.map(c => ident(typeof c === 'string' ? c : c.name)).join(', ')})`;
  }

  const storage = mv.storageParameters || mv.storageOptions || mv.storageSettings;
  if (storage) {
    if (typeof storage === 'string') {
      sql += ` WITH (${storage})`;
    } else if (Object.keys(storage).length > 0) {
      sql += ' WITH (' + Object.entries(storage).map(([k, v]) => `${k} = ${v}`).join(', ') + ')';
    }
  }

  if (mv.tablespace) {
    sql += ` TABLESPACE ${ident(mv.tablespace)}`;
  }

  sql += ` AS ${mv.definition}`;

  const withData = mv.withData !== undefined ? mv.withData : mv.isWithData;
  if (withData === false) {
    sql += ' WITH NO DATA';
  } else {
    sql += ' WITH DATA';
  }

  sql += ';';

  const mvKey = `${ident(mv.schema || 'public')}.${ident(mv.name)}`;
  if (mv.owner) {
    sql += `\nALTER MATERIALIZED VIEW ${mvKey} OWNER TO ${ident(mv.owner)};`;
  }
  if (mv.comment) {
    sql += `\nCOMMENT ON MATERIALIZED VIEW ${mvKey} IS '${escapeString(mv.comment)}';`;
  }
  if (mv.privileges && mv.privileges.length > 0) {
    for (const g of mv.privileges) {
      let grantSql = `GRANT ${g.privilege} ON MATERIALIZED VIEW ${mvKey} TO ${ident(g.grantee)}`;
      if (g.isGrantable) grantSql += ' WITH GRANT OPTION';
      sql += `\n${grantSql};`;
    }
  }

  return sql;
}

function ident(name) {
  if (!name) return '';
  if (typeof name !== 'string') name = String(name);
  
  // Validation: PostgreSQL identifier max length is 63 characters
  if (name.length > 63) {
    console.warn(
      `[Security] Identifier "${name.substring(0, 30)}..." (${name.length} chars) exceeds PostgreSQL limit of 63. ` +
      `PostgreSQL will truncate to "${name.substring(0, 63)}".`
    );
  }
  
  // Check for NUL character
  if (name.includes('\0')) {
    throw new Error(`Identifier contains NUL character (\\0) which is not allowed in PostgreSQL identifiers`);
  }
  
  // Always double-quote identifiers to handle all special characters
  // Escape embedded double-quotes by doubling them
  return `"${name.replace(/"/g, '""')}"`;
}

function escapeString(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/'/g, "''");
}

/**
 * Escape a default value for safe inclusion in DDL.
 * 
 * SECURITY: This function prevents SQL injection in DEFAULT clauses.
 * 
 * @param {*} defaultVal - The default value to escape
 * @returns {string} - Escaped value safe for DDL
 */
function escapeDefaultValue(defaultVal) {
  if (defaultVal === null || defaultVal === undefined) return 'NULL';
  
  const str = String(defaultVal).trim();
  if (str === '') return "''";
  if (str.toUpperCase() === 'NULL') return 'NULL';
  
  // Check if it's already dollar-quoted (user provided safe format)
  if (str.startsWith('$$') && str.endsWith('$$')) {
    return str;
  }
  
  // Check if it's already single-quoted
  if (str.startsWith("'") && str.endsWith("'")) {
    // Validate and re-escape the contents
    const inner = str.slice(1, -1);
    return `'${inner.replace(/'/g, "''")}'`;
  }
  
  // Check if it's a PostgreSQL keyword/function that should not be quoted
  const noQuoteKeywords = [
    'TRUE', 'FALSE',
    'NOW()', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME',
    'CURRENT_USER', 'SESSION_USER', 'CURRENT_SCHEMA',
    'GEN_RANDOM_UUID()', 'UUID_GENERATE_V4()'
  ];
  
  if (noQuoteKeywords.includes(str.toUpperCase())) {
    return str;
  }
  
  // Check if it's a number (integers and floats)
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return str;
  }
  
  // Check if it's a PostgreSQL function call or expression
  // Functions: func_name(), func_name(args)
  if (/^[a-z_][a-z0-9_]*\s*\(/i.test(str) || 
      str.toUpperCase().includes('::') || 
      str.includes('ARRAY[') ||
      str.includes('[]')) {
    // This might be intentional SQL expression - pass through but warn
    console.warn(
      `[Security] Default value "${str.substring(0, 50)}${str.length > 50 ? '...' : ''}" ` +
      `appears to be a SQL expression. Ensure this is intentional.`
    );
    return str;
  }
  
  // Default: treat as string literal, escape single quotes and wrap
  return `'${str.replace(/'/g, "''")}'`;
}
