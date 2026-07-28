/**
 * Schema Weaver Migration Engine - Schema Introspection - Translator
 * https://schemaweaver.vivekmind.com/
 */

const PG_VERSION_19 = 190000;

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

const PG_TYPE_MAP = {
  'oid8': 'oid8',
};

const PG19_ONLY_TYPES = new Set(['oid8', 'regdatabase']);

function isValidTypeForVersion(typeName, pgVersion) {
  if (PG19_ONLY_TYPES.has(typeName) && pgVersion < PG_VERSION_19) {
    return false;
  }
  return true;
}

export function translateTypes(types, schemaMap) {
  const typeMap = {};
  const enums = types?.enums || [];
  const composites = types?.composites || [];
  const domains = types?.domains || [];
  const ranges = types?.ranges || [];
  const multiranges = types?.multiranges || [];

  for (const e of enums) {
    const key = `${e.schema}.${e.name}`;
    const obj = {
      schema: e.schema,
      name: e.name,
      kind: 'ENUM',
      type: 'enum',
      category: 'enum',
      values: e.enum_values || e.enumValues || [],
      enumValues: e.enum_values || e.enumValues || [],
      labels: e.enum_values || e.enumValues || [],
      owner: e.owner,
      comment: e.comment || undefined,
      privileges: parseACL(e.privileges),
      arrayType: e.array_type || undefined,
    };
    typeMap[key] = obj;
    if (schemaMap[e.schema]) {
      schemaMap[e.schema].enums.push(obj);
      schemaMap[e.schema].types.push(obj);
    }
  }

  for (const c of composites) {
    const key = `${c.schema}.${c.name}`;
    const obj = {
      schema: c.schema,
      name: c.name,
      kind: 'COMPOSITE',
      type: 'composite',
      category: 'composite',
      attributes: c.attributes || [],
      columns: c.attributes || [],
      fields: c.attributes || [],
      owner: c.owner,
      comment: c.comment || undefined,
    };
    typeMap[key] = obj;
    if (schemaMap[c.schema]) {
      schemaMap[c.schema].compositeTypes.push(obj);
      schemaMap[c.schema].types.push(obj);
    }
  }

  for (const d of domains) {
    const key = `${d.schema}.${d.name}`;
    const obj = {
      schema: d.schema,
      name: d.name,
      kind: 'DOMAIN',
      type: 'domain',
      category: 'domain',
      baseType: d.base_type,
      baseTypeSchema: d.base_type_schema || undefined,
      notNull: Boolean(d.not_null),
      defaultValue: d.default_value || undefined,
      checkConstraint: d.check_constraint || undefined,
      owner: d.owner,
      comment: d.comment || undefined,
      collation: d.collation || undefined,
      privileges: parseACL(d.privileges),
      isValidated: d.is_validated ?? true,
      typmod: d.typmod ?? undefined,
      length: d.length ?? undefined,
    };
    typeMap[key] = obj;
    if (schemaMap[d.schema]) {
      schemaMap[d.schema].domainTypes.push(obj);
      schemaMap[d.schema].types.push(obj);
    }
  }

  for (const r of ranges) {
    const key = `${r.schema}.${r.name}`;
    const obj = {
      schema: r.schema,
      name: r.name,
      kind: 'RANGE',
      type: 'range',
      category: 'range',
      subtype: r.subtype,
      subtypeSchema: r.subtype_schema || undefined,
      multirangeType: r.multirange_type || undefined,
      collation: r.collation || undefined,
      subtypeOpclass: r.subtype_opclass || undefined,
      subtypeDiff: r.subtype_diff || undefined,
      canonicalFunction: r.canonical_function || undefined,
      owner: r.owner,
      comment: r.comment || undefined,
      privileges: parseACL(r.privileges),
    };
    typeMap[key] = obj;
    if (schemaMap[r.schema]) {
      schemaMap[r.schema].rangeTypes.push(obj);
      schemaMap[r.schema].types.push(obj);
    }
  }

  for (const m of multiranges) {
    const key = `${m.schema}.${m.name}`;
    const obj = {
      schema: m.schema,
      name: m.name,
      kind: 'MULTIRANGE',
      type: 'multirange',
      category: 'multirange',
      rangeType: m.range_type,
      owner: m.owner,
      comment: m.comment || undefined,
    };
    typeMap[key] = obj;
    if (schemaMap[m.schema]) {
      schemaMap[m.schema].multirangeTypes.push(obj);
      schemaMap[m.schema].types.push(obj);
    }
  }

  return typeMap;
}

export function isValidPgType(typeName, pgVersion) {
  return isValidTypeForVersion(typeName, pgVersion || 150000);
}

export function getPgTypeMap() {
  return { ...PG_TYPE_MAP };
}

export function getPg19OnlyTypes() {
  return new Set(PG19_ONLY_TYPES);
}
