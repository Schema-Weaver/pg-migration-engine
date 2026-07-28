/**
 * Schema Weaver Migration Engine - DDL Generator
 * https://schemaweaver.vivekmind.com/
 */

const qi = name => name === '*' ? name : '"' + name.replace(/"/g, '""') + '"';

export function generateSafePatterns(change) {
  const steps = [];
  const changeType = change.changeType;
  const objectType = change.objectType;
  const property = change.property;

  // NOT NULL 3-step pattern
  if (objectType === 'column' && property === 'isNullable' && change.currentValue === true && change.desiredValue === false) {
    const parts = change.objectKey.split('.');
    const col = parts.pop();
    const table = parts.join('.');
    const checkName = `${table.replace(/\./g, '_')}_${col}_not_null_chk`;
    steps.push({
      id: `safe_nn_${change.id || '1'}_1`,
      type: 'constraint',
      phase: 10,
      description: `Add CHECK NOT NULL (NOT VALID) for ${table}.${col}`,
      sql: `ALTER TABLE ${table} ADD CONSTRAINT ${checkName} CHECK (${col} IS NOT NULL) NOT VALID;`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [],
    });
    steps.push({
      id: `safe_nn_${change.id || '1'}_2`,
      type: 'constraint',
      phase: 13,
      description: `Validate CHECK constraint ${checkName}`,
      sql: `ALTER TABLE ${table} VALIDATE CONSTRAINT ${checkName};`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [steps[0].id],
    });
    steps.push({
      id: `safe_nn_${change.id || '1'}_3`,
      type: 'structural',
      phase: 11,
      description: `Convert CHECK to NOT NULL for ${table}.${col}`,
      sql: `ALTER TABLE ${table} ALTER COLUMN ${col} SET NOT NULL; ALTER TABLE ${table} DROP CONSTRAINT ${checkName};`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [steps[1].id],
    });
    return steps;
  }

  // FK NOT VALID pattern
  if (objectType === 'constraint' && (change.after?.constraintType === 'FOREIGN_KEY' || change.after?.type === 'FOREIGN_KEY')) {
    const con = change.after;
    steps.push({
      id: `safe_fk_${change.id || '1'}_1`,
      type: 'constraint',
      phase: 12,
      description: `Add FK ${con.name} NOT VALID`,
      sql: `ALTER TABLE ${con._tableKey || con.table} ADD CONSTRAINT ${con.name} FOREIGN KEY (${(con.columns || []).map(qi).join(', ')}) REFERENCES ${con.referencedTable}(${(con.referencedColumns || []).map(qi).join(', ')}) NOT VALID;`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [],
    });
    steps.push({
      id: `safe_fk_${change.id || '1'}_2`,
      type: 'constraint',
      phase: 13,
      description: `Validate FK ${con.name}`,
      sql: `ALTER TABLE ${con._tableKey || con.table} VALIDATE CONSTRAINT ${con.name};`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [steps[0].id],
    });
    return steps;
  }

  // CREATE INDEX CONCURRENTLY pattern
  if (objectType === 'index' && changeType === 'CREATE' && !change.after?.isConcurrent) {
    const idx = change.after;
    steps.push({
      id: `safe_idx_${change.id || '1'}_1`,
      type: 'index',
      phase: 23,
      description: `Create index ${idx.name} CONCURRENTLY`,
      sql: `CREATE INDEX CONCURRENTLY ${idx.name} ON ${idx.schema}.${idx.table}${idx.accessMethod && idx.accessMethod !== 'btree' ? ` USING ${idx.accessMethod}` : ''} (${(idx.columns || []).map(c => c.expression || qi(c.name)).join(', ')});`,
      isTransactional: false,
      riskLevel: 'low',
      dependencies: [],
    });
    return steps;
  }

  // Type change with USING clause
  if (objectType === 'column' && property === 'dataType') {
    const currentType = change.currentValue;
    const desiredType = change.desiredValue;
    if (currentType && desiredType && currentType !== desiredType) {
      const parts = change.objectKey.split('.');
      const col = parts.pop();
      const table = parts.join('.');
      steps.push({
        id: `safe_type_${change.id || '1'}_1`,
        type: 'structural',
        phase: 11,
        description: `Alter type of ${table}.${col} from ${currentType} to ${desiredType}`,
        sql: `ALTER TABLE ${table} ALTER COLUMN ${col} TYPE ${desiredType} USING ${col}::${desiredType};`,
        isTransactional: true,
        riskLevel: 'medium',
        dependencies: [],
      });
      return steps;
    }
  }

  // UNIQUE constraint with NOT VALID pattern (for large tables)
  if (objectType === 'constraint' && change.after?.constraintType === 'UNIQUE' && change.objectKey) {
    const con = change.after;
    const table = con._tableKey || con.table;
    const tempIdxName = `${con.name}_unique_build`;
    steps.push({
      id: `safe_uq_${change.id || '1'}_1`,
      type: 'index',
      phase: 23,
      description: `Create unique index CONCURRENTLY for ${con.name}`,
      sql: `CREATE UNIQUE INDEX CONCURRENTLY ${tempIdxName} ON ${table} (${(con.columns || []).map(qi).join(', ')});`,
      isTransactional: false,
      riskLevel: 'low',
      dependencies: [],
    });
    steps.push({
      id: `safe_uq_${change.id || '1'}_2`,
      type: 'constraint',
      phase: 24,
      description: `Add unique constraint using existing index`,
      sql: `ALTER TABLE ${table} ADD CONSTRAINT ${con.name} UNIQUE USING INDEX ${tempIdxName};`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [steps[0].id],
    });
    return steps;
  }

  // CHECK constraint with NOT VALID pattern (for validation safety)
  if (objectType === 'constraint' && change.after?.constraintType === 'CHECK' && change.objectKey) {
    const con = change.after;
    const table = con._tableKey || con.table;
    steps.push({
      id: `safe_chk_${change.id || '1'}_1`,
      type: 'constraint',
      phase: 10,
      description: `Add CHECK constraint ${con.name} NOT VALID`,
      sql: `ALTER TABLE ${table} ADD CONSTRAINT ${con.name} CHECK (${con.definition || con.check}) NOT VALID;`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [],
    });
    steps.push({
      id: `safe_chk_${change.id || '1'}_2`,
      type: 'constraint',
      phase: 13,
      description: `Validate CHECK constraint ${con.name}`,
      sql: `ALTER TABLE ${table} VALIDATE CONSTRAINT ${con.name};`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [steps[0].id],
    });
    return steps;
  }

  // Materialized view refresh after recreation
  if (objectType === 'materializedView' && (changeType === 'CREATE' || changeType?.includes('RECREATE'))) {
    const mv = change.after;
    if (mv.isWithData !== false) {
      steps.push({
        id: `safe_mv_${change.id || '1'}_1`,
        type: 'structural',
        phase: 15,
        description: `Refresh materialized view ${change.objectKey}`,
        sql: `REFRESH MATERIALIZED VIEW ${change.objectKey};`,
        isTransactional: true,
        riskLevel: 'low',
        dependencies: [],
      });
      return steps;
    }
  }

  // Multi-step impossible type change (add column -> copy -> drop old -> rename)
  if (objectType === 'column' && property === 'dataType' && change.changeType === 'IMPOSSIBLE_CAST') {
    const parts = change.objectKey.split('.');
    const col = parts.pop();
    const table = parts.join('.');
    const newColName = `${col}_new`;
    const oldColName = `${col}_old`;

    steps.push({
      id: `safe_imp_${change.id || '1'}_1`,
      type: 'structural',
      phase: 7,
      description: `Add temporary column ${newColName}`,
      sql: `ALTER TABLE ${table} ADD COLUMN ${newColName} ${change.desiredValue};`,
      isTransactional: true,
      riskLevel: 'medium',
      dependencies: [],
    });
    steps.push({
      id: `safe_imp_${change.id || '1'}_2`,
      type: 'structural',
      phase: 11,
      description: `Copy data with transformation`,
      sql: `UPDATE ${table} SET ${newColName} = ${change.usingExpression || `CAST(${col} AS ${change.desiredValue})`};`,
      isTransactional: true,
      riskLevel: 'medium',
      dependencies: [steps[0].id],
    });
    steps.push({
      id: `safe_imp_${change.id || '1'}_3`,
      type: 'structural',
      phase: 11,
      description: `Drop old column`,
      sql: `ALTER TABLE ${table} DROP COLUMN ${col};`,
      isTransactional: true,
      riskLevel: 'high',
      dependencies: [steps[1].id],
    });
    steps.push({
      id: `safe_imp_${change.id || '1'}_4`,
      type: 'structural',
      phase: 11,
      description: `Rename new column to original name`,
      sql: `ALTER TABLE ${table} RENAME COLUMN ${newColName} TO ${col};`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [steps[2].id],
    });
    return steps;
  }

  return null;
}
