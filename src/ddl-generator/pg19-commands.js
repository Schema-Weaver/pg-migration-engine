/**
 * Schema Weaver Migration Engine - DDL Generator - PostgreSQL 19 Commands
 * https://schemaweaver.vivekmind.com/
 * 
 * PG19-specific DDL commands:
 * - REPACK (replaces VACUUM FULL / CLUSTER)
 * - GRANTED BY in GRANT/REVOKE
 * - Property Graphs (stub - full support deferred to v2)
 */

import { supportsPg19Features } from './pg-version.js';

function ident(name) {
  if (!name) return '';
  if (typeof name !== 'string') name = String(name);
  if (name.includes('"') || name.includes(' ')) {
    return `"${name.replace(/"/g, '""')}"`;
  }
  return `"${name}"`;
}

function escapeString(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/'/g, "''");
}

/**
 * Generate REPACK command (PG19+)
 * Replaces VACUUM FULL and CLUSTER with unified command + CONCURRENTLY option
 * @param {object} change
 * @returns {string}
 */
export function generateRepackSql(change) {
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
  if (!supportsPg19Features(pgVersion)) {
    return `-- WARNING: REPACK requires PostgreSQL 19+. Falling back to VACUUM FULL.\nVACUUM FULL ${change.objectKey};`;
  }
  
  const obj = change.after || change.desired || {};
  const tableKey = change.objectKey || `${ident(obj.schema)}.${ident(obj.name)}`;
  const concurrently = obj.concurrently || obj.isConcurrent;
  
  if (concurrently) {
    return `REPACK ${tableKey} CONCURRENTLY;`;
  }
  return `REPACK ${tableKey};`;
}

/**
 * Generate GRANT with GRANTED BY clause (PG19+)
 * @param {object} change
 * @returns {string}
 */
export function generateGrantWithGrantedBySql(change) {
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
  const g = change.after || change.desired || {};
  const grantee = g.grantee || 'PUBLIC';
  const granteeRef = grantee.toUpperCase() === 'PUBLIC' ? 'PUBLIC' : ident(grantee);
  const grantedBy = g.grantedBy || g.grantor;
  
  let sql = `GRANT ${g.privilege || 'ALL'} ON ${g.objectType || 'TABLE'} ${ident(g.schema)}.${ident(g.object)} TO ${granteeRef}`;
  if (g.isGrantable || g.withGrantOption) sql += ' WITH GRANT OPTION';
  
  if (grantedBy && supportsPg19Features(pgVersion)) {
    sql += ` GRANTED BY ${ident(grantedBy)}`;
  } else if (grantedBy && !supportsPg19Features(pgVersion)) {
    sql += `; -- WARNING: GRANTED BY requires PostgreSQL 19+`;
    return sql;
  }
  
  return sql + ';';
}

/**
 * Generate REVOKE with GRANTED BY clause (PG19+)
 * @param {object} change
 * @returns {string}
 */
export function generateRevokeWithGrantedBySql(change) {
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
  const g = change.before || change.desired || {};
  const grantee = g.grantee || 'PUBLIC';
  const granteeRef = grantee.toUpperCase() === 'PUBLIC' ? 'PUBLIC' : ident(grantee);
  const grantedBy = g.grantedBy || g.grantor;
  
  let sql = `REVOKE ${g.privilege || 'ALL'} ON ${g.objectType || 'TABLE'} ${ident(g.schema)}.${ident(g.object)} FROM ${granteeRef}`;
  
  if (grantedBy && supportsPg19Features(pgVersion)) {
    sql += ` GRANTED BY ${ident(grantedBy)}`;
  } else if (grantedBy && !supportsPg19Features(pgVersion)) {
    sql += `; -- WARNING: GRANTED BY requires PostgreSQL 19+`;
    return sql;
  }
  
  return sql + ';';
}

