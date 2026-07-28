/**
 * Schema Weaver Migration Engine - Risk Engine
 * https://schemaweaver.vivekmind.com/
 */
export function checkCompatibility(change, pgVersion) {
  const findings = [];
  if (pgVersion < 150000 && change.after?.nullsNotDistinct) {
    findings.push({
      category: 'compatibility',
      severity: 'high',
      changeId: change.id,
      message: 'NULLS NOT DISTINCT requires PostgreSQL 15+',
      recommendation: 'Remove NULLS NOT DISTINCT or upgrade PostgreSQL',
      autoFixable: false,
    });
  }
  if (pgVersion < 180000 && change.after?.generatedStorage === 'VIRTUAL') {
    findings.push({
      category: 'compatibility',
      severity: 'high',
      changeId: change.id,
      message: 'VIRTUAL generated columns require PostgreSQL 18+',
      recommendation: 'Use STORED generated columns or upgrade PostgreSQL',
      autoFixable: true,
    });
  }
  return findings;
}
