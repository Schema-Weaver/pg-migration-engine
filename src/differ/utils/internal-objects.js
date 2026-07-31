/**
 * Schema Weaver Migration Engine - Engine-internal object detection
 * https://schemaweaver.vivekmind.com/
 *
 * The migration engine's own bookkeeping objects that live in the managed
 * database: migration_history / migration_execution_log and their
 * indexes/constraints, the migration_status enum, the transition-trigger
 * function/trigger, plus the core/synthetic extensions the introspector
 * always reports. Changes for these objects are filtered out of every diff
 * so a user's desired schema can never destroy the engine's own state, and
 * they are excluded from rename detection so a user object can never be
 * silently paired with an engine bookkeeping object.
 */

const INTERNAL_TABLE_NAMES = new Set(['migration_history', 'migration_execution_log']);
const INTERNAL_TYPE_NAMES = new Set(['migration_status']);
const INTERNAL_FUNCTION_NAMES = new Set(['validate_migration_transition']);
const INTERNAL_TRIGGER_KEYS = new Set(['public.migration_history.enforce_status_transition']);
const INTERNAL_EXTENSION_NAMES = new Set(['plpgsql', 'uuid-ossp']);

/**
 * @param {string} objectType - change.objectType (table, type, index, ...)
 * @param {string} key - object key (public.foo, public.migration_history.enforce_status_transition, ...)
 * @returns {boolean} true when the object is owned by the migration engine
 */
export function isInternalObjectKey(objectType, key) {
  if (!key) return false;
  const lowerKey = key.toLowerCase();
  const name = key.split('.').pop() || '';
  const lower = name.toLowerCase();

  switch (objectType) {
    case 'table':
      return INTERNAL_TABLE_NAMES.has(key) || INTERNAL_TABLE_NAMES.has(lower);
    case 'type':
    case 'domain':
    case 'enum':
      return INTERNAL_TYPE_NAMES.has(key) || INTERNAL_TYPE_NAMES.has(lower);
    case 'function':
    case 'procedure':
      return INTERNAL_FUNCTION_NAMES.has(lower.replace(/\(.*\)$/, ''));
    case 'trigger':
      return INTERNAL_TRIGGER_KEYS.has(key);
    case 'index':
      return lower === 'migration_history_pkey' ||
        lower === 'migration_execution_log_pkey' ||
        lower.startsWith('idx_migration_history_') ||
        lower.startsWith('idx_execution_log_');
    case 'constraint':
      return key.includes('.migration_history.') ||
        key.includes('.migration_execution_log.') ||
        lower.startsWith('migration_history_') ||
        lower.startsWith('migration_execution_log_');
    case 'extension':
      return INTERNAL_EXTENSION_NAMES.has(lower);
    default:
      return false;
  }
}

/**
 * @param {Object} change - SchemaChange object
 * @returns {boolean} true when the change targets an engine-internal object
 */
export function isEngineInternalChange(change) {
  return isInternalObjectKey(change?.objectType, change?.objectKey || change?.key);
}
