/**
 * Schema Weaver Migration Engine - Schema Introspection - Translator
 * https://schemaweaver.vivekmind.com/
 */

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

export function translateTables({
  tables,
  columns,
  partitions,
  inheritance,
  comments,
  toastOptions,
  foreignTables,
  schemaMap
}) {
  const tableMap = {};

  for (const t of tables) {
    const key = `${t.schema}.${t.name}`;
    const isForeignTable = t.kind === 'f';

    tableMap[key] = {
      schema: t.schema,
      name: t.name,
      owner: t.owner,
      isTemporary: t.persistence === 't',
      isUnlogged: t.persistence === 'u',
      isPartitioned: t.kind === 'p',
      isPartition: partitions.some(p => p.child_table === t.name && p.child_schema === t.schema),
      isForeignTable,
      partitionStrategy: t.partition_strategy ? ({ r: 'RANGE', l: 'LIST', h: 'HASH' }[t.partition_strategy] || t.partition_strategy) : undefined,
      partitionColumns: partitions.find(p => p.child_table === t.name && p.child_schema === t.schema)?.partition_columns || undefined,
      partitionParent: (() => {
        const p = partitions.find(p => p.child_table === t.name && p.child_schema === t.schema);
        return p ? `${p.parent_schema}.${p.parent_table}` : undefined;
      })(),
      partitionBound: t.partition_bound || undefined,
      partitionKeyDef: t.partition_key_def || undefined,
      isDefaultPartition: partitions.find(p => p.child_table === t.name && p.child_schema === t.schema)?.is_default || false,
      partitionExpression: partitions.find(p => p.child_table === t.name && p.child_schema === t.schema)?.partition_expression || undefined,
      inheritsFrom: inheritance.filter(i => i.child_table === t.name && i.child_schema === t.schema).map(i => `${i.parent_schema}.${i.parent_table}`),
      tablespace: t.tablespace || undefined,
      storageParameters: t.storage_options ? parseStorageOptions(t.storage_options) : undefined,
      replicaIdentity: (() => {
        if (t.replica_identity === 'd') return 'default';
        if (t.replica_identity === 'f') return 'full';
        if (t.replica_identity === 'n') return 'nothing';
        if (t.replica_identity === 'i' && t.replica_identity_index) return `index:${t.replica_identity_index}`;
        return undefined;
      })(),
      accessMethod: t.access_method || undefined,
      hasOids: t.has_oids || false,
      userCatalog: t.user_catalog_table || false,
      comment: comments[key] || undefined,
      privileges: [],
      rowLevelSecurity: Boolean(t.rls_enabled),
      forceRowLevelSecurity: Boolean(t.rls_forced),
      rlsEnabled: Boolean(t.rls_enabled),
      rlsForced: Boolean(t.rls_forced),
      columns: [],
      constraints: [],
      foreignKeys: [],
      primaryKey: undefined,
      indexes: [],
      triggers: [],
      policies: [],
      foreignServer: undefined,
      foreignOptions: undefined,
    };

    if (schemaMap[t.schema]) {
      if (isForeignTable) {
        schemaMap[t.schema].foreignTables.push(tableMap[key]);
      } else {
        schemaMap[t.schema].tables.push(tableMap[key]);
      }
    }
  }

  // Add foreign table details
  const ftTables = foreignTables?.tables || foreignTables || [];
  const ftColumnOptions = foreignTables?.columnOptions || [];

  for (const ft of ftTables) {
    const key = `${ft.schema}.${ft.name}`;
    if (tableMap[key]) {
      tableMap[key].foreignServer = ft.server_name;
      tableMap[key].foreignOptions = ft.options || {};
      tableMap[key].comment = ft.comment || tableMap[key].comment;
      tableMap[key].privileges = ft.privileges || tableMap[key].privileges;
    }
  }

  const ftColOptionsMap = {};
  for (const col of ftColumnOptions) {
    const key = `${col.schema}.${col.table_name}`;
    if (!ftColOptionsMap[key]) ftColOptionsMap[key] = {};
    ftColOptionsMap[key][col.column_name] = col.options;
  }

  // TOAST storage options
  for (const t of toastOptions || []) {
    const key = `${t.schema}.${t.table_name}`;
    if (tableMap[key]) {
      tableMap[key].toastStorageOptions = t.toast_storage_options ? parseStorageOptions(t.toast_storage_options) : undefined;
      tableMap[key].toastTableName = t.toast_table_name;
    }
  }

  // Columns translation
  for (const col of columns) {
    const key = `${col.schema}.${col.table_name}`;
    if (tableMap[key]) {
      const isGenerated = col.generated === 's' || col.generated === 'v';
      const isIdentity = col.identity === 'a' || col.identity === 'd';
      const cleanType = (col.data_type || '').split('.').pop();
      const colObj = {
        name: col.name,
        type: cleanType,
        dataType: cleanType,
        udtName: cleanType,
        rawType: col.data_type,
        ordinalPosition: col.ordinal_position,
        nullable: Boolean(col.is_nullable),
        isNullable: Boolean(col.is_nullable),
        notNull: !col.is_nullable,
        default: col.default_value || (isIdentity ? `GENERATED ${col.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY` : undefined),
        defaultValue: col.default_value || (isIdentity ? `GENERATED ${col.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY` : undefined),
        isGenerated,
        generatedExpression: isGenerated ? col.generated_expression : undefined,
        generatedStorage: col.generated === 'v' ? 'VIRTUAL' : col.generated === 's' ? 'STORED' : undefined,
        isIdentity,
        identityMode: col.identity === 'a' ? 'always' : col.identity === 'd' ? 'by_default' : (col.identity_mode ? col.identity_mode.toLowerCase() : undefined),
        identityGeneration: col.identity === 'a' ? 'always' : col.identity === 'd' ? 'by_default' : undefined,
        identityStart: col.identity_start ?? undefined,
        identityIncrement: col.identity_increment ?? undefined,
        identityMin: col.identity_min ?? undefined,
        identityMax: col.identity_max ?? undefined,
        identityCycle: col.identity_cycle ?? undefined,
        identityCache: col.identity_cache ?? undefined,
        collation: col.collation || undefined,
        storage: col.storage || undefined,
        comment: col.comment || undefined,
        statisticsTarget: col.statistics_target ?? undefined,
        compression: col.compression || undefined,
        inheritedCount: col.inherited_count ?? 0,
        isLocal: col.is_local ?? false,
        privileges: parseACL(col.privileges),
        isPrimaryKey: Boolean(col.is_primary_key),
        isUnique: Boolean(col.is_unique),
        length: col.length ?? undefined,
        arrayDimensions: col.array_dimensions ?? undefined,
        foreignOptions: col.foreign_options || (ftColOptionsMap[key]?.[col.name]) || undefined,
      };

      tableMap[key].columns.push(colObj);
      if (schemaMap[col.schema]) {
        schemaMap[col.schema].columns.push(colObj);
      }
    }
  }

  for (const table of Object.values(tableMap)) {
    table.columns.sort((a, b) => a.ordinalPosition - b.ordinalPosition);
  }

  return tableMap;
}
