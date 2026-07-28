/**
 * Schema Weaver Migration Engine - Schema Introspection - Translator
 * https://schemaweaver.vivekmind.com/
 */

export function translateTriggers(triggers, tableMap, schemaMap) {
  const triggerMap = {};

  for (const t of triggers) {
    const tableKey = `${t.table_schema || t.schema}.${t.table_name}`;
    const key = `${t.schema}.${t.table_name}.${t.name}`;

    const timing = (t.timing || 'BEFORE').toLowerCase();
    const events = (t.events || []).map(e => typeof e === 'string' ? e.toLowerCase() : e);
    const funcName = t.function_name || (t.function_call ? t.function_call.split('(')[0].split('.').pop() : undefined);

    const trigObj = {
      schema: t.schema,
      name: t.name,
      table: tableKey,
      tableName: t.table_name,
      tableSchema: t.table_schema || t.schema,
      timing,
      when: timing,
      events,
      eventManipulations: (t.events || []).map(e => typeof e === 'string' ? e.toUpperCase() : e),
      level: (t.level || 'ROW').toLowerCase(),
      isForEachRow: t.is_for_each_row !== false,
      function: funcName || t.function_call,
      functionName: funcName,
      functionCall: t.function_call,
      whenCondition: t.when_condition || undefined,
      enabled: t.enabled || 'O',
      isConstraint: Boolean(t.is_constraint),
      isDeferrable: Boolean(t.is_deferrable),
      isDeferred: Boolean(t.is_deferred),
      updateOfColumns: t.update_of_columns || [],
      oldTableName: t.old_table_name || undefined,
      newTableName: t.new_table_name || undefined,
      comment: t.comment || undefined,
    };

    triggerMap[key] = trigObj;

    if (tableMap[tableKey]) {
      tableMap[tableKey].triggers.push(trigObj);
    }
    if (schemaMap[t.schema]) {
      schemaMap[t.schema].triggers.push(trigObj);
    }
  }

  return triggerMap;
}
