/**
 * Schema Weaver Migration Engine - DDL Generator
 * https://schemaweaver.vivekmind.com/
 */

export function generateAlterSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  const currentValue = change.currentValue;
  const desiredValue = change.desiredValue;
  const before = change.before;
  const after = change.after;
  const changeType = change.changeType;

  if (property === 'comment') {
    return generateGenericCommentSql(change);
  }
  if (property === 'privileges') {
    if (change.objectType === 'table' && change.metadata?.grantsToMake) {
      // let it fall through to generateAlterTableSql
    } else {
      return generateGenericPrivilegesSql(change);
    }
  }

  switch (change.objectType) {
    case 'table':
      return generateAlterTableSql(change);

    case 'column':
      return generateAlterColumnSql(change);

    case 'constraint':
      return generateAlterConstraintSql(change);

    case 'index':
      return generateAlterIndexSql(change);

    case 'function':
    case 'procedure':
      return generateAlterFunctionSql(change);

    case 'sequence':
      return generateAlterSequenceSql(change);

    case 'view':
      return generateAlterViewSql(change);

    case 'trigger':
      return generateAlterTriggerSql(change);

    case 'policy':
      return generateAlterPolicySql(change);

    case 'eventTrigger':
      return generateAlterEventTriggerSql(change);

    case 'type':
    case 'domain':
      return generateAlterTypeSql(change);

    case 'materializedView':
      return generateAlterMaterializedViewSql(change);

    case 'defaultPrivileges':
      return generateAlterDefaultPrivilegesSql(change);

    case 'conversion':
      return generateAlterConversionSql(change);

    case 'foreignServer':
      return generateAlterForeignServerSql(change);

    case 'foreignDataWrapper':
      return generateAlterForeignDataWrapperSql(change);

    case 'userMapping':
      return generateAlterUserMappingSql(change);

    case 'foreignTable':
      return generateAlterForeignTableSql(change);

    case 'textSearchConfig':
      return generateAlterTextSearchConfigSql(change);

    case 'textSearchDict':
      return generateAlterTextSearchDictSql(change);

    case 'operator':
      return generateAlterOperatorSql(change);

    case 'operatorClass':
      return generateAlterOperatorClassSql(change);

    case 'operatorFamily':
      return generateAlterOperatorFamilySql(change);

    case 'publication':
      return generateAlterPublicationSql(change);

    case 'subscription':
      return generateAlterSubscriptionSql(change);

    case 'statistics':
      return generateAlterStatisticsSql(change);

    case 'collation':
      return generateAlterCollationSql(change);

    case 'language':
      return generateAlterLanguageSql(change);

    case 'accessMethod':
      return generateAlterAccessMethodSql(change);

    case 'extension':
      return generateAlterExtensionSql(change);

    default:
      return generateGenericAlterSql(change);
  }
}

function generateAlterTableSql(change) {
  const property = change.property;
  const value = change.desiredValue;
  const tableKey = change.objectKey;

  switch (property) {
    case 'tablespace':
      return `ALTER TABLE ${tableKey} SET TABLESPACE ${ident(value)};`;
    case 'unlogged':
      return value ? `ALTER TABLE ${tableKey} SET UNLOGGED;` : `ALTER TABLE ${tableKey} SET LOGGED;`;
    case 'rlsEnabled':
      return value ? `ALTER TABLE ${tableKey} ENABLE ROW LEVEL SECURITY;` : `ALTER TABLE ${tableKey} DISABLE ROW LEVEL SECURITY;`;
    case 'rlsForced':
      return value ? `ALTER TABLE ${tableKey} FORCE ROW LEVEL SECURITY;` : `ALTER TABLE ${tableKey} NO FORCE ROW LEVEL SECURITY;`;
    
    case 'replicaIdentity':
      if (value === 'default') return `ALTER TABLE ${tableKey} REPLICA IDENTITY DEFAULT;`;
      if (value === 'full') return `ALTER TABLE ${tableKey} REPLICA IDENTITY FULL;`;
      if (value === 'nothing') return `ALTER TABLE ${tableKey} REPLICA IDENTITY NOTHING;`;
      if (typeof value === 'string' && value.startsWith('index:')) {
        const idxName = value.split(':')[1];
        return `ALTER TABLE ${tableKey} REPLICA IDENTITY USING INDEX ${ident(idxName)};`;
      }
      return `ALTER TABLE ${tableKey} REPLICA IDENTITY ${value.toUpperCase()};`;

    case 'hasOids':
      return value ? `ALTER TABLE ${tableKey} SET WITH OIDS;` : `ALTER TABLE ${tableKey} SET WITHOUT OIDS;`;

    case 'storageParameters': {
      const currentParams = change.currentValue || {};
      const desiredParams = change.desiredValue || {};
      const toSet = [];
      const toReset = [];

      for (const [k, v] of Object.entries(desiredParams)) {
        if (currentParams[k] !== v) {
          toSet.push(`${k}=${v}`);
        }
      }
      for (const k of Object.keys(currentParams)) {
        if (desiredParams[k] === undefined) {
          toReset.push(k);
        }
      }

      const stmts = [];
      if (toSet.length > 0) {
        stmts.push(`ALTER TABLE ${tableKey} SET (${toSet.join(', ')});`);
      }
      if (toReset.length > 0) {
        stmts.push(`ALTER TABLE ${tableKey} RESET (${toReset.join(', ')});`);
      }
      return stmts.join('\n');
    }

    case 'inheritsFrom': {
      const currentParents = change.currentValue || [];
      const desiredParents = change.desiredValue || [];
      const inheritStmts = [];
      
      for (const parent of desiredParents) {
        if (!currentParents.includes(parent)) {
          inheritStmts.push(`ALTER TABLE ${tableKey} INHERIT ${parent};`);
        }
      }
      for (const parent of currentParents) {
        if (!desiredParents.includes(parent)) {
          inheritStmts.push(`ALTER TABLE ${tableKey} NO INHERIT ${parent};`);
        }
      }
      return inheritStmts.join('\n');
    }

    case 'partitionParent': {
      const cur = change.currentValue || {};
      const des = change.desiredValue || {};
      const stmts = [];

      if (cur.parent) {
        const curParentParts = cur.parent.split('.');
        const curParentRef = curParentParts.map(ident).join('.');
        stmts.push(`ALTER TABLE ${curParentRef} DETACH PARTITION ${tableKey};`);
      }
      if (des.parent && des.bound) {
        const desParentParts = des.parent.split('.');
        const desParentRef = desParentParts.map(ident).join('.');
        stmts.push(`ALTER TABLE ${desParentRef} ATTACH PARTITION ${tableKey} ${des.bound};`);
      }
      return stmts.join('\n');
    }

    case 'comment':
      if (value === null || value === undefined || value === '') {
        return `COMMENT ON TABLE ${tableKey} IS NULL;`;
      }
      return `COMMENT ON TABLE ${tableKey} IS '${value.replace(/'/g, "''")}';`;

    case 'privileges': {
      const { grantsToMake = [], revokesToMake = [] } = change.metadata || {};
      const stmts = [];
      
      for (const r of revokesToMake) {
        stmts.push(`REVOKE ${r.privilege} ON TABLE ${tableKey} FROM ${ident(r.grantee)};`);
      }
      for (const g of grantsToMake) {
        let sql = `GRANT ${g.privilege} ON TABLE ${tableKey} TO ${ident(g.grantee)}`;
        if (g.isGrantable) sql += ' WITH GRANT OPTION';
        stmts.push(sql + ';');
      }
      return stmts.join('\n');
    }

    case 'parallelWorkers':
      return `ALTER TABLE ${tableKey} SET (parallel_workers=${value});`;
    case 'owner':
      return `ALTER TABLE ${tableKey} OWNER TO ${ident(value)};`;
    case 'accessMethod': {
      const method = value !== undefined && value !== null ? value : change.after?.accessMethod;
      return `ALTER TABLE ${tableKey} SET ACCESS METHOD ${ident(method)};`;
    }
    
    case 'mergePartitions':
      return generateMergePartitionsSql(change, tableKey);
    
    case 'splitPartition':
      return generateSplitPartitionSql(change, tableKey);
    
    default:
      return `-- Unsupported table property: ${property}`;
  }
}

