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

export function translateViews(views, materializedViews, schemaMap) {
  const viewMap = {};
  const matViewMap = {};

  for (const v of views) {
    const key = `${v.schema}.${v.name}`;
    const relOptions = parseStorageOptions(v.rel_options) || {};
    const viewObj = {
      schema: v.schema,
      name: v.name,
      type: 'view',
      kind: 'VIEW',
      materialized: false,
      definition: v.definition,
      query: v.definition,
      owner: v.owner,
      checkOption: v.check_option || 'NONE',
      securityBarrier: relOptions.security_barrier === 'true' || relOptions.security_barrier === true || false,
      securityInvoker: relOptions.security_invoker === 'true' || relOptions.security_invoker === true || false,
      isRecursive: Boolean(v.is_recursive),
      columns: v.columns || [],
      privileges: v.privileges || undefined,
      comment: v.comment || undefined,
    };
    viewMap[key] = viewObj;

    if (schemaMap[v.schema]) {
      schemaMap[v.schema].views.push(viewObj);
    }
  }

  for (const v of materializedViews) {
    const key = `${v.schema}.${v.name}`;
    const matObj = {
      schema: v.schema,
      name: v.name,
      type: 'materialized',
      kind: 'MATERIALIZED_VIEW',
      materialized: true,
      definition: v.definition,
      query: v.definition,
      owner: v.owner,
      tablespace: v.tablespace || undefined,
      storageParameters: v.storage_options ? parseStorageOptions(v.storage_options) : undefined,
      isPopulated: v.is_populated !== false,
      withData: v.is_populated !== false,
      populated: v.is_populated !== false,
      columns: v.columns || [],
      privileges: v.privileges || undefined,
      comment: v.comment || undefined,
    };
    matViewMap[key] = matObj;

    if (schemaMap[v.schema]) {
      schemaMap[v.schema].materializedViews.push(matObj);
      schemaMap[v.schema].views.push(matObj);
    }
  }

  return { viewMap, matViewMap };
}