/**
 * Generate CREATE PROPERTY GRAPH stub (PG19+)
 * FULL SUPPORT DEFERRED TO v2 - Property graphs require new system catalogs
 * @param {object} change
 * @returns {string}
 */
export function generateCreatePropertyGraphSql(change) {
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
  if (!supportsPg19Features(pgVersion)) {
    return `-- WARNING: CREATE PROPERTY GRAPH requires PostgreSQL 19+.`;
  }
  
  const graph = change.after || change.desired || {};
  const graphKey = graph.schema ? `${ident(graph.schema)}.${ident(graph.name)}` : ident(graph.name);
  
  return `-- Property Graph creation is a stub for v1.0.0\n-- Full support deferred to v2 (requires new system catalogs)\n-- CREATE PROPERTY GRAPH ${graphKey} ...;\n-- Property graphs store vertex/edge table mappings in pg_property_graph catalog`;
}

/**
 * Generate ALTER PROPERTY GRAPH stub (PG19+)
 * @param {object} change
 * @returns {string}
 */
export function generateAlterPropertyGraphSql(change) {
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
  if (!supportsPg19Features(pgVersion)) {
    return `-- WARNING: ALTER PROPERTY GRAPH requires PostgreSQL 19+.`;
  }
  
  const graphKey = change.objectKey;
  return `-- Property Graph alteration is a stub for v1.0.0\n-- Full support deferred to v2\n-- ALTER PROPERTY GRAPH ${graphKey} ...;`;
}

/**
 * Generate DROP PROPERTY GRAPH stub (PG19+)
 * @param {object} change
 * @returns {string}
 */
export function generateDropPropertyGraphSql(change) {
  const pgVersion = change.pgVersion || change.metadata?.pgVersion || 150000;
  if (!supportsPg19Features(pgVersion)) {
    return `-- WARNING: DROP PROPERTY GRAPH requires PostgreSQL 19+.`;
  }
  
  const graphKey = change.objectKey;
  return `DROP PROPERTY GRAPH ${graphKey};`;
}

/**
 * Check if property graph introspection should be skipped (PG19+)
 * Used by introspector to skip pg_property_graph catalog queries
 * @param {number} pgVersion
 * @returns {boolean}
 */
export function shouldSkipPropertyGraphIntrospection(pgVersion) {
  return supportsPg19Features(pgVersion);
}

/**
 * Get default TOAST compression for PG version
 * PG19+ defaults to lz4, earlier versions default to pglz
 * @param {number} pgVersion
 * @returns {string}
 */
export function getDefaultToastCompression(pgVersion) {
  if (pgVersion >= 190000) {
    return 'lz4';
  }
  return 'pglz';
}

/**
 * Get default index opclass for inet/cidr columns
 * PG19+ defaults to GiST, earlier versions allow btree_gist
 * @param {number} pgVersion
 * @param {string} dataType - 'inet' or 'cidr'
 * @returns {string}
 */
export function getDefaultInetCidrOpclass(pgVersion, dataType) {
  if (pgVersion >= 190000) {
    return 'gist';
  }
  return 'btree_gist';
}

/**
 * Check if btree_gist inet/cidr index is broken on PG19+
 * PG19 disallows btree_gist opclass for inet/cidr
 * @param {number} pgVersion
 * @param {string} indexMethod
 * @param {string} columnType
 * @returns {{isBroken: boolean, warning: string|null}}
 */
export function checkInetCidrIndexCompatibility(pgVersion, indexMethod, columnType) {
  if (pgVersion >= 190000 && 
      indexMethod?.toLowerCase() === 'gist' &&
      (columnType?.toLowerCase() === 'inet' || columnType?.toLowerCase() === 'cidr')) {
    return {
      isBroken: true,
      warning: `PG19+ changes default opclass for inet/cidr from btree_gist to GiST. The current index uses an incompatible opclass and may need conversion.`
    };
  }
  return { isBroken: false, warning: null };
}