function generateMergePartitionsSql(change, tableKey) {
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
  if (pgVersion < 190000) {
    return `-- WARNING: MERGE PARTITIONS requires PostgreSQL 19+.\\n-- Table: ${tableKey}`;
  }
  const partitions = change.desiredValue?.partitions || change.desiredValue || [];
  const targetPartition = change.desiredValue?.target || change.desiredValue?.into;
  if (!targetPartition) {
    return `-- ERROR: MERGE PARTITIONS requires target partition name`;
  }
  const partitionRefs = partitions.map(p => ident(p)).join(', ');
  return `ALTER TABLE ${tableKey} MERGE PARTITIONS ${partitionRefs} INTO ${ident(targetPartition)};`;
}

function generateSplitPartitionSql(change, tableKey) {
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
  if (pgVersion < 190000) {
    return `-- WARNING: SPLIT PARTITION requires PostgreSQL 19+.\\n-- Table: ${tableKey}`;
  }
  const sourcePartition = change.desiredValue?.source || change.desiredValue?.partition;
  const intoPartitions = change.desiredValue?.into || change.desiredValue?.partitions || [];
  if (!sourcePartition) {
    return `-- ERROR: SPLIT PARTITION requires source partition name`;
  }
  const intoRefs = intoPartitions.map(p => {
    let ref = ident(p.name);
    if (p.bound) {
      ref += ` FOR VALUES ${p.bound}`;
    }
    return ref;
  }).join(', ');
  return `ALTER TABLE ${tableKey} SPLIT PARTITION ${ident(sourcePartition)} INTO (${intoRefs});`;
}

