/**
 * Schema Weaver Migration Engine - Schema Introspection - Translator
 * https://schemaweaver.vivekmind.com/
 */

export function translateFunctions(functions, schemaMap) {
  const functionMap = {};

  for (const f of functions) {
    const argTypesStr = f.argument_types || '';
    const key = `${f.schema}.${f.name}(${argTypesStr})`;

    const argTypes = argTypesStr ? argTypesStr.split(',').map(s => s.trim()).filter(Boolean) : [];
    const argNames = f.argument_names || [];
    const argDefaults = f.argument_defaults ? (Array.isArray(f.argument_defaults) ? f.argument_defaults : [f.argument_defaults]) : [];

    const argsList = argTypes.map((type, idx) => ({
      name: argNames[idx] || undefined,
      type,
      default: argDefaults[idx] || (f.argument_defaults && idx === argTypes.length - 1 ? f.argument_defaults : undefined)
    }));

    const volatility = (f.volatility || 'VOLATILE').toLowerCase();
    const security = (f.security || 'INVOKER').toLowerCase();
    const securityDefiner = security === 'definer';

    const funcObj = {
      schema: f.schema,
      name: f.name,
      argumentTypes: argTypes,
      argumentNames: argNames,
      argumentDefaults: f.argument_defaults || undefined,
      arguments: argsList,
      parameters: argsList,
      argumentModes: f.argument_modes || [],
      returnType: f.return_type,
      returnSet: Boolean(f.return_set),
      language: (f.language || '').toLowerCase(),
      source: f.source,
      precompiledBody: f.precompiled_body || undefined,
      volatility,
      volatile: volatility,
      isStrict: Boolean(f.is_strict),
      security,
      securityDefiner,
      parallel: (f.parallel || 'UNSAFE').toLowerCase(),
      isLeakproof: Boolean(f.is_leakproof),
      cost: f.cost,
      rows: f.rows,
      kind: f.kind || 'FUNCTION',
      owner: f.owner,
      comment: f.comment || undefined,
    };

    functionMap[key] = funcObj;

    if (schemaMap[f.schema]) {
      if (f.kind === 'AGGREGATE') {
        schemaMap[f.schema].aggregates.push(funcObj);
      } else if (f.kind === 'PROCEDURE') {
        schemaMap[f.schema].procedures.push(funcObj);
      } else {
        schemaMap[f.schema].functions.push(funcObj);
      }
    }
  }

  return functionMap;
}
