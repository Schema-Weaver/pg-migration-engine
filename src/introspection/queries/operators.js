/**
 * Schema Weaver Migration Engine - Schema Introspection - Catalog Queries
 * https://schemaweaver.vivekmind.com/
 */
const OPERATORS_QUERY = `
SELECT
  o.oid,
  n.nspname AS schema,
  o.oprname AS name,
  pg_catalog.pg_get_userbyid(o.oprowner) AS owner,
  o.oprkind AS kind,
  CASE WHEN o.oprleft = 0 THEN NULL ELSE format_type(o.oprleft, NULL) END AS left_type,
  CASE WHEN o.oprright = 0 THEN NULL ELSE format_type(o.oprright, NULL) END AS right_type,
  format_type(o.oprresult, NULL) AS result_type,
  o.oprcode::regproc::text AS proc,
  CASE WHEN o.oprcanhash THEN 'HASH' ELSE NULL END AS can_hash,
  CASE WHEN o.oprcanmerge THEN 'MERGE' ELSE NULL END AS can_merge,
  o.oprcom::regoper::text AS commutator,
  o.oprnegate::regoper::text AS negator,
  o.oprrest::regproc::text AS restrict_func,
  o.oprjoin::regproc::text AS join_func,
  pg_catalog.obj_description(o.oid, 'pg_operator') AS comment
FROM pg_catalog.pg_operator o
JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, o.oprname
`;

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryOperators(pool) {
  try {
    const result = await pool.query(OPERATORS_QUERY);
    
    return result.rows.map(row => ({
      schema: row.schema,
      name: row.name,
      owner: row.owner,
      kind: row.kind,
      left_type: row.left_type,
      right_type: row.right_type,
      result_type: row.result_type,
      proc: row.proc,
      can_hash: !!row.can_hash,
      can_merge: !!row.can_merge,
      commutator: row.commutator || undefined,
      negator: row.negator || undefined,
      restrict_function: row.restrict_func || undefined,
      join_function: row.join_func || undefined,
      comment: row.comment || undefined,
    }));
  } catch (error) {
    return [];
  }
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryOperatorFamilies(pool) {
  const OPERATOR_FAMILIES_QUERY = `
    SELECT
      of.oid,
      n.nspname AS schema,
      of.opfname AS name,
      pg_catalog.pg_get_userbyid(of.opfowner) AS owner,
      am.amname AS access_method
    FROM pg_catalog.pg_opfamily of
    JOIN pg_catalog.pg_namespace n ON n.oid = of.opfnamespace
    JOIN pg_catalog.pg_am am ON am.oid = of.opfmethod
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, of.opfname
  `;

  try {
    const result = await pool.query(OPERATOR_FAMILIES_QUERY);
    return result.rows;
  } catch (error) {
    return [];
  }
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
export async function queryOperatorClasses(pool) {
  const OPERATOR_CLASSES_QUERY = `
    SELECT
      oc.oid,
      n.nspname AS schema,
      oc.opcname AS name,
      pg_catalog.pg_get_userbyid(oc.opcowner) AS owner,
      of.opfname AS family,
      format_type(oc.opcintype, NULL) AS input_type,
      oc.opcdefault AS is_default,
      am.amname AS access_method,
      CASE WHEN oc.opckeytype = 0 THEN NULL ELSE format_type(oc.opckeytype, NULL) END AS storage_type,
      pg_catalog.obj_description(oc.oid, 'pg_opclass') AS comment
    FROM pg_catalog.pg_opclass oc
    JOIN pg_catalog.pg_namespace n ON n.oid = oc.opcnamespace
    JOIN pg_catalog.pg_opfamily of ON of.oid = oc.opcfamily
    JOIN pg_catalog.pg_am am ON am.oid = oc.opcmethod
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, oc.opcname
  `;

  const OPERATOR_CLASS_OPERATORS_QUERY = `
    SELECT
      n.nspname AS schema,
      oc.opcname AS opclass_name,
      ao.amopstrategy AS strategy,
      CASE WHEN o.oprleft = 0 THEN NULL ELSE format_type(o.oprleft, NULL) END AS left_type,
      CASE WHEN o.oprright = 0 THEN NULL ELSE format_type(o.oprright, NULL) END AS right_type,
      o.oprname AS operator_name
    FROM pg_catalog.pg_amop ao
    JOIN pg_catalog.pg_opclass oc ON oc.oid = ao.amopfamily
    JOIN pg_catalog.pg_namespace n ON n.oid = oc.opcnamespace
    JOIN pg_catalog.pg_operator o ON o.oid = ao.amopopr
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, oc.opcname, ao.amopstrategy
  `;

  const OPERATOR_CLASS_FUNCTIONS_QUERY = `
    SELECT
      n.nspname AS schema,
      oc.opcname AS opclass_name,
      ap.amprocnum AS support_num,
      p.proname AS function_name
    FROM pg_catalog.pg_amproc ap
    JOIN pg_catalog.pg_opclass oc ON oc.oid = ap.amprocfamily
    JOIN pg_catalog.pg_namespace n ON n.oid = oc.opcnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = ap.amproc
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY n.nspname, oc.opcname, ap.amprocnum
  `;

  try {
    const classesResult = await pool.query(OPERATOR_CLASSES_QUERY);
    let opsResult = { rows: [] };
    let funcsResult = { rows: [] };
    
    try {
      opsResult = await pool.query(OPERATOR_CLASS_OPERATORS_QUERY);
    } catch (e) {}
    
    try {
      funcsResult = await pool.query(OPERATOR_CLASS_FUNCTIONS_QUERY);
    } catch (e) {}

    const operatorsMap = {};
    for (const row of opsResult.rows) {
      const key = `${row.schema}.${row.opclass_name}`;
      if (!operatorsMap[key]) operatorsMap[key] = [];
      operatorsMap[key].push({
        strategy: row.strategy,
        name: row.operator_name,
        leftType: row.left_type,
        rightType: row.right_type,
      });
    }

    const functionsMap = {};
    for (const row of funcsResult.rows) {
      const key = `${row.schema}.${row.opclass_name}`;
      if (!functionsMap[key]) functionsMap[key] = [];
      functionsMap[key].push({
        num: row.support_num,
        name: row.function_name,
      });
    }

    return classesResult.rows.map(row => ({
      ...row,
      operators: operatorsMap[`${row.schema}.${row.name}`] || [],
      functions: functionsMap[`${row.schema}.${row.name}`] || [],
    }));
  } catch (error) {
    return [];
  }
}