function generateAlterColumnSql(change) {
  const parts = change.objectKey.split('.');
  const col = parts.pop();
  const table = parts.join('.');
  const property = change.property;

  switch (property) {
    case 'dataType':
      const using = change.usingExpression || `${col}::${change.desiredValue}`;
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} TYPE ${change.desiredValue} USING ${using};`;

    case 'isNullable':
      if (change.desiredValue) {
        return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} DROP NOT NULL;`;
      }
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET NOT NULL;`;

    case 'defaultValue':
      if (change.desiredValue === null || change.desiredValue === undefined) {
        return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} DROP DEFAULT;`;
      }
      // SECURITY: Use escapeDefaultValue to prevent SQL injection
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET DEFAULT ${escapeDefaultValue(change.desiredValue)};`;

    case 'isIdentity':
      if (change.desiredValue) {
        const after = change.after || {};
        const opts = after.identityOptions || {};
        const rawMode = after.identityMode || after.identityType || (after.isAlwaysIdentity ? 'ALWAYS' : 'BY DEFAULT');
        const mode = rawMode === 'BY_DEFAULT' ? 'BY DEFAULT' : rawMode;
        let sql = `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} ADD GENERATED ${mode} AS IDENTITY`;
        const seqOpts = [];
        const start = opts.start ?? after.identityStart;
        const increment = opts.increment ?? after.identityIncrement;
        const min = opts.min ?? opts.minimum ?? after.identityMinimum;
        const max = opts.max ?? opts.maximum ?? after.identityMaximum;
        const cache = opts.cache ?? after.identityCache;
        const cycle = opts.cycle ?? after.identityCycle;
        if (increment != null) seqOpts.push(`INCREMENT ${increment}`);
        if (start != null) seqOpts.push(`START ${start}`);
        if (min != null) seqOpts.push(`MINVALUE ${min}`);
        if (max != null) seqOpts.push(`MAXVALUE ${max}`);
        if (cache != null) seqOpts.push(`CACHE ${cache}`);
        if (cycle) seqOpts.push('CYCLE');
        if (seqOpts.length > 0) sql += ` (${seqOpts.join(', ')})`;
        return sql + ';';
      }
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} DROP IDENTITY;`;

    case 'identityOptions':
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET ${change.desiredValue || ''};`;

    // Identity sequence options — PostgreSQL: ALTER COLUMN ... SET sequence_option
    case 'identityStart':
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET START ${change.desiredValue};`;
    case 'identityIncrement':
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET INCREMENT ${change.desiredValue};`;
    case 'identityMinimum':
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET MINVALUE ${change.desiredValue};`;
    case 'identityMaximum':
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET MAXVALUE ${change.desiredValue};`;
    case 'identityCache':
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET CACHE ${change.desiredValue};`;
    case 'identityCycle':
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET ${change.desiredValue ? 'CYCLE' : 'NO CYCLE'};`;
    case 'identityMode':
    case 'identityType':
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET GENERATED ${change.desiredValue === 'BY_DEFAULT' || change.desiredValue === 'BY DEFAULT' ? 'BY DEFAULT' : 'ALWAYS'};`;

    case 'isGenerated': {
      const genExpr = change.after?.generatedExpression ?? change.generatedExpression;
      if (change.desiredValue && genExpr) {
        return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET GENERATED ALWAYS AS (${genExpr}) STORED;`;
      }
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} DROP EXPRESSION;`;
    }

    case 'generatedExpression':
      if (change.desiredValue) {
        return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET GENERATED ALWAYS AS (${change.desiredValue}) STORED;`;
      }
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} DROP EXPRESSION;`;

    case 'comment':
      if (change.desiredValue === null || change.desiredValue === '') {
        return `COMMENT ON COLUMN ${table}.${ident(col)} IS NULL;`;
      }
      return `COMMENT ON COLUMN ${table}.${ident(col)} IS '${escapeString(change.desiredValue)}';`;

    case 'storage':
      if (change.desiredValue === null || change.desiredValue === undefined) {
        return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} RESET STORAGE;`;
      }
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET STORAGE ${change.desiredValue.toUpperCase()};`;

    case 'statistics':
    case 'statisticsTarget':
      if (change.desiredValue === null || change.desiredValue === undefined || change.desiredValue === -1) {
        return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} RESET STATISTICS;`;
      }
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET STATISTICS ${change.desiredValue};`;

    case 'compression':
      if (change.desiredValue === null || change.desiredValue === undefined) {
        return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} RESET COMPRESSION;`;
      }
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} SET COMPRESSION ${change.desiredValue.toUpperCase()};`;

    case 'foreignOptions':
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} OPTIONS (${Object.entries(change.desiredValue || {}).map(([k, v]) => `${k} '${escapeString(v)}'`).join(', ')});`;

    case 'collation': {
      const colInfo = change.after || change.desired || {};
      const dataType = colInfo.dataType || change.before?.dataType || 'text';
      return `ALTER TABLE ${table} ALTER COLUMN ${ident(col)} TYPE ${dataType} COLLATE ${change.desiredValue};`;
    }

    default:
      return `-- Unsupported column property: ${property}`;
  }
}

function generateAlterConstraintSql(change) {
  const con = change.after || {};
  const tableKey = change.objectKey.split('.').slice(0, -1).join('.') || con._tableKey;
  const conName = change.name || change.objectKey.split('.').pop();

  switch (change.property) {
    case 'isValidated':
      if (change.desiredValue === true) {
        return `ALTER TABLE ${tableKey} VALIDATE CONSTRAINT ${ident(conName)};`;
      }
      break;

    case 'deferrable':
      if (change.desiredValue) {
        return `ALTER TABLE ${tableKey} ALTER CONSTRAINT ${ident(conName)} DEFERRABLE;`;
      }
      return `ALTER TABLE ${tableKey} ALTER CONSTRAINT ${ident(conName)} NOT DEFERRABLE;`;

    case 'initiallyDeferred':
    case 'deferred':
      return `ALTER TABLE ${tableKey} ALTER CONSTRAINT ${ident(conName)} INITIALLY ${change.desiredValue ? 'DEFERRED' : 'IMMEDIATE'};`;

    case 'indexTablespace':
      const idxName = con.indexName || `${conName}_idx`;
      return `ALTER INDEX ${idxName} SET TABLESPACE ${ident(change.desiredValue)};`;

    case 'enforced':
    case 'isEnforced':
      return generateAlterConstraintEnforcedSql(change, tableKey, conName, con);

    default:
      if (con.constraintType === 'EXCLUSION' || con.type === 'EXCLUSION') {
        return `-- Exclusion constraint modification requires recreation: ${change.property}`;
      }
      return `-- Constraint modification requires recreation: ${change.property}`;
  }
  return '';
}

function generateAlterConstraintEnforcedSql(change, tableKey, conName, con) {
  const constraintType = con.constraintType || con.type;
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
  const isPg19 = pgVersion >= 190000;
  
  if (constraintType === 'CHECK' || constraintType === 'FOREIGN KEY' || constraintType === 'FOREIGN_KEY') {
    if (!change.desiredValue) {
      if (constraintType === 'CHECK' && !isPg19) {
        return `-- WARNING: ALTER CONSTRAINT NOT ENFORCED for CHECK constraints requires PostgreSQL 19+.\\n-- Constraint: ${conName}`;
      }
      return `ALTER TABLE ${tableKey} ALTER CONSTRAINT ${ident(conName)} NOT ENFORCED;`;
    }
    return `ALTER TABLE ${tableKey} ALTER CONSTRAINT ${ident(conName)} ENFORCED;`;
  }
  return `-- ENFORCED property not supported for constraint type: ${constraintType}`;
}

function generateAlterIndexSql(change) {
  const idxKey = change.objectKey;
  const property = change.property;

  switch (property) {
    case 'tablespace':
      return `ALTER INDEX ${idxKey} SET TABLESPACE ${ident(change.desiredValue)};`;
    case 'fillfactor':
      return `ALTER INDEX ${idxKey} SET (fillfactor=${change.desiredValue});`;
    case 'owner':
      return `ALTER INDEX ${idxKey} OWNER TO ${ident(change.desiredValue)};`;
    case 'comment':
      if (change.desiredValue === null || change.desiredValue === undefined || change.desiredValue === '') {
        return `COMMENT ON INDEX ${idxKey} IS NULL;`;
      }
      return `COMMENT ON INDEX ${idxKey} IS '${escapeString(change.desiredValue)}';`;
    case 'reindex':
      return `REINDEX INDEX ${idxKey};`;
    default:
      return `-- Index modification requires recreation for: ${property}`;
  }
}

function generateAlterFunctionSql(change) {
  const fn = change.after || change.before || {};
  const name = change.objectKey;
  const argTypesList = fn.argumentTypes || fn.arguments || change.before?.argumentTypes || change.before?.arguments || [];
  const argsStr = Array.isArray(argTypesList) ? argTypesList.join(', ') : '';

  if (change.changeType === 'ALTER' && change.property === 'source') {
    return `CREATE OR REPLACE ${change.objectType === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} ${name}(${argsStr})${fn.returnType ? ` RETURNS ${fn.returnType}` : ''} LANGUAGE ${fn.language || 'sql'} AS $$${fn.source || ''}$$;`;
  }

  let sql = `ALTER ${change.objectType === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} ${name}(${argsStr})`;
  
  switch (change.property) {
    case 'volatility':
      return sql + ' ' + change.desiredValue + ';';
    case 'isNullCall':
      return sql + (change.desiredValue ? ' CALLED ON NULL INPUT;' : ' RETURNS NULL ON NULL INPUT;');
    case 'securityType':
      return sql + (change.desiredValue === 'DEFINER' ? ' SECURITY DEFINER;' : ' SECURITY INVOKER;');
    case 'cost':
      return sql + ` SET cost=${change.desiredValue};`;
    case 'parallelSafety':
      return sql + ` SET parallel=${change.desiredValue};`;
    case 'owner':
      return sql + ` OWNER TO ${ident(change.desiredValue)};`;
    case 'schema':
      return sql + ` SET SCHEMA ${ident(change.desiredValue)};`;
    case 'comment':
      if (change.desiredValue === null || change.desiredValue === '') {
        return `COMMENT ON ${change.objectType === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} ${name}(${argsStr}) IS NULL;`;
      }
      return `COMMENT ON ${change.objectType === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} ${name}(${argsStr}) IS '${escapeString(change.desiredValue)}';`;
    default:
      return `-- Unsupported function property: ${change.property}`;
  }
}

function generateAlterSequenceSql(change) {
  const seqKey = change.objectKey;
  const property = change.property;

  switch (property) {
    case 'increment':
      return `ALTER SEQUENCE ${seqKey} INCREMENT ${change.desiredValue};`;
    case 'minimumValue':
    case 'minValue':
      return `ALTER SEQUENCE ${seqKey} MINVALUE ${change.desiredValue};`;
    case 'maximumValue':
    case 'maxValue':
      return `ALTER SEQUENCE ${seqKey} MAXVALUE ${change.desiredValue};`;
    case 'cacheSize':
    case 'cache':
      return `ALTER SEQUENCE ${seqKey} CACHE ${change.desiredValue};`;
    case 'isCycled':
    case 'cycle':
      return change.desiredValue ? `ALTER SEQUENCE ${seqKey} CYCLE;` : `ALTER SEQUENCE ${seqKey} NO CYCLE;`;
    case 'startValue':
    case 'currentValue':
      return `ALTER SEQUENCE ${seqKey} RESTART WITH ${change.desiredValue};`;
    case 'schema':
      return `ALTER SEQUENCE ${seqKey} SET SCHEMA ${ident(change.desiredValue)};`;
    case 'owner':
      return `ALTER SEQUENCE ${seqKey} OWNER TO ${ident(change.desiredValue)};`;
    case 'comment':
      if (change.desiredValue === null || change.desiredValue === undefined || change.desiredValue === '') {
        return `COMMENT ON SEQUENCE ${seqKey} IS NULL;`;
      }
      return `COMMENT ON SEQUENCE ${seqKey} IS '${escapeString(change.desiredValue)}';`;
    case 'ownedBy': {
      // Skip OWNED BY changes for identity sequences - PostgreSQL manages these automatically
      // and cannot ALTER OWNED BY on identity sequences
      if (change.before?.ownedBy || change.object?.ownedBy) {
        return `-- Skipping OWNED BY change for identity sequence ${seqKey} (managed by PostgreSQL)`;
      }
      if (change.desiredValue === null || change.desiredValue === undefined || change.desiredValue === 'NONE') {
        return `ALTER SEQUENCE ${seqKey} OWNED BY NONE;`;
      }
      const ownedParts = change.desiredValue.split('.');
      const formattedOwnedBy = ownedParts.map(ident).join('.');
      return `ALTER SEQUENCE ${seqKey} OWNED BY ${formattedOwnedBy};`;
    }
    default:
      return `-- Unsupported sequence property: ${change.property}`;
  }
}

function generateAlterViewSql(change) {
  const viewKey = change.objectKey;

  switch (change.property) {
    case 'definition':
      return `CREATE OR REPLACE VIEW ${viewKey} AS ${change.desiredValue};`;
    case 'checkOption':
      if (change.desiredValue && change.desiredValue !== 'NONE') {
        return `ALTER VIEW ${viewKey} SET (check_option=${change.desiredValue.toLowerCase()});`;
      }
      return `ALTER VIEW ${viewKey} RESET (check_option);`;
    case 'owner':
      return `ALTER VIEW ${viewKey} OWNER TO ${ident(change.desiredValue)};`;
    case 'schema':
      return `ALTER VIEW ${viewKey} SET SCHEMA ${ident(change.desiredValue)};`;
    case 'securityBarrier':
      return `ALTER VIEW ${viewKey} ${change.desiredValue ? 'SET (security_barrier=true)' : 'SET (security_barrier=false)'};`;
    case 'securityInvoker':
      return `ALTER VIEW ${viewKey} ${change.desiredValue ? 'SET (security_invoker=true)' : 'SET (security_invoker=false)'};`;
    default:
      return `-- Unsupported view property: ${change.property}`;
  }
}

function generateAlterTriggerSql(change) {
  if (change.property === 'enabled') {
    const trigKey = change.objectKey;
    const schema = change.schema;
    const name = change.name;
    const table = change.after?.tableName || change.objectKey.split('.').slice(0, -1).join('.');
    
    switch (change.desiredValue) {
      case 'ENABLED':
      case true:
        return `ALTER TABLE ${table} ENABLE TRIGGER ${ident(name)};`;
      case 'DISABLED':
      case false:
        return `ALTER TABLE ${table} DISABLE TRIGGER ${ident(name)};`;
      case 'REPLICA':
        return `ALTER TABLE ${table} ENABLE REPLICA TRIGGER ${ident(name)};`;
      case 'ALWAYS':
        return `ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${ident(name)};`;
    }
  }

  return `-- Trigger modification requires recreation for: ${change.property}`;
}

function generateAlterPolicySql(change) {
  const policyKey = change.objectKey;
  const parts = policyKey.split('.');
  const policyName = parts.pop();
  const tableName = parts.join('.');
  const property = change.property;

  switch (property) {
    case 'roles':
      const roles = (change.desiredValue || []).map(r => r === 'PUBLIC' ? 'PUBLIC' : ident(r)).join(', ');
      return `ALTER POLICY ${ident(policyName)} ON ${tableName} TO ${roles};`;
    case 'using':
      return `ALTER POLICY ${ident(policyName)} ON ${tableName} USING (${change.desiredValue || 'true'});`;
    case 'withCheck':
      return `ALTER POLICY ${ident(policyName)} ON ${tableName} WITH CHECK (${change.desiredValue});`;
    default:
      return `-- Policy modification requires recreation for: ${change.property}`;
  }
}

function generateAlterTypeSql(change) {
  const typeKey = change.objectKey;
  const property = change.property;
  const typeKind = change.before?.kind || change.after?.kind;

  if (property === 'enumValues' || property === 'labels') {
    const beforeList = change.before?.labels || change.before?.enumValues || [];
    const afterList = change.after?.labels || change.after?.enumValues || [];
    const existingValues = change.existingEnumValues || change.before?.existingEnumValues || [];
    const stmts = [];

    const normalizeValue = (v) => typeof v === 'object' ? v.value : v;
    const normalizedBefore = beforeList.map(normalizeValue);
    const normalizedAfter = afterList.map(normalizeValue);
    const normalizedExisting = existingValues.map(normalizeValue);

    if (beforeList.length > 0 && afterList.length > 0) {
      const removedLabels = normalizedBefore.filter(l => !normalizedAfter.includes(l));
      const addedLabels = normalizedAfter.filter(l => !normalizedBefore.includes(l));

      const trulyAdded = addedLabels.filter(l => !normalizedExisting.includes(l));

      if (removedLabels.length === 1 && trulyAdded.length === 1) {
        const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
        if (pgVersion >= 160000) {
          stmts.push(`ALTER TYPE ${typeKey} RENAME VALUE '${removedLabels[0]}' TO '${trulyAdded[0]}';`);
        } else {
          stmts.push(`-- WARNING: ALTER TYPE ... RENAME VALUE requires PostgreSQL 16+.\n-- Would rename '${removedLabels[0]}' to '${trulyAdded[0]}'.`);
          if (!normalizedExisting.includes(trulyAdded[0])) {
            stmts.push(`ALTER TYPE ${typeKey} ADD VALUE '${trulyAdded[0]}';`);
          }
        }
      } else {
        for (const val of trulyAdded) {
          if (normalizedExisting.includes(val)) {
            stmts.push(`-- Skipping ADD VALUE '${val}' - already exists in enum`);
            continue;
          }
          const newIdx = normalizedAfter.indexOf(val);
          let posClause = '';
          if (newIdx > 0) {
            const prevLabel = normalizedAfter[newIdx - 1];
            if (normalizedBefore.includes(prevLabel) || normalizedExisting.includes(prevLabel)) {
              posClause = ` AFTER '${prevLabel}'`;
            }
          } else if (newIdx === 0 && normalizedAfter.length > 1) {
            const nextLabel = normalizedAfter[1];
            if (normalizedBefore.includes(nextLabel) || normalizedExisting.includes(nextLabel)) {
              posClause = ` BEFORE '${nextLabel}'`;
            }
          }
          stmts.push(`ALTER TYPE ${typeKey} ADD VALUE '${val}'${posClause};`);
        }
        for (const val of removedLabels) {
          stmts.push(`-- WARNING: PostgreSQL does not support removing enum values.\n-- The enum value '${val}' cannot be dropped.\n-- Consider recreating the enum type if removal is required.`);
        }
      }
    } else {
      const added = (change.desiredValue?.added || []).map(normalizeValue);
      const removed = (change.desiredValue?.removed || []).map(normalizeValue);
      if (added.length > 0) {
        for (const val of added) {
          if (normalizedExisting.includes(val)) {
            stmts.push(`-- Skipping ADD VALUE '${val}' - already exists in enum`);
            continue;
          }
          stmts.push(`ALTER TYPE ${typeKey} ADD VALUE '${val}';`);
        }
      }
      if (removed.length > 0) {
        for (const val of removed) {
          stmts.push(`-- WARNING: PostgreSQL does not support removing enum values.\n-- The enum value '${val}' cannot be dropped.\n-- Consider recreating the enum type if removal is required.`);
        }
      }
    }
    return stmts.join('\n');
  }

  if (typeKind === 'domain' || change.objectType === 'domain') {
    return generateAlterDomainSql(change, typeKey);
  }

  if (typeKind === 'composite' || change.objectType === 'composite') {
    return generateAlterCompositeSql(change, typeKey);
  }

  if (typeKind === 'range' || change.objectType === 'range') {
    return generateAlterRangeSql(change, typeKey);
  }

  switch (property) {
    case 'owner':
      return `ALTER TYPE ${typeKey} OWNER TO ${ident(change.desiredValue)};`;
    case 'schema':
      return `ALTER TYPE ${typeKey} SET SCHEMA ${ident(change.desiredValue)};`;
    case 'comment':
      if (change.desiredValue === null || change.desiredValue === '') {
        return `COMMENT ON TYPE ${typeKey} IS NULL;`;
      }
      return `COMMENT ON TYPE ${typeKey} IS '${escapeString(change.desiredValue)}';`;
    default:
      return `-- Unsupported type property: ${change.property}`;
  }
}

function generateAlterDomainSql(change, typeKey) {
  const property = change.property;

  switch (property) {
    case 'notNull':
      if (change.desiredValue === true) {
        return `ALTER DOMAIN ${typeKey} SET NOT NULL;`;
      }
      return `ALTER DOMAIN ${typeKey} DROP NOT NULL;`;
    case 'default':
      if (change.desiredValue === null || change.desiredValue === undefined) {
        return `ALTER DOMAIN ${typeKey} DROP DEFAULT;`;
      }
      return `ALTER DOMAIN ${typeKey} SET DEFAULT ${change.desiredValue};`;
    case 'check':
      if (change.desiredValue === null || change.desiredValue === undefined) {
        const constraintName = change.before?.checkName || `${typeKey.replace(/\./g, '_')}_check`;
        return `ALTER DOMAIN ${typeKey} DROP CONSTRAINT ${ident(constraintName)};`;
      }
      const checkName = change.after?.checkName || `${typeKey.replace(/\./g, '_')}_check`;
      return `ALTER DOMAIN ${typeKey} ADD CONSTRAINT ${ident(checkName)} CHECK (${change.desiredValue});`;
    case 'owner':
      return `ALTER DOMAIN ${typeKey} OWNER TO ${ident(change.desiredValue)};`;
    case 'schema':
      return `ALTER DOMAIN ${typeKey} SET SCHEMA ${ident(change.desiredValue)};`;
    default:
      return `-- Unsupported domain property: ${property}`;
  }
}

function generateAlterCompositeSql(change, typeKey) {
  const property = change.property;

  switch (property) {
    case 'addAttribute':
      const attr = change.desiredValue;
      return `ALTER TYPE ${typeKey} ADD ATTRIBUTE ${ident(attr.name)} ${attr.dataType};`;
    case 'dropAttribute':
      return `ALTER TYPE ${typeKey} DROP ATTRIBUTE ${ident(change.desiredValue)};`;
    case 'alterAttribute':
      const alterAttr = change.desiredValue;
      return `ALTER TYPE ${typeKey} ALTER ATTRIBUTE ${ident(alterAttr.name)} SET DATA TYPE ${alterAttr.dataType};`;
    case 'renameAttribute':
      return `ALTER TYPE ${typeKey} RENAME ATTRIBUTE ${ident(change.currentValue)} TO ${ident(change.desiredValue)};`;
    case 'owner':
      return `ALTER TYPE ${typeKey} OWNER TO ${ident(change.desiredValue)};`;
    case 'schema':
      return `ALTER TYPE ${typeKey} SET SCHEMA ${ident(change.desiredValue)};`;
    default:
      return `-- Unsupported composite type property: ${property}`;
  }
}

function generateAlterRangeSql(change, typeKey) {
  const property = change.property;

  switch (property) {
    case 'canonical':
      return `ALTER TYPE ${typeKey} SET (${change.desiredValue ? `canonical = ${ident(change.desiredValue)}` : ''});`;
    case 'subtypeDiff':
      return `ALTER TYPE ${typeKey} SET (subtype_diff = ${ident(change.desiredValue)});`;
    case 'owner':
      return `ALTER TYPE ${typeKey} OWNER TO ${ident(change.desiredValue)};`;
    case 'schema':
      return `ALTER TYPE ${typeKey} SET SCHEMA ${ident(change.desiredValue)};`;
    default:
      return `-- Unsupported range type property: ${property}`;
  }
}

function generateGenericAlterSql(change) {
  const objKey = change.objectKey;
  const property = change.property;
  const desiredValue = change.desiredValue;

  switch (property) {
    case 'owner':
      return `ALTER ${change.objectType.toUpperCase()} ${objKey} OWNER TO ${ident(desiredValue)};`;
    case 'schema':
      return `ALTER ${change.objectType.toUpperCase()} ${objKey} SET SCHEMA ${ident(desiredValue)};`;
    case 'comment':
      if (desiredValue === null || desiredValue === '') {
        return `COMMENT ON ${change.objectType.toUpperCase()} ${objKey} IS NULL;`;
      }
      return `COMMENT ON ${change.objectType.toUpperCase()} ${objKey} IS '${escapeString(desiredValue)}';`;
    default:
      return `-- Unsupported ${change.objectType} property: ${property}`;
  }
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
  
  // Always double-quote identifiers
  return `"${name.replace(/"/g, '""')}"`;
}

