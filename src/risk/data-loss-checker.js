/**
 * Schema Weaver Migration Engine - Risk Engine
 * https://schemaweaver.vivekmind.com/
 */
export function checkDataLoss(change) {
  const findings = [];
  if (change.type === 'ALTER_COLUMN' && change.before?.dataType !== change.after?.dataType) {
    const from = change.before.dataType;
    const to = change.after.dataType;
    if (isNarrowingCast(from, to)) {
      findings.push({
        category: 'data_loss',
        severity: 'high',
        changeId: change.id,
        message: `Narrowing type from ${from} to ${to} may truncate data`,
        recommendation: 'Add a CHECK constraint first to validate, then alter type',
        safeAlternative: `ALTER TABLE ${change.objectKey.split('.').slice(0, -1).join('.')} ALTER COLUMN ${change.after.name} TYPE ${to} USING ${change.after.name}::${to};`,
        autoFixable: true,
      });
    }
  }
  return findings;
}

function isNarrowingCast(from, to) {
  const narrowing = [
    ['bigint', 'integer'], ['bigint', 'smallint'], ['integer', 'smallint'],
    ['numeric', 'integer'], ['numeric', 'bigint'],
    ['character varying', 'character'], ['text', 'character varying'],
  ];
  return narrowing.some(([f, t]) => from.toLowerCase().includes(f) && to.toLowerCase().includes(t));
}
