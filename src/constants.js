/**
 * Schema Weaver Migration Engine - Core
 * https://schemaweaver.vivekmind.com/
 */

export const MIGRATION_STATUS = Object.freeze({
  COMPLETED: 'COMPLETED',
  PARTIALLY_APPLIED: 'PARTIALLY_APPLIED',
  FAILED: 'FAILED',
  DRY_RUN_SUCCESS: 'DRY_RUN_SUCCESS',
  DRY_RUN_FAILURE: 'DRY_RUN_FAILURE',
  RUNNING: 'RUNNING',
  PENDING: 'pending',
  NO_CHANGES: 'no_changes',
  BLOCKED: 'blocked',
});

export const DB_STATUS = Object.freeze({
  COMPLETED: 'completed',
  PARTIALLY_APPLIED: 'partially_applied',
  FAILED: 'failed',
  DRY_RUN_SUCCESS: 'dry_run_success',
  DRY_RUN_FAILURE: 'dry_run_failure',
  RUNNING: 'running',
  PENDING: 'pending',
  ROLLED_BACK: 'rolled_back',
});

export const RISK_LEVELS = Object.freeze({
  NONE: 'none',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

export const RISK_LEVEL_ORDER = ['none', 'low', 'medium', 'high', 'critical'];

export const EXECUTION_STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export const DROP_PHASES = Object.freeze({
  behavioral: 27,
  constraints: 28,
  indexes: 29,
  columns: 30,
  sequences: 31,
  structural: 32,
});

/**
 * Retry configuration for transient failures.
 * Following industry standards: max 3 retries, exponential backoff.
 */
export const RETRY_CONFIG = Object.freeze({
  MAX_RETRIES: 3,
  INITIAL_BACKOFF_MS: 1000,
  BACKOFF_MULTIPLIER: 2,
  MAX_BACKOFF_MS: 10000,
  
  TRANSIENT_SQLSTATES: Object.freeze(new Set([
    '40P01',
    '40001',
    '55P03',
    '08001',
    '08003',
    '08004',
    '08006',
    '08007',
    '57P01',
    '57P03',
    '55006',
  ])),
  
  PERMANENT_SQLSTATES: Object.freeze(new Set([
    '42601',
    '42P01',
    '42P07',
    '42P06',
    '42701',
    '42710',
    '42723',
    '42501',
    '23505',
    '23503',
    '23514',
    '23502',
    '53100',
    '53200',
    '54000',
  ])),
});

export function isValidRiskLevel(level) {
  return RISK_LEVEL_ORDER.includes(level);
}

export function normalizeRiskLevel(level) {
  if (!level) return 'none';
  const lower = level.toLowerCase();
  return isValidRiskLevel(lower) ? lower : 'high';
}

export function compareRiskLevels(a, b) {
  const idxA = RISK_LEVEL_ORDER.indexOf(a);
  const idxB = RISK_LEVEL_ORDER.indexOf(b);
  return idxA - idxB;
}

export function maxRiskLevel(levels) {
  if (!levels || levels.length === 0) return 'none';
  return levels.reduce((max, level) => {
    return compareRiskLevels(level, max) > 0 ? level : max;
  }, 'none');
}

export function mapExecutorStatusToDb(executorStatus) {
  const mapping = {
    'COMPLETED': 'completed',
    'PARTIALLY_APPLIED': 'partially_applied',
    'FAILED': 'failed',
    'DRY_RUN_SUCCESS': 'dry_run_success',
    'DRY_RUN_FAILURE': 'dry_run_failure',
    'RUNNING': 'running',
    'PENDING': 'pending',
    'completed': 'completed',
    'partially_applied': 'partially_applied',
    'failed': 'failed',
    'running': 'running',
    'pending': 'pending',
    'rolled_back': 'rolled_back',
  };
  return mapping[executorStatus] || 'failed';
}

/**
 * Compute backoff delay for retry attempts.
 * Uses exponential backoff: 1s → 2s → 4s → 8s (capped at max).
 * @param {number} attempt - Current attempt number (1-indexed)
 * @param {Object} options - Override defaults from RETRY_CONFIG
 * @returns {number} Backoff delay in milliseconds
 */
export function computeBackoff(attempt, options = {}) {
  const config = { ...RETRY_CONFIG, ...options };
  const backoff = config.INITIAL_BACKOFF_MS * Math.pow(config.BACKOFF_MULTIPLIER, attempt - 1);
  return Math.min(backoff, config.MAX_BACKOFF_MS);
}

/**
 * Check if a SQLSTATE code represents a transient (retryable) error.
 * @param {string} sqlState - 5-character PostgreSQL error code
 * @returns {boolean}
 */
export function isTransientError(sqlState) {
  if (!sqlState) return false;
  if (RETRY_CONFIG.TRANSIENT_SQLSTATES.has(sqlState)) return true;
  
  const prefix = sqlState.substring(0, 2);
  return prefix === '08' || prefix === '58';
}

/**
 * Check if a SQLSTATE code represents a permanent (non-retryable) error.
 * @param {string} sqlState - 5-character PostgreSQL error code
 * @returns {boolean}
 */
export function isPermanentError(sqlState) {
  if (!sqlState) return false;
  if (RETRY_CONFIG.PERMANENT_SQLSTATES.has(sqlState)) return true;
  
  const prefix = sqlState.substring(0, 2);
  return ['42', '23', '53', '54'].includes(prefix);
}
