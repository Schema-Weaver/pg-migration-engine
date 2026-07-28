/**
 * Schema Weaver Migration Engine - Risk Engine
 * https://schemaweaver.vivekmind.com/
 */
export { RiskEngine } from './risk-engine.js';
export { checkDestructive } from './destructive-checker.js';
export { checkDataLoss } from './data-loss-checker.js';
export { checkLockRisk } from './lock-analyzer.js';
export { checkCompatibility } from './compatibility-checker.js';
export { computeOverallRisk } from './recommendations.js';
