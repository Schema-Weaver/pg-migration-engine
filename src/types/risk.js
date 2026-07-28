/**
 * Schema Weaver Migration Engine - Type Definitions
 * https://schemaweaver.vivekmind.com/
 */

/**
 * @typedef {'destructive'|'data_loss'|'lock_risk'|'performance'|'compatibility'|'behavioral'|'dependency_impact'|'data_validation'|'performance_impact'|'reversibility'} RiskCategory
 */

/**
 * @typedef {Object} RiskFinding
 * @property {RiskCategory} category
 * @property {RiskLevel} severity
 * @property {string} changeId
 * @property {string} message
 * @property {string} recommendation
 * @property {string} [safeAlternative]
 * @property {boolean} autoFixable
 */

/**
 * @typedef {Object} RiskAssessment
 * @property {RiskLevel} overallRisk
 * @property {RiskFinding[]} findings
 * @property {number} destructiveChanges
 * @property {number} dataLossChanges
 * @property {number} lockRiskChanges
 * @property {number} canAutoFix
 * @property {number} requiresReview
 * @property {'none'|'minimal'|'moderate'|'significant'} estimatedDowntime
 */

export {};
