/**
 * Schema Weaver Migration Engine - DDL Generator
 * https://schemaweaver.vivekmind.com/
 */

/** @const {number} PG version number for PostgreSQL 19 */
export const PG_VERSION_19 = 190000;

/** @const {number} PG version number for PostgreSQL 18 */
export const PG_VERSION_18 = 180000;

/** @const {number} PG version number for PostgreSQL 17 */
export const PG_VERSION_17 = 170000;

/** @const {number} PG version number for PostgreSQL 16 */
export const PG_VERSION_16 = 160000;

/** @const {number} PG version number for PostgreSQL 15 */
export const PG_VERSION_15 = 150000;

/**
 * @param {number} [pgVersion]
 * @returns {boolean}
 */
export function supportsPg19Features(pgVersion) {
  return (pgVersion || 15) >= PG_VERSION_19;
}

/**
 * @param {number} [pgVersion]
 * @returns {boolean}
 */
export function supportsPg18Features(pgVersion) {
  return (pgVersion || 15) >= PG_VERSION_18;
}

/**
 * @param {number} [pgVersion]
 * @returns {boolean}
 */
export function supportsPg17Features(pgVersion) {
  return (pgVersion || 15) >= PG_VERSION_17;
}

/**
 * @param {number} [pgVersion]
 * @returns {boolean}
 */
export function supportsPg16Features(pgVersion) {
  return (pgVersion || 15) >= PG_VERSION_16;
}

/**
 * @param {number} [pgVersion]
 * @returns {boolean}
 */
export function supportsPg15Features(pgVersion) {
  return (pgVersion || 15) >= PG_VERSION_15;
}

/**
 * DDL types that are NEVER transactional regardless of PG version.
 */
const NEVER_TRANSACTIONAL_DDL = [
  'CREATE_INDEX_CONCURRENTLY',
  'DROP_INDEX_CONCURRENTLY',
  'REINDEX_CONCURRENTLY',
  'VACUUM',
  'CLUSTER',
  'CREATE_DATABASE',
  'DROP_DATABASE',
];

/**
 * DDL types that are NEVER transactional on specific PG versions.
 * null means "never transactional" — no version restriction.
 */
const VERSION_GATED_NON_TX = {
  ALTER_TYPE_ADD_VALUE: { minVersion: 0, maxVersion: 119999 }, // Not TX before PG12
  DETACH_PARTITION_CONCURRENTLY: null, // Never TX (PG17+ feature)
};

/**
 * Determine if a DDL statement type can run inside a transaction
 * for the given PostgreSQL server version.
 *
 * @param {string} ddlType - DDL strategy/type identifier
 * @param {number} [pgVersionNum] - Server version as number (e.g. 140000 for PG14)
 * @returns {boolean} true if the DDL can run inside a transaction
 */
export function isDDLTransactionalInPG(ddlType, pgVersionNum) {
  if (NEVER_TRANSACTIONAL_DDL.includes(ddlType)) {
    return false;
  }

  const gate = VERSION_GATED_NON_TX[ddlType];
  if (gate !== undefined) {
    if (gate === null) return false;
    const v = pgVersionNum || 140000;
    if (v >= gate.minVersion && v <= gate.maxVersion) return false;
  }

  return true;
}

/**
 * Check if a DDL statement type has version-dependent transactional behavior.
 *
 * @param {string} ddlType - DDL strategy/type identifier
 * @returns {boolean}
 */
export function isDDLVersionGated(ddlType) {
  return VERSION_GATED_NON_TX[ddlType] !== undefined;
}

/**
 * Get the PG version from which a DDL type becomes transactional.
 *
 * @param {string} ddlType - DDL strategy/type identifier
 * @returns {number|null} PG version number, or null if never transactional
 */
export function getTransactionalSinceVersion(ddlType) {
  if (NEVER_TRANSACTIONAL_DDL.includes(ddlType)) return null;
  const gate = VERSION_GATED_NON_TX[ddlType];
  if (gate === null) return null;
  if (gate) return gate.maxVersion + 1;
  return 0;
}

/**
 * DDL operations that require superuser privileges.
 * These will fail with SQLSTATE 42501 if executed by non-superuser.
 */
