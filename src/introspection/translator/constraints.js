/**
 * Schema Weaver Migration Engine - Schema Introspection - Translator
 * https://schemaweaver.vivekmind.com/
 */

function getColNames(tableObj, indices) {
  if (!tableObj || !indices || !Array.isArray(indices)) return [];
  return indices.map(idx => tableObj.columns.find(col => col.ordinalPosition === idx)?.name).filter(Boolean);
}

export function translateConstraints(constraints, tableMap, schemaMap) {
  const constraintMap = {};

  for (const c of constraints) {
    const tableKey = `${c.schema}.${c.table_name}`;
    const key = `${c.schema}.${c.table_name}.${c.name}`;
    const refTableKey = c.referenced_schema && c.referenced_table ? `${c.referenced_schema}.${c.referenced_table}` : undefined;

    let rawType = c.type || c.constraint_type || '';
    if (rawType === 'p' || rawType === 'PRIMARY KEY' || rawType === 'PRIMARY_KEY') rawType = 'primary_key';
    if (rawType === 'f' || rawType === 'FOREIGN KEY' || rawType === 'FOREIGN_KEY') rawType = 'foreign_key';
    if (rawType === 'u' || rawType === 'UNIQUE') rawType = 'unique';
    if (rawType === 'c' || rawType === 'CHECK') rawType = 'check';
    if (rawType === 'x' || rawType === 'EXCLUSION') rawType = 'exclusion';

    const typeLower = rawType.toLowerCase();
    const tableObj = tableMap[tableKey];
    const refTableObj = refTableKey ? tableMap[refTableKey] : undefined;

    const cols = c.columns || getColNames(tableObj, c.column_indices);
    const refCols = c.referenced_columns || getColNames(refTableObj, c.foreign_column_indices);

    const conObj = {
      schema: c.schema,
      name: c.name,
      constraintName: c.name,
      table: tableKey,
      tableName: c.table_name,
      type: typeLower,
      constraintType: rawType.toUpperCase(),
      columns: cols,
      columnNames: cols,
      refTable: c.referenced_table || undefined,
      referencedTable: c.referenced_table || undefined,
      refSchema: c.referenced_schema || undefined,
      referencedSchema: c.referenced_schema || undefined,
      refColumns: refCols,
      referencedColumns: refCols,
      checkExpression: c.expression || undefined,
      onDelete: c.on_delete || c.onDelete || undefined,
      onUpdate: c.on_update || c.onUpdate || undefined,
      isDeferrable: Boolean(c.deferrable ?? c.condeferrable),
      deferrable: Boolean(c.deferrable ?? c.condeferrable),
      initiallyDeferred: Boolean(c.initially_deferred ?? c.condeferred),
      deferred: Boolean(c.initially_deferred ?? c.condeferred),
      matchType: c.match_type || undefined,
      isValidated: c.is_validated ?? true,
      definition: c.definition,
      comment: c.comment || undefined,
    };

    constraintMap[key] = conObj;

    if (tableMap[tableKey]) {
      tableMap[tableKey].constraints.push(conObj);
      if (typeLower === 'primary_key') {
        tableMap[tableKey].primaryKey = conObj;
      } else if (typeLower === 'foreign_key') {
        if (!tableMap[tableKey].foreignKeys) tableMap[tableKey].foreignKeys = [];
        tableMap[tableKey].foreignKeys.push(conObj);
      }
    }
    if (schemaMap[c.schema]) {
      schemaMap[c.schema].constraints.push(conObj);
    }
  }

  return constraintMap;
}
