/**
 * Schema Weaver Migration Engine - Risk Engine
 * https://schemaweaver.vivekmind.com/
 */
export function checkDestructive(change) {
  const findings = [];
  if (change.type === 'DROP' && change.objectType === 'TABLE') {
    findings.push({
      category: 'destructive',
      severity: 'critical',
      changeId: change.id,
      message: `Dropping table ${change.objectKey} will permanently delete all data`,
      recommendation: 'Consider renaming instead of dropping, or ensure data is backed up',
      autoFixable: false,
    });
  }
  if (change.type === 'DROP_COLUMN') {
    findings.push({
      category: 'destructive',
      severity: 'high',
      changeId: change.id,
      message: `Dropping column ${change.name} from ${change.objectKey} will delete data`,
      recommendation: 'Stage the column drop: deprecate -> stop using -> drop',
      autoFixable: false,
    });
  }
  if (change.type === 'DROP' && change.objectType === 'VIEW') {
    findings.push({
      category: 'destructive',
      severity: 'medium',
      changeId: change.id,
      message: `Dropping view ${change.objectKey}`,
      recommendation: 'Ensure no applications depend on this view',
      autoFixable: false,
    });
  }
  return findings;
}
