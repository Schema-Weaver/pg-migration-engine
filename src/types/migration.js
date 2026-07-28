/**
 * Schema Weaver Migration Engine - Type Definitions
 * https://schemaweaver.vivekmind.com/
 */

/**
 * @typedef {'pre_check'|'advisory_lock'|'pre_structural'|'structural'|'index'|'data_migration'|'constraint'|'post_structural'|'policy'|'grant'|'cleanup'|'snapshot'|'verify'} StepType
 */

/**
 * @typedef {Object} MigrationStep
 * @property {string} id
 * @property {StepType} type
 * @property {number} phase
 * @property {string} description
 * @property {string} sql
 * @property {boolean} isTransactional
 * @property {number} [timeoutMs]
 * @property {number} [retryCount]
 * @property {import('./risk.js').RiskLevel} riskLevel
 * @property {string[]} dependencies
 * @property {number} [estimatedRows]
 */

/**
 * @typedef {Object} MigrationResult
 * @property {boolean} success
 * @property {string} migrationId
 * @property {number} stepsCompleted
 * @property {number} stepsTotal
 * @property {number} durationMs
 * @property {number} changesApplied
 * @property {MigrationWarning[]} warnings
 * @property {MigrationError[]} errors
 * @property {string} [snapshotBefore]
 * @property {string} [snapshotAfter]
 */

/**
 * @typedef {Object} MigrationWarning
 * @property {string} step
 * @property {string} message
 * @property {import('./risk.js').RiskLevel} severity
 */

/**
 * @typedef {Object} MigrationError
 * @property {string} step
 * @property {string} message
 * @property {string} sql
 * @property {string} [code]
 * @property {boolean} isRecoverable
 * @property {string} [recoveryHint]
 */

export {};