export const SUPERUSER_REQUIRED_DDL = [
  'CREATE_EXTENSION_UNTRUSTED',
  'CREATE_FOREIGN_DATA_WRAPPER',
  'CREATE_FOREIGN_SERVER',
  'CREATE_EVENT_TRIGGER',
  'CREATE_TABLESPACE',
  'ALTER_SYSTEM',
  'CREATE_ACCESS_METHOD',
];

/**
 * Check if a DDL type requires superuser privileges.
 * 
 * @param {string} ddlType - DDL strategy/type identifier
 * @returns {boolean}
 */
export function requiresSuperuser(ddlType) {
  return SUPERUSER_REQUIRED_DDL.includes(ddlType);
}

/**
 * List of trusted extensions that can be created by non-superusers (PG16+).
 * Based on PostgreSQL's pg_available_extensions.trusted column.
 */
export const TRUSTED_EXTENSIONS = [
  'plpgsql',
  'btree_gist',
  'btree_gin',
  'citext',
  'hstore',
  'intarray',
  'ltree',
  'pg_trgm',
  'uuid-ossp',
  'fuzzystrmatch',
  'pg_stat_statements',
  'postgres_fdw',
  'dblink',
];

/**
 * Check if an extension is trusted (can be created by non-superuser).
 * 
 * @param {string} extName - Extension name
 * @param {number} pgVersion - PostgreSQL version number
 * @returns {boolean}
 */
export function isExtensionTrusted(extName, pgVersion) {
  // Before PG16, most extensions require superuser
  // The trusted column was added in PG16
  if (pgVersion < PG_VERSION_16) {
    return false;
  }
  
  return TRUSTED_EXTENSIONS.some(trusted => 
    extName.toLowerCase() === trusted.toLowerCase()
  );
}

/**
 * Get security warnings for a DDL operation.
 * 
 * @param {object} step - Migration step
 * @param {number} pgVersion - PostgreSQL version number
 * @returns {Array<{code: string, message: string, severity: string}>}
 */
export function getSecurityWarnings(step, pgVersion = 140000) {
  const warnings = [];
  
  // Check for superuser-required operations
  if (requiresSuperuser(step.ddlStrategy)) {
    warnings.push({
      code: 'SUPERUSER_REQUIRED',
      message: `Step "${step.id}" requires superuser privileges. ` +
        `This will fail if executed by a non-superuser role.`,
      severity: 'high',
    });
  }
  
  // Check for extension creation
  if (step.objectType === 'extension' && step.after?.name) {
    const extName = step.after.name;
    const isTrusted = isExtensionTrusted(extName, pgVersion);
    
    if (!isTrusted) {
      warnings.push({
        code: 'EXTENSION_REQUIRES_SUPERUSER',
        message: `Extension "${extName}" requires superuser to install. ` +
          `PG16+: Run as superuser to check pg_available_extensions.trusted status.`,
        severity: 'medium',
      });
    } else if (pgVersion < PG_VERSION_16) {
      warnings.push({
        code: 'EXTENSION_TRUSTED_ONLY_PG16',
        message: `Extension "${extName}" is trusted but requires PG16+ to install without superuser. ` +
          `Current version: ${Math.floor(pgVersion / 10000)}.`,
        severity: 'medium',
      });
    }
  }
  
  // Check for subscription with connection string (credential exposure)
  if (step.objectType === 'subscription') {
    const conn = step.after?.conninfo || step.after?.connectionString || step.after?.connection;
    if (conn && (conn.includes('password=') || conn.includes('@'))) {
      warnings.push({
        code: 'CREDENTIAL_IN_SUBSCRIPTION',
        message: `Subscription DDL contains connection string with potential credentials. ` +
          `Consider using .pgpass file instead. The password will be stored in pg_subscription.`,
        severity: 'medium',
      });
    }
  }
  
  // Check for foreign data wrapper/user mapping (credential exposure)
  if (step.objectType === 'userMapping') {
    const options = step.after?.options || {};
    if (options.password) {
      warnings.push({
        code: 'CREDENTIAL_IN_USER_MAPPING',
        message: `User mapping options contain password. ` +
          `Passwords in DDL are stored in pg_user_mapping.options.`,
        severity: 'medium',
      });
    }
  }
  
  return warnings;
}
