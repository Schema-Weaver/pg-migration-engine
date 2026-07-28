/**
 * Schema Weaver Migration Engine - Schema Differ - Utilities
 * https://schemaweaver.vivekmind.com/
 */

/**
 * Build a path for an object.
 * @param {Object} options
 * @param {string} [options.schema]
 * @param {string} [options.table]
 * @param {string} [options.name]
 * @param {string} [options.column]
 * @param {string} [options.objectType]
 * @returns {string}
 */
export function buildPath(options) {
  const parts = [];
  
  if (options.schema) {
    parts.push(options.schema);
  }
  
  if (options.table) {
    parts.push(options.table);
  } else if (options.parent) {
    parts.push(options.parent);
  }
  
  if (options.column) {
    parts.push(options.column);
  } else if (options.name) {
    parts.push(options.name);
  }
  
  return parts.join('.');
}

/**
 * Build a path for a table.
 * @param {string} schema
 * @param {string} tableName
 * @returns {string}
 */
export function tablePath(schema, tableName) {
  return `${schema}.${tableName}`;
}

/**
 * Build a path for a column.
 * @param {string} schema
 * @param {string} tableName
 * @param {string} columnName
 * @returns {string}
 */
export function columnPath(schema, tableName, columnName) {
  return `${schema}.${tableName}.${columnName}`;
}

/**
 * Build a path for an index.
 * @param {string} schema
 * @param {string} indexName
 * @returns {string}
 */
export function indexPath(schema, indexName) {
  return `${schema}.${indexName}`;
}

/**
 * Build a path for a constraint.
 * @param {string} schema
 * @param {string} constraintName
 * @returns {string}
 */
export function constraintPath(schema, constraintName) {
  return `${schema}.${constraintName}`;
}

/**
 * Build a path for a function.
 * @param {string} schema
 * @param {string} functionName
 * @param {string} [args]
 * @returns {string}
 */
export function functionPath(schema, functionName, args) {
  if (args) {
    return `${schema}.${functionName}(${args})`;
  }
  return `${schema}.${functionName}`;
}

/**
 * Build a path for a trigger.
 * @param {string} schema
 * @param {string} tableName
 * @param {string} triggerName
 * @returns {string}
 */
export function triggerPath(schema, tableName, triggerName) {
  return `${schema}.${tableName}.${triggerName}`;
}

/**
 * Build a path for a policy.
 * @param {string} schema
 * @param {string} tableName
 * @param {string} policyName
 * @returns {string}
 */
export function policyPath(schema, tableName, policyName) {
  return `${schema}.${tableName}.${policyName}`;
}

/**
 * Build a path for a view.
 * @param {string} schema
 * @param {string} viewName
 * @returns {string}
 */
export function viewPath(schema, viewName) {
  return `${schema}.${viewName}`;
}

/**
 * Build a path for a type.
 * @param {string} schema
 * @param {string} typeName
 * @returns {string}
 */
export function typePath(schema, typeName) {
  return `${schema}.${typeName}`;
}

/**
 * Build a path for a sequence.
 * @param {string} schema
 * @param {string} sequenceName
 * @returns {string}
 */
export function sequencePath(schema, sequenceName) {
  return `${schema}.${sequenceName}`;
}

/**
 * Parse a path into its components.
 * @param {string} path
 * @returns {{schema: string, name: string, parent: string|null}}
 */
export function parsePath(path) {
  const parts = path.split('.');
  
  if (parts.length === 1) {
    return { schema: null, name: parts[0], parent: null };
  }
  
  if (parts.length === 2) {
    return { schema: parts[0], name: parts[1], parent: null };
  }
  
  if (parts.length >= 3) {
    return { schema: parts[0], parent: `${parts[0]}.${parts[1]}`, name: parts[parts.length - 1] };
  }
  
  return { schema: null, name: path, parent: null };
}

/**
 * Get the parent path (table for column, schema for table, etc.)
 * @param {string} path
 * @returns {string|null}
 */
export function getParentPath(path) {
  const parts = path.split('.');
  
  if (parts.length <= 1) return null;
  
  return parts.slice(0, -1).join('.');
}

/**
 * Get the leaf name from a path.
 * @param {string} path
 * @returns {string}
 */
export function getLeafName(path) {
  const parts = path.split('.');
  return parts[parts.length - 1];
}

/**
 * Get the schema from a path.
 * @param {string} path
 * @returns {string|null}
 */
export function getSchema(path) {
  const parts = path.split('.');
  return parts.length >= 1 ? parts[0] : null;
}
