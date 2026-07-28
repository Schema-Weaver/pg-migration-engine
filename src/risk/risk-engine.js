/**
 * Schema Weaver Migration Engine - Risk Engine
 * https://schemaweaver.vivekmind.com/
 */
import { checkDestructive } from './destructive-checker.js';
import { checkDataLoss } from './data-loss-checker.js';
import { checkLockRisk } from './lock-analyzer.js';
import { checkCompatibility } from './compatibility-checker.js';
import { computeOverallRisk } from './recommendations.js';

export class RiskEngine {
  /**
   * @param {import('../types/changes.js').SchemaChange[]} changes
   * @param {number} [pgVersion]
   * @returns {import('../types/risk.js').RiskAssessment}
   */
  assess(changes, pgVersion = 150000) {
    const findings = [];

    for (const change of changes) {
      findings.push(...checkDestructive(change));
      findings.push(...checkDataLoss(change));
      findings.push(...checkLockRisk(change));
      findings.push(...checkCompatibility(change, pgVersion));
    }

    return computeOverallRisk(findings);
  }
}
