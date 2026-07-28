/**
 * Schema Weaver Migration Engine - Risk Engine
 * https://schemaweaver.vivekmind.com/
 */
export function generateRecommendation(finding) {
  if (finding.safeAlternative) {
    return `${finding.recommendation}\nSafe alternative:\n${finding.safeAlternative}`;
  }
  return finding.recommendation;
}

/**
 * @param {import('../types/risk.js').RiskFinding[]} findings
 * @returns {import('../types/risk.js').RiskAssessment}
 */
export function computeOverallRisk(findings) {
  const destructive = findings.filter(f => f.category === 'destructive').length;
  const dataLoss = findings.filter(f => f.category === 'data_loss').length;
  const lockRisk = findings.filter(f => f.category === 'lock_risk').length;
  const canAutoFix = findings.filter(f => f.autoFixable).length;
  const requiresReview = findings.filter(f => !f.autoFixable).length;

  let overallRisk = 'none';
  if (findings.some(f => f.severity === 'critical')) overallRisk = 'critical';
  else if (findings.some(f => f.severity === 'high')) overallRisk = 'high';
  else if (findings.some(f => f.severity === 'medium')) overallRisk = 'medium';
  else if (findings.some(f => f.severity === 'low')) overallRisk = 'low';

  let estimatedDowntime = 'none';
  if (destructive > 0 || dataLoss > 0) estimatedDowntime = 'significant';
  else if (lockRisk > 2) estimatedDowntime = 'moderate';
  else if (lockRisk > 0) estimatedDowntime = 'minimal';

  return {
    overallRisk,
    findings,
    destructiveChanges: destructive,
    dataLossChanges: dataLoss,
    lockRiskChanges: lockRisk,
    canAutoFix,
    requiresReview,
    estimatedDowntime,
  };
}
