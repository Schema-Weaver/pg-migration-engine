/**
 * Schema Weaver Migration Engine - Risk Engine
 * https://schemaweaver.vivekmind.com/
 */
export function checkLockRisk(change) {
  const findings = [];
  if (change.type === 'ADD_INDEX' && !change.sql?.includes('CONCURRENTLY')) {
    findings.push({
      category: 'lock_risk',
      severity: 'medium',
      changeId: change.id,
      message: `Creating index without CONCURRENTLY will lock ${change.objectKey} for writes`,
      recommendation: 'Use CREATE INDEX CONCURRENTLY for zero-downtime index creation',
      safeAlternative: change.sql?.replace('CREATE INDEX', 'CREATE INDEX CONCURRENTLY'),
      autoFixable: true,
    });
  }
  if (change.type === 'ADD_CONSTRAINT' && change.after?.type === 'FOREIGN_KEY' && !change.sql?.includes('NOT VALID')) {
    findings.push({
      category: 'lock_risk',
      severity: 'medium',
      changeId: change.id,
      message: `Adding FK constraint directly will scan and lock the table`,
      recommendation: 'Add constraint NOT VALID first, then VALIDATE',
      autoFixable: true,
    });
  }
  if (change.type === 'ALTER_COLUMN' && change.before?.isNullable !== change.after?.isNullable && !change.after?.isNullable) {
    findings.push({
      category: 'lock_risk',
      severity: 'medium',
      changeId: change.id,
      message: `Setting NOT NULL directly will lock the table for a full scan`,
      recommendation: 'Use 3-step pattern: ADD CHECK NOT NULL NOT VALID -> VALIDATE -> SET NOT NULL',
      autoFixable: true,
    });
  }
  return findings;
}