function escapeString(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/'/g, "''");
}

/**
 * Escape a default value for safe inclusion in DDL.
 * SECURITY: This function prevents SQL injection in DEFAULT clauses.
 */
function escapeDefaultValue(defaultVal) {
  if (defaultVal === null || defaultVal === undefined) return 'NULL';
  
  const str = String(defaultVal).trim();
  if (str === '') return "''";
  if (str.toUpperCase() === 'NULL') return 'NULL';
  
  // Check if it's already dollar-quoted
  if (str.startsWith('$$') && str.endsWith('$$')) {
    return str;
  }
  
  // Check if it's already single-quoted
  if (str.startsWith("'") && str.endsWith("'")) {
    const inner = str.slice(1, -1);
    return `'${inner.replace(/'/g, "''")}'`;
  }
  
  // PostgreSQL keywords/functions that should not be quoted
  const noQuoteKeywords = [
    'TRUE', 'FALSE',
    'NOW()', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME',
    'CURRENT_USER', 'SESSION_USER', 'CURRENT_SCHEMA',
    'GEN_RANDOM_UUID()', 'UUID_GENERATE_V4()'
  ];
  
  if (noQuoteKeywords.includes(str.toUpperCase())) {
    return str;
  }
  
  // Numbers should not be quoted
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return str;
  }
  
  // Default: treat as string literal
  return `'${str.replace(/'/g, "''")}'`;
}

