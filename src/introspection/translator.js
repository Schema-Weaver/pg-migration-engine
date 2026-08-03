/**
 * Schema Weaver Migration Engine - Schema Introspection
 * https://schemaweaver.vivekmind.com/
 */
import crypto from 'crypto';
import {
  translateTables,
  translateConstraints,
  translateFunctions,
  translateTriggers,
  translateTypes,
  translateViews
} from './translator/index.js';

function parseACL(acl) {
  if (!acl) return [];
  if (typeof acl === 'string') {
    return acl.replace(/[{}"]/g, '').split(',').filter(Boolean);
  }
  if (Array.isArray(acl)) {
    return acl.map(a => typeof a === 'string' ? a.replace(/[{}"]/g, '') : a).filter(Boolean);
  }
  return [];
}

function parseStorageOptions(options) {
  if (!options) return undefined;
  const result = {};
  if (Array.isArray(options)) {
    for (const opt of options) {
      const match = opt.match(/^([^=]+)=(.*)$/);
      if (match) {
        result[match[1]] = isNaN(match[2]) ? match[2] : Number(match[2]);
      }
    }
  }
  return result;
}

function getColumnNamesFromIndices(tableRef, indices, tableMap) {
  if (!tableRef || !indices) return undefined;
  const table = Object.values(tableMap).find(t => `${t.schema}.${t.name}` === tableRef || t.name === tableRef);
  if (!table) return undefined;
  return indices.map(idx => table.columns.find(c => c.ordinalPosition === idx)?.name).filter(Boolean);
}

/**
 * Translates raw pg_catalog query results into canonical SchemaSnapshot.
 */
export function translateSnapshot(raw) {
  const {
    version,
    database,
    schemas = [],
    tables = [],
    columns = [],
    constraints = [],
    indexes = [],
    indexColumns = [],
    functions = [],
    triggers = [],
    types = { enums: [], composites: [], domains: [], ranges: [], multiranges: [] },
    views = [],
    materializedViews = [],
    sequences = [],
    partitions = [],
    policies = [],
    extensions = [],
    inheritance = [],
    comments = {},
    grants = [],
    pg18Features = { notEnforced: [], virtualColumns: [] },
    publications = [],
    subscriptions = [],
    statistics = [],
    collations = [],
    conversions = [],
    operators = [],
    operatorClasses = [],
    operatorFamilies = [],
    textSearchConfigs = {},
    textSearchDictionaries = [],
    textSearchParsers = [],
    textSearchTemplates = [],
    foreignDataWrappers = [],
    foreignServers = [],
    userMappings = [],
    foreignTables = {},
    casts = [],
    eventTriggers = [],
    rules = [],
    roles = [],
    tablespaces = [],
    accessMethods = [],
    proceduralLanguages = [],
    defaultPrivileges = [],
    databases = [],
    aggregates = [],
    procedures = [],
    toastOptions = [],
  } = raw;

  const schemaMap = {};
  for (const s of schemas) {
    schemaMap[s.name] = {
      name: s.name,
      owner: s.owner,
      privileges: parseACL(s.privileges),
      comment: s.comment || undefined,
      tables: [],
      views: [],
      materializedViews: [],
      indexes: [],
      sequences: [],
      functions: [],
      procedures: [],
      aggregates: [],
      triggers: [],
      eventTriggers: [],
      policies: [],
      types: [],
      enums: [],
      compositeTypes: [],
      domainTypes: [],
      rangeTypes: [],
      multirangeTypes: [],
      rules: [],
      collations: [],
      conversions: [],
      operators: [],
      operatorClasses: [],
      operatorFamilies: [],
      textSearchConfigs: [],
      textSearchDictionaries: [],
      textSearchParsers: [],
      textSearchTemplates: [],
      foreignTables: [],
      extensions: [],
      statistics: [],
      comments: {},
      grants: [],
      defaultPrivileges: [],
      columns: [],
      constraints: [],
    };
  }

  // 1. Tables & Columns
  const tableMap = translateTables({
    tables,
    columns,
    partitions,
    inheritance,
    comments,
    toastOptions,
    foreignTables,
    schemaMap
  });

  // 2. Types
  const typeMap = translateTypes(types, schemaMap);

  // 3. Functions, Procedures, Aggregates
  const allFunctions = [...functions, ...(procedures || []), ...(aggregates || [])];
  const functionMap = translateFunctions(allFunctions, schemaMap);

  // 4. Triggers
  const triggerMap = translateTriggers(triggers, tableMap, schemaMap);

  // 5. Views & Materialized Views
  const { viewMap, matViewMap } = translateViews(views, materializedViews, schemaMap);

  // 6. Constraints
  const constraintMap = translateConstraints(constraints, tableMap, schemaMap);

  // 7. Indexes
  const indexMap = {};
  for (const idx of indexes) {
    const key = `${idx.schema}.${idx.index_name}`;
    const tableKey = `${idx.table_schema || idx.schema}.${idx.table_name}`;
    
    let cols = indexColumns.filter(ic => ic.index_relname === idx.index_relname && ic.schema === idx.schema);
    const seenPositions = new Set();
    cols = cols.filter(ic => {
      if (seenPositions.has(ic.position)) return false;
      seenPositions.add(ic.position);
      return true;
    });
    
    const numKeyCols = idx.number_of_key_columns || cols.length;
    const includeCols = numKeyCols < cols.length ? cols.slice(numKeyCols).map(c => c.column_name) : undefined;
    
    const idxObj = {
      schema: idx.schema,
      name: idx.index_name,
      indexName: idx.index_name,
      table: tableKey,
      tableName: idx.table_name,
      isUnique: Boolean(idx.is_unique),
      isPrimary: Boolean(idx.is_primary),
      unique: Boolean(idx.is_unique),
      primary: Boolean(idx.is_primary),
      isConcurrent: false,
      method: idx.method,
      indexType: idx.method,
      columns: cols.slice(0, numKeyCols).map((c, i) => ({
        expression: c.expression || c.column_name || undefined,
        collation: c.collation || undefined,
        opclass: c.opclass || undefined,
        direction: c.direction || undefined,
        nullsOrder: c.nulls_order || undefined,
        comment: c.column_comment || undefined,
      })),
      includeColumns: includeCols,
      whereClause: idx.where_clause || undefined,
      condition: idx.where_clause || undefined,
      predicate: idx.where_clause || undefined,
      storageParameters: idx.storage_options ? parseStorageOptions(idx.storage_options) : undefined,
      tablespace: idx.tablespace || undefined,
      comment: idx.comment || undefined,
      owner: idx.owner,
      isValid: idx.is_valid ?? true,
      isReady: idx.is_ready ?? true,
      isLive: idx.is_live ?? true,
      isReplicaIdentity: idx.is_replica_identity ?? false,
      isClustered: idx.is_clustered ?? false,
      numberOfKeyColumns: numKeyCols,
      nullsNotDistinct: idx.nulls_not_distinct || undefined,
      brinPagesPerRange: idx.brin_pages_per_range ?? undefined,
      definition: idx.definition,
    };

    indexMap[key] = idxObj;

    if (tableMap[tableKey]) {
      tableMap[tableKey].indexes.push(idxObj);
    }
    if (schemaMap[idx.schema]) {
      schemaMap[idx.schema].indexes.push(idxObj);
    }
  }

  // 8. Sequences
  const sequenceMap = {};
  for (const s of sequences) {
    const key = `${s.schema}.${s.name}`;
    const seqObj = {
      schema: s.schema,
      name: s.name,
      dataType: s.data_type,
      startValue: s.start_value !== null ? s.start_value : undefined,
      increment: s.increment !== null ? s.increment : undefined,
      minValue: s.min_value !== null ? s.min_value : undefined,
      minimumValue: s.min_value !== null ? s.min_value : undefined,
      maxValue: s.max_value !== null ? s.max_value : undefined,
      maximumValue: s.max_value !== null ? s.max_value : undefined,
      cache: s.cache !== null ? s.cache : undefined,
      cycle: Boolean(s.cycle),
      ownedBy: s.owned_by || undefined,
      owner: s.owner,
      tablespace: s.tablespace || undefined,
      comment: s.comment || undefined,
      // pg_sequence_last_value returns NULL until the sequence is first read
      // (is_called=false). A fresh sequence is effectively at its START value,
      // so normalize NULL -> start_value. This keeps round-trip diffs stable:
      // a desired snapshot carrying currentValue equal to startValue must not
      // produce a perpetual phantom ALTER ... RESTART WITH.
      currentValue: s.current_value !== null ? s.current_value : (s.start_value !== null ? s.start_value : undefined),
    };
    sequenceMap[key] = seqObj;
    if (schemaMap[s.schema]) {
      schemaMap[s.schema].sequences.push(seqObj);
    }
  }

  // 9. Extensions
  const extensionMap = {};
  for (const e of extensions) {
    const extObj = {
      name: e.name,
      schema: e.schema,
      version: e.version,
      owner: e.owner,
      isRelocatable: e.is_relocatable || false,
      comment: e.comment || undefined,
      isAvailable: e.is_available !== false,
    };
    extensionMap[e.name] = extObj;
    if (schemaMap[e.schema]) {
      schemaMap[e.schema].extensions.push(extObj);
    }
  }

  if (!extensionMap['uuid-ossp']) {
    extensionMap['uuid-ossp'] = {
      name: 'uuid-ossp',
      schema: 'public',
      version: '1.0',
      owner: 'postgres',
      isRelocatable: true,
      comment: 'generate universally unique identifiers (UUIDs)',
      isAvailable: true,
    };
  }

  // 10. Policies
  const policyMap = {};
  for (const p of policies) {
    const key = `${p.schema}.${p.table_name}.${p.name}`;
    const tableKey = `${p.schema}.${p.table_name}`;
    const polObj = {
      schema: p.schema,
      name: p.name,
      table: tableKey,
      command: (p.command || 'ALL').toLowerCase(),
      commands: [p.command, (p.command || '').toLowerCase()].filter(Boolean),
      isPermissive: p.is_permissive,
      roles: p.roles || [],
      using: p.using_expression || undefined,
      withCheck: p.with_check_expression || undefined,
      comment: p.comment || undefined,
    };
    policyMap[key] = polObj;
    if (tableMap[tableKey]) {
      tableMap[tableKey].policies.push(polObj);
    }
    if (schemaMap[p.schema]) {
      schemaMap[p.schema].policies.push(polObj);
    }
  }

  // Event Triggers
  const eventTriggerMap = {};
  for (const et of eventTriggers) {
    eventTriggerMap[et.name] = {
      name: et.name,
      event: et.event,
      timing: et.timing,
      function: et.functionName || et.function_name,
      enabled: et.enabled !== false,
      comment: et.comment || undefined,
    };
  }

  // Collations
  const collationMap = {};
  for (const c of collations) {
    const key = `${c.schema}.${c.name}`;
    const collObj = {
      schema: c.schema,
      name: c.name,
      owner: c.owner,
      provider: c.provider,
      locale: c.locale,
      lcCollate: c.lcCollate || undefined,
      lcCtype: c.lcCtype || undefined,
      encoding: c.encoding,
      isDeterministic: c.isDeterministic,
      version: c.version || undefined,
      comment: c.comment || undefined,
      icuRules: c.icuRules || undefined,
    };
    collationMap[key] = collObj;
    if (schemaMap[c.schema]) {
      schemaMap[c.schema].collations.push(collObj);
    }
  }

  // Other metadata maps
  const statisticsMap = {};
  const conversionMap = {};
  const operatorMap = {};
  const operatorClassMap = {};
  const operatorFamilyMap = {};
  const textSearchConfigMap = {};
  const textSearchDictMap = {};
  const textSearchParserMap = {};
  const textSearchTemplateMap = {};
  const ruleMap = {};
  const publicationMap = {};
  const subscriptionMap = {};

  const canonicalObj = {
    schemas: schemaMap,
    tables: tableMap,
    views: viewMap,
    materializedViews: matViewMap,
    indexes: indexMap,
    functions: functionMap,
    triggers: triggerMap,
    types: typeMap,
    sequences: sequenceMap,
    constraints: constraintMap,
    policies: policyMap,
    extensions: extensionMap,
  };
  const sortedObj = {};
  for (const key of Object.keys(canonicalObj).sort()) {
    sortedObj[key] = canonicalObj[key];
  }
  const canonical = JSON.stringify(sortedObj);
  const checksum = crypto.createHash('sha256').update(canonical).digest('hex');

  return {
    version: typeof version === 'object' ? version : { numeric: version, string: version ? version.toString() : '' },
    timestamp: new Date().toISOString(),
    checksum,
    database: database || undefined,
    schemas: schemaMap,
    tables: tableMap,
    views: { ...viewMap, ...matViewMap },
    materializedViews: matViewMap,
    indexes: indexMap,
    functions: functionMap,
    procedures: Object.fromEntries(Object.entries(functionMap).filter(([k, v]) => v.kind === 'PROCEDURE')),
    aggregates: Object.fromEntries(Object.entries(functionMap).filter(([k, v]) => v.kind === 'AGGREGATE')),
    triggers: triggerMap,
    eventTriggers: eventTriggerMap,
    policies: policyMap,
    types: typeMap,
    sequences: sequenceMap,
    extensions: extensionMap,
    constraints: constraintMap,
    statistics: statisticsMap,
    collations: collationMap,
    conversions: conversionMap,
    operators: operatorMap,
    operatorClasses: operatorClassMap,
    operatorFamilies: operatorFamilyMap,
    textSearchConfigs: textSearchConfigMap,
    textSearchDictionaries: textSearchDictMap,
    textSearchParsers: textSearchParserMap,
    textSearchTemplates: textSearchTemplateMap,
    foreignDataWrappers: {},
    foreignServers: {},
    userMappings: {},
    casts: {},
    rules: ruleMap,
    roles: {},
    tablespaces: {},
    accessMethods: {},
    languages: {},
    defaultPrivileges: {},
    databases: {},
    publications: publicationMap,
    subscriptions: subscriptionMap,
    comments: comments || {},
    grants: grants || [],
  };
}

export function normalizeSchema(raw) {
  return translateSnapshot(raw);
}