function generateAlterDefaultPrivilegesSql(change) {
  const beforeDp = change.before || {};
  const afterDp = change.after || {};

  const schema = afterDp.schema || beforeDp.schema || change.schema;
  const role = afterDp.role || afterDp.forRole || beforeDp.role || beforeDp.forRole;
  const objType = (afterDp.objectType || afterDp.object_type || beforeDp.objectType || beforeDp.object_type || 'TABLES').toUpperCase();

  let sqlPrefix = 'ALTER DEFAULT PRIVILEGES';
  if (schema && schema !== 'public') {
    sqlPrefix += ` IN SCHEMA ${ident(schema)}`;
  }
  if (role) {
    sqlPrefix += ` FOR ROLE ${ident(role)}`;
  }

  const stmts = [];

  const parseAclItemLocal = (item, type) => {
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
  };

  const beforeAcl = beforeDp.acl || [];
  if (beforeAcl.length > 0) {
    for (const item of beforeAcl) {
      const { grantee, privileges } = parseAclItemLocal(item, objType);
      stmts.push(`${sqlPrefix} REVOKE ${privileges || 'ALL'} ON ${objType} FROM ${ident(grantee)};`);
    }
  }

  const afterAcl = afterDp.acl || [];
  if (afterAcl.length > 0) {
    for (const item of afterAcl) {
      const { grantee, privileges, isGrantable } = parseAclItemLocal(item, objType);
      let stmt = `${sqlPrefix} GRANT ${privileges || 'ALL'} ON ${objType} TO ${ident(grantee)}`;
      if (isGrantable) stmt += ' WITH GRANT OPTION';
      stmts.push(stmt + ';');
    }
  }

  return stmts.join('\n');
}

function generateAlterConversionSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'schema':
      return `ALTER CONVERSION ${objectKey} SET SCHEMA ${ident(change.desiredValue)};`;
    case 'owner':
      return `ALTER CONVERSION ${objectKey} OWNER TO ${ident(change.desiredValue)};`;
    default:
      return `-- Unsupported conversion property: ${property}`;
  }
}

function generateAlterForeignServerSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'version':
      if (change.desiredValue === null) {
        return `ALTER SERVER ${ident(objectKey)} VERSION 'none';`;
      }
      return `ALTER SERVER ${ident(objectKey)} VERSION '${change.desiredValue}';`;
      
    case 'options':
      const opts = change.desiredValue || {};
      const addOpts = Object.entries(opts).map(([k, v]) => {
        if (k === 'password') return `ADD ${k} '[REDACTED]'`;
        return `ADD ${k} '${v}'`;
      });
      return `ALTER SERVER ${ident(objectKey)} OPTIONS (${addOpts.join(', ')});`;
      
    case 'owner':
      return `ALTER SERVER ${ident(objectKey)} OWNER TO ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported foreign server property: ${property}`;
  }
}

function generateAlterForeignDataWrapperSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'handler':
      if (change.desiredValue === null) {
        return `ALTER FOREIGN DATA WRAPPER ${ident(objectKey)} NO HANDLER;`;
      }
      return `ALTER FOREIGN DATA WRAPPER ${ident(objectKey)} HANDLER ${change.desiredValue};`;
      
    case 'validator':
      if (change.desiredValue === null) {
        return `ALTER FOREIGN DATA WRAPPER ${ident(objectKey)} NO VALIDATOR;`;
      }
      return `ALTER FOREIGN DATA WRAPPER ${ident(objectKey)} VALIDATOR ${change.desiredValue};`;
      
    case 'options':
      const opts = change.desiredValue || {};
      const addOpts = Object.entries(opts).map(([k, v]) => {
        if (k === 'password') return `ADD ${k} '[REDACTED]'`;
        return `ADD ${k} '${v}'`;
      });
      return `ALTER FOREIGN DATA WRAPPER ${ident(objectKey)} OPTIONS (${addOpts.join(', ')});`;
      
    case 'owner':
      return `ALTER FOREIGN DATA WRAPPER ${ident(objectKey)} OWNER TO ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported FDW property: ${property}`;
  }
}

function generateAlterUserMappingSql(change) {
  const objectKey = change.objectKey;
  const user = change.before?.user || 'PUBLIC';
  const server = change.before?.server;
  const property = change.property;
  
  switch (property) {
    case 'options':
      const opts = change.desiredValue || {};
      const addOpts = Object.entries(opts).map(([k, v]) => {
        if (k === 'password') return `ADD ${k} '[REDACTED]'`;
        return `ADD ${k} '${v}'`;
      });
      return `ALTER USER MAPPING FOR ${user === 'PUBLIC' ? 'PUBLIC' : ident(user)} SERVER ${ident(server)} OPTIONS (${addOpts.join(', ')});`;
      
    default:
      return `-- Unsupported user mapping property: ${property}`;
  }
}

function generateAlterForeignTableSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'addColumn':
      const addCol = change.desiredValue;
      return `ALTER FOREIGN TABLE ${objectKey} ADD COLUMN ${ident(addCol.name)} ${addCol.dataType};`;
      
    case 'dropColumn':
      return `ALTER FOREIGN TABLE ${objectKey} DROP COLUMN ${ident(change.desiredValue)};`;
      
    case 'alterColumn':
      const alterCol = change.desiredValue;
      return `ALTER FOREIGN TABLE ${objectKey} ALTER COLUMN ${ident(alterCol.name)} SET DATA TYPE ${alterCol.dataType};`;
      
    case 'options':
      const opts = change.desiredValue || {};
      const optStr = Object.entries(opts).map(([k, v]) => `${k} '${v}'`).join(', ');
      return `ALTER FOREIGN TABLE ${objectKey} OPTIONS (${optStr});`;
      
    case 'owner':
      return `ALTER FOREIGN TABLE ${objectKey} OWNER TO ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported foreign table property: ${property}`;
  }
}

function generateAlterTextSearchConfigSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'addMapping':
      const mapping = change.desiredValue;
      return `ALTER TEXT SEARCH CONFIGURATION ${objectKey} ADD MAPPING FOR ${Array.isArray(mapping.tokens) ? mapping.tokens.join(', ') : mapping.tokens} WITH ${Array.isArray(mapping.dictionaries) ? mapping.dictionaries.join(', ') : mapping.dictionaries};`;
      
    case 'dropMapping':
      return `ALTER TEXT SEARCH CONFIGURATION ${objectKey} DROP MAPPING ${Array.isArray(change.desiredValue) ? change.desiredValue.join(', ') : change.desiredValue};`;
      
    case 'alterMapping':
      const alterMapping = change.desiredValue;
      return `ALTER TEXT SEARCH CONFIGURATION ${objectKey} ALTER MAPPING FOR ${Array.isArray(alterMapping.tokens) ? alterMapping.tokens.join(', ') : alterMapping.tokens} WITH ${Array.isArray(alterMapping.dictionaries) ? alterMapping.dictionaries.join(', ') : alterMapping.dictionaries};`;
      
    case 'owner':
      return `ALTER TEXT SEARCH CONFIGURATION ${objectKey} OWNER TO ${ident(change.desiredValue)};`;
      
    case 'schema':
      return `ALTER TEXT SEARCH CONFIGURATION ${objectKey} SET SCHEMA ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported text search config property: ${property}`;
  }
}

function generateAlterTextSearchDictSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'options':
      const opts = change.desiredValue || {};
      const optStr = Object.entries(opts).map(([k, v]) => `${k} = '${v}'`).join(', ');
      return `ALTER TEXT SEARCH DICTIONARY ${objectKey} (${optStr});`;
      
    case 'owner':
      return `ALTER TEXT SEARCH DICTIONARY ${objectKey} OWNER TO ${ident(change.desiredValue)};`;
      
    case 'schema':
      return `ALTER TEXT SEARCH DICTIONARY ${objectKey} SET SCHEMA ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported text search dict property: ${property}`;
  }
}

function generateAlterOperatorFamilySql(change) {
  const objectKey = change.objectKey;
  const accessMethod = change.before?.accessMethod || 'btree';
  const property = change.property;
  
  switch (property) {
    case 'addOperator':
      const addOp = change.desiredValue;
      return `ALTER OPERATOR FAMILY ${objectKey} USING ${accessMethod} ADD OPERATOR ${addOp.number} ${addOp.name}${addOp.forType ? ` FOR ORDER BY ${addOp.forType}` : ''};`;
      
    case 'dropOperator':
      const dropOp = change.desiredValue;
      return `ALTER OPERATOR FAMILY ${objectKey} USING ${accessMethod} DROP OPERATOR ${dropOp.number} ${dropOp.name};`;
      
    case 'addFunction':
      const addFn = change.desiredValue;
      return `ALTER OPERATOR FAMILY ${objectKey} USING ${accessMethod} ADD FUNCTION ${addFn.number} ${addFn.name}${addFn.forType ? ` FOR ORDER BY ${addFn.forType}` : ''};`;
      
    case 'dropFunction':
      const dropFn = change.desiredValue;
      return `ALTER OPERATOR FAMILY ${objectKey} USING ${accessMethod} DROP FUNCTION ${dropFn.number} ${dropFn.name};`;
      
    case 'owner':
      return `ALTER OPERATOR FAMILY ${objectKey} USING ${accessMethod} OWNER TO ${ident(change.desiredValue)};`;
    case 'schema':
      return `ALTER OPERATOR FAMILY ${objectKey} USING ${accessMethod} SET SCHEMA ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported operator family property: ${property}`;
  }
}

function generateAlterPublicationSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'addTable':
      const addTables = Array.isArray(change.desiredValue) ? change.desiredValue : [change.desiredValue];
      const addTableStrs = addTables.map(t => {
        let tableRef = t.schema ? `${ident(t.schema)}.${ident(t.name)}` : ident(t.name);
        if (t.columns) tableRef += ` (${t.columns.map(c => ident(c)).join(', ')})`;
        return tableRef;
      });
      return `ALTER PUBLICATION ${ident(objectKey)} ADD TABLE ${addTableStrs.join(', ')};`;
      
    case 'dropTable':
      const dropTables = Array.isArray(change.desiredValue) ? change.desiredValue : [change.desiredValue];
      const dropTableStrs = dropTables.map(t => t.schema ? `${ident(t.schema)}.${ident(t.name)}` : ident(t.name));
      return `ALTER PUBLICATION ${ident(objectKey)} DROP TABLE ${dropTableStrs.join(', ')};`;
      
    case 'setTable':
      const setTables = Array.isArray(change.desiredValue) ? change.desiredValue : [change.desiredValue];
      const setTableStrs = setTables.map(t => t.schema ? `${ident(t.schema)}.${ident(t.name)}` : ident(t.name));
      return `ALTER PUBLICATION ${ident(objectKey)} SET TABLE ${setTableStrs.join(', ')};`;
      
    case 'publish':
      return `ALTER PUBLICATION ${ident(objectKey)} SET (publish = '${change.desiredValue}');`;
      
    case 'owner':
      return `ALTER PUBLICATION ${ident(objectKey)} OWNER TO ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported publication property: ${property}`;
  }
}

function generateAlterSubscriptionSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'connection':
    case 'conninfo':
      return `ALTER SUBSCRIPTION ${ident(objectKey)} CONNECTION '${change.desiredValue}';`;
      
    case 'setPublication':
    case 'publications':
      const pubs = Array.isArray(change.desiredValue) ? change.desiredValue.join(', ') : change.desiredValue;
      return `ALTER SUBSCRIPTION ${ident(objectKey)} SET PUBLICATION ${pubs};`;
      
    case 'addPublication':
      const addPubs = Array.isArray(change.desiredValue) ? change.desiredValue.join(', ') : change.desiredValue;
      return `ALTER SUBSCRIPTION ${ident(objectKey)} ADD PUBLICATION ${addPubs};`;
      
    case 'dropPublication':
      const dropPubs = Array.isArray(change.desiredValue) ? change.desiredValue.join(', ') : change.desiredValue;
      return `ALTER SUBSCRIPTION ${ident(objectKey)} DROP PUBLICATION ${dropPubs};`;
      
    case 'refresh':
      return `ALTER SUBSCRIPTION ${ident(objectKey)} REFRESH PUBLICATION;`;
      
    case 'enable':
      return `ALTER SUBSCRIPTION ${ident(objectKey)} ENABLE;`;
      
    case 'disable':
      return `ALTER SUBSCRIPTION ${ident(objectKey)} DISABLE;`;
      
    case 'enabled':
      return `ALTER SUBSCRIPTION ${ident(objectKey)} ${change.desiredValue ? 'ENABLE' : 'DISABLE'};`;
      
    case 'syncCommit':
      const syncVal = typeof change.desiredValue === 'boolean' ? (change.desiredValue ? "'on'" : "'off'") : `'${change.desiredValue}'`;
      return `ALTER SUBSCRIPTION ${ident(objectKey)} SET (synchronous_commit = ${syncVal});`;
      
    case 'binaryTransfer':
      return `ALTER SUBSCRIPTION ${ident(objectKey)} SET (binary = ${change.desiredValue ? 'true' : 'false'});`;
      
    case 'streaming':
      const streamVal = typeof change.desiredValue === 'boolean' ? (change.desiredValue ? "'on'" : "'off'") : `'${change.desiredValue}'`;
      return `ALTER SUBSCRIPTION ${ident(objectKey)} SET (streaming = ${streamVal});`;
      
    case 'twoPhase':
      return `ALTER SUBSCRIPTION ${ident(objectKey)} SET (two_phase = ${change.desiredValue ? 'true' : 'false'});`;
      
    case 'disableOnError':
      return `ALTER SUBSCRIPTION ${ident(objectKey)} SET (disable_on_error = ${change.desiredValue ? 'true' : 'false'});`;
      
    case 'origin':
      const originVal = typeof change.desiredValue === 'boolean' ? (change.desiredValue ? "'any'" : "'none'") : `'${change.desiredValue}'`;
      return `ALTER SUBSCRIPTION ${ident(objectKey)} SET (origin = ${originVal});`;
      
    case 'slotName':
      const slotVal = change.desiredValue ? `'${change.desiredValue}'` : 'NONE';
      return `ALTER SUBSCRIPTION ${ident(objectKey)} SET (slot_name = ${slotVal});`;
      
    case 'set':
      const opts = change.desiredValue || {};
      const optStr = Object.entries(opts).map(([k, v]) => `${k} = ${typeof v === 'boolean' ? v : `'${v}'`}`).join(', ');
      return `ALTER SUBSCRIPTION ${ident(objectKey)} SET (${optStr});`;
      
    case 'owner':
      return `ALTER SUBSCRIPTION ${ident(objectKey)} OWNER TO ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported subscription property: ${property}`;
  }
}

function generateAlterStatisticsSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'setColumns':
      return `ALTER STATISTICS ${objectKey} SET STATISTICS ${change.desiredValue};`;
      
    case 'columns':
    case 'setStatistics':
    case 'statisticsTarget':
      return `ALTER STATISTICS ${objectKey} SET STATISTICS ${change.desiredValue};`;
      
    case 'owner':
      return `ALTER STATISTICS ${objectKey} OWNER TO ${ident(change.desiredValue)};`;
      
    case 'schema':
      return `ALTER STATISTICS ${objectKey} SET SCHEMA ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported statistics property: ${property}`;
  }
}

function generateAlterCollationSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'schema':
      return `ALTER COLLATION ${objectKey} SET SCHEMA ${ident(change.desiredValue)};`;
      
    case 'owner':
      return `ALTER COLLATION ${objectKey} OWNER TO ${ident(change.desiredValue)};`;
      
    case 'refresh':
      return `ALTER COLLATION ${objectKey} REFRESH VERSION;`;
      
    default:
      return `-- Unsupported collation property: ${property}`;
  }
}

function generateAlterLanguageSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'owner':
      return `ALTER LANGUAGE ${ident(objectKey)} OWNER TO ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported language property: ${property}`;
  }
}

function parseStorageParams(p) {
  if (!p) return {};
  if (typeof p === 'object') return p;
  if (typeof p === 'string') {
    const obj = {};
    p.split(',').forEach(item => {
      const eq = item.indexOf('=');
      if (eq !== -1) {
        const k = item.substring(0, eq).trim();
        const v = item.substring(eq + 1).trim();
        obj[k] = isNaN(v) ? v : Number(v);
      }
    });
    return obj;
  }
  return {};
}

function generateAlterMaterializedViewSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  
  switch (property) {
    case 'storageOptions':
    case 'storageParameters':
    case 'storageSettings': {
      const currentParams = parseStorageParams(change.currentValue);
      const desiredParams = parseStorageParams(change.desiredValue);
      const toSet = [];
      const toReset = [];

      for (const [k, v] of Object.entries(desiredParams)) {
        if (currentParams[k] !== v) {
          toSet.push(`${k}=${v}`);
        }
      }
      for (const k of Object.keys(currentParams)) {
        if (desiredParams[k] === undefined) {
          toReset.push(k);
        }
      }

      const stmts = [];
      if (toSet.length > 0) {
        stmts.push(`ALTER MATERIALIZED VIEW ${objectKey} SET (${toSet.join(', ')});`);
      }
      if (toReset.length > 0) {
        stmts.push(`ALTER MATERIALIZED VIEW ${objectKey} RESET (${toReset.join(', ')});`);
      }
      return stmts.join('\n');
    }

    case 'owner':
      return `ALTER MATERIALIZED VIEW ${objectKey} OWNER TO ${ident(change.desiredValue)};`;
      
    case 'schema':
      return `ALTER MATERIALIZED VIEW ${objectKey} SET SCHEMA ${ident(change.desiredValue)};`;
      
    case 'tablespace':
      return `ALTER MATERIALIZED VIEW ${objectKey} SET TABLESPACE ${ident(change.desiredValue)};`;
      
    case 'renameColumn':
      return `ALTER MATERIALIZED VIEW ${objectKey} RENAME COLUMN ${ident(change.currentValue)} TO ${ident(change.desiredValue)};`;
      
    case 'rename':
      return `ALTER MATERIALIZED VIEW ${objectKey} RENAME TO ${ident(change.desiredValue)};`;
      
    default:
      return `-- Unsupported access method property: ${property}`;
  }
}

function generateAlterOperatorSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  const leftType = change.before?.leftType || change.after?.leftType || 'NONE';
  const rightType = change.before?.rightType || change.after?.rightType || 'NONE';
  
  switch (property) {
    case 'owner':
      return `ALTER OPERATOR ${objectKey} (${leftType}, ${rightType}) OWNER TO ${ident(change.desiredValue)};`;
    case 'schema':
      return `ALTER OPERATOR ${objectKey} (${leftType}, ${rightType}) SET SCHEMA ${ident(change.desiredValue)};`;
    case 'storageParameters':
    case 'storageOptions':
    case 'storageSettings': {
      const currentParams = change.currentValue || {};
      const desiredParams = change.desiredValue || {};
      const toSet = [];
      const toReset = [];
      
      for (const [k, v] of Object.entries(desiredParams)) {
        if (currentParams[k] !== v) {
          toSet.push(`${k}=${v}`);
        }
      }
      for (const k of Object.keys(currentParams)) {
        if (desiredParams[k] === undefined) {
          toReset.push(k);
        }
      }
      
      const stmts = [];
      if (toSet.length > 0) {
        stmts.push(`ALTER OPERATOR ${objectKey} (${leftType}, ${rightType}) SET (${toSet.join(', ')});`);
      }
      if (toReset.length > 0) {
        stmts.push(`ALTER OPERATOR ${objectKey} (${leftType}, ${rightType}) RESET (${toReset.join(', ')});`);
      }
      return stmts.join('\n');
    }
    default:
      return `-- Unsupported operator property: ${property}`;
  }
}

function generateAlterOperatorClassSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  const accessMethod = change.after?.accessMethod || change.before?.accessMethod;
  
  if (!accessMethod) {
    return `-- Cannot generate operator class ALTER without access method`;
  }
  
  switch (property) {
    case 'owner':
      return `ALTER OPERATOR CLASS ${objectKey} USING ${accessMethod} OWNER TO ${ident(change.desiredValue)};`;
    case 'schema':
      return `ALTER OPERATOR CLASS ${objectKey} USING ${accessMethod} SET SCHEMA ${ident(change.desiredValue)};`;
    default:
      return `-- Unsupported operator class property: ${property}`;
  }
}

function generateAlterAccessMethodSql(change) {
  const objectKey = change.objectKey;
  const property = change.property;
  return `-- PostgreSQL does not support altering access method handler: ${objectKey} (${property})`;
}

function generateAlterEventTriggerSql(change) {
  const name = change.objectKey;
  const property = change.property;
  const value = change.desiredValue;

  switch (property) {
    case 'enabled':
      const isEnabled = value === true || value === 'ENABLED' || change.after?.enabled === true || change.after?.enabled === 'ENABLED';
      return `ALTER EVENT TRIGGER ${ident(name)} ${isEnabled ? 'ENABLE' : 'DISABLE'};`;
    case 'owner':
      return `ALTER EVENT TRIGGER ${ident(name)} OWNER TO ${ident(value)};`;
    default:
      return `-- Unsupported event trigger property: ${property}`;
  }
}

function generateGenericCommentSql(change) {
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
    conversion: 'CONVERSION',
    language: 'LANGUAGE'
  };

  const typeKeyword = typeMap[change.objectType];
  if (!typeKeyword) return `-- Unsupported comment for ${change.objectType}`;

  const name = change.objectKey;
  const val = change.desiredValue;

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

function generateGenericPrivilegesSql(change) {
  const typeMap = {
    table: 'TABLE',
    column: 'COLUMN',
    view: 'VIEW',
    materializedView: 'MATERIALIZED VIEW',
    function: 'FUNCTION',
    procedure: 'PROCEDURE',
    sequence: 'SEQUENCE',
    type: 'TYPE',
    schema: 'SCHEMA',
    foreignTable: 'FOREIGN TABLE',
    foreignDataWrapper: 'FOREIGN DATA WRAPPER',
    foreignServer: 'SERVER',
    publication: 'PUBLICATION',
    subscription: 'SUBSCRIPTION',
    textSearchConfig: 'TEXT SEARCH CONFIGURATION',
    textSearchDict: 'TEXT SEARCH DICTIONARY',
    conversion: 'CONVERSION',
    language: 'LANGUAGE'
  };

  const typeKeyword = typeMap[change.objectType];
  if (!typeKeyword) return `-- Unsupported privileges for ${change.objectType}`;

  const name = change.objectKey;
  let formattedName = name;
  if (change.objectType === 'column') {
    const parts = name.split('.');
    const col = parts.pop();
    const tab = parts.join('.');
    formattedName = `${tab}.${ident(col)}`;
  } else if (change.objectType === 'function' || change.objectType === 'procedure') {
    const fn = change.after || change.before || {};
    const argTypesList = fn.argumentTypes || fn.arguments || [];
    const argsStr = Array.isArray(argTypesList) ? argTypesList.join(', ') : '';
    formattedName = `${name}(${argsStr})`;
  }

  const stmts = [];
  stmts.push(`REVOKE ALL ON ${typeKeyword} ${formattedName} FROM PUBLIC;`);

  const privileges = change.desiredValue || [];
  if (Array.isArray(privileges)) {
    for (const g of privileges) {
      let grantSql = `GRANT ${g.privilege} ON ${typeKeyword} ${formattedName} TO ${ident(g.grantee)}`;
      if (g.isGrantable) grantSql += ' WITH GRANT OPTION';
      stmts.push(grantSql + ';');
    }
  }
  return stmts.join('\n');
}

function generateAlterExtensionSql(change) {
  const name = change.objectKey;
  const property = change.property;
  const value = change.desiredValue;

  switch (property) {
    case 'version':
      return `ALTER EXTENSION ${ident(name)} UPDATE TO '${escapeString(value)}';`;
    case 'schema':
      return `ALTER EXTENSION ${ident(name)} SET SCHEMA ${ident(value)};`;
    default:
      return `-- Unsupported extension property: ${property}`;
  }
}


