/**
 * Schema Weaver Migration Engine - Migration Storage
 * https://schemaweaver.vivekmind.com/
 */

export class RollbackGenerator {
  constructor(options = {}) {
    this.pgVersion = options.pgVersion || null;
    this.pgVersionDetected = false;
  }

  /**
   * Detect PostgreSQL version from connection or set manually
   * @param {number} version - PostgreSQL major version (14, 15, 16, 17, 18)
   */
  setPgVersion(version) {
    this.pgVersion = version;
    this.pgVersionDetected = true;
  }

  /**
   * Get PostgreSQL version
   * @returns {number|null}
   */
  getPgVersion() {
    return this.pgVersion;
  }

  /**
   * Check if running on PostgreSQL 18+
   */
  isPg18Plus() {
    return this.pgVersion && this.pgVersion >= 18;
  }

  /**
   * Check if running on PostgreSQL 17+
   */
  isPg17Plus() {
    return this.pgVersion && this.pgVersion >= 17;
  }
  /**
   * Generate rollback SQL from a completed migration's history
   * @param {Object} migration - Migration history record
   * @returns {Array} Rollback SQL statements in reverse order
   */
  generateRollback(migration) {
    const diff = migration.schema_diff || migration.diff;
    const rollbackSteps = [];

    if (!diff?.changes) {
      return rollbackSteps;
    }

    const changes = [...diff.changes].reverse();

    for (const change of changes) {
      const undoSQL = this.generateUndoForChange(change);
      if (undoSQL) {
        const isNonTransactional = this.isNonTransactionalRollback(change, undoSQL);
        rollbackSteps.push({
          sql: undoSQL,
          originalChangeId: change.id,
          changeType: change.changeType,
          objectKey: change.objectKey || change.path,
          isTransactional: !isNonTransactional,
        });
      }
    }

    return rollbackSteps;
  }

  /**
   * Check if rollback step should be non-transactional
   */
  isNonTransactionalRollback(change, sql) {
    if (change.isConcurrent) return true;
    if (sql && sql.toUpperCase().includes('CONCURRENTLY')) return true;
    return false;
  }

  /**
   * Generate undo SQL for a single change
   * @param {Object} change
   * @returns {string|null}
   */
  generateUndoForChange(change) {
    const changeType = change.changeType;
    const objectType = change.objectType;
    const path = change.objectKey || change.path;
    const schema = change.schema;
    const name = change.name;

    switch (changeType) {
      case 'CREATE':
      case 'ADD':
        return this.generateUndoForCreate(change, objectType, path);

      case 'DROP':
      case 'REMOVE':
        return this.generateUndoForDrop(change, objectType, path);

      case 'ALTER':
        return this.generateUndoForAlter(change, objectType, path);

      case 'RENAME':
        return this.generateUndoForRename(change, path);

      case 'RECREATE':
      case 'REPLACE':
        return this.generateUndoForReplace(change, objectType, path);

      default:
        if (changeType?.startsWith('CREATE')) {
          return this.generateUndoForCreate(change, objectType, path);
        }
        if (changeType?.startsWith('DROP')) {
          return this.generateUndoForDrop(change, objectType, path);
        }
        if (changeType === 'ADD_ENUM_VALUES') {
          return `-- ⚠️ IMPOSSIBLE ROLLBACK: PostgreSQL does not support removing enum values. The value '${change.value || change.addedValues?.join(', ') || 'unknown'}' was added to ${path} and cannot be removed without recreating the entire enum type.`;
        }
        return `-- CANNOT AUTO-ROLLBACK: Unknown change type "${changeType}" for ${path}`;
    }
  }

  /**
   * Generate undo for CREATE operations
   */
  generateUndoForCreate(change, objectType, path) {
    switch (objectType) {
      case 'table':
        return `DROP TABLE IF EXISTS ${path} CASCADE;`;

      case 'index':
        if (change.isConcurrent) {
          return `DROP INDEX CONCURRENTLY IF EXISTS ${path};`;
        }
        return `DROP INDEX IF EXISTS ${path};`;

      case 'constraint':
        const conTable = change.after?.tableKey || change.schema;
        const conName = change.after?.name || change.name;
        return `ALTER TABLE ${conTable} DROP CONSTRAINT IF EXISTS ${conName};`;

      case 'view':
        return `DROP VIEW IF EXISTS ${path} CASCADE;`;

      case 'materializedView':
        return `DROP MATERIALIZED VIEW IF EXISTS ${path} CASCADE;`;

      case 'function':
      case 'procedure':
        const fnArgs = change.after?.argumentTypes 
          ? `(${change.after.argumentTypes.join(', ')})`
          : '';
        return `DROP ${objectType === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} IF EXISTS ${path}${fnArgs} CASCADE;`;

      case 'trigger':
        const trigTable = change.after?.tableName || change.after?.table;
        const trigName = change.after?.name || change.name;
        return `DROP TRIGGER IF EXISTS ${trigName} ON ${trigTable};`;

      case 'policy':
        const polTable = change.after?.table;
        const polName = change.after?.name || change.name;
        return `DROP POLICY IF EXISTS ${polName} ON ${polTable};`;

      case 'type':
        return `DROP TYPE IF EXISTS ${path} CASCADE;`;

      case 'sequence':
        return `DROP SEQUENCE IF EXISTS ${path} CASCADE;`;

      case 'schema':
        return `DROP SCHEMA IF EXISTS ${change.after?.name || change.name} CASCADE;`;

      case 'extension':
        return `DROP EXTENSION IF EXISTS ${change.after?.name || change.name} CASCADE;`;

      case 'rule':
        const ruleTable = change.after?.tableName || change.after?.table;
        const ruleName = change.after?.name || change.name;
        return `DROP RULE IF EXISTS ${ruleName} ON ${ruleTable};`;

      default:
        return `-- CANNOT AUTO-ROLLBACK: CREATE for object type "${objectType}" on ${path}`;
    }
  }

  /**
   * Generate undo for DROP operations
   */
  generateUndoForDrop(change, objectType, path) {
    const before = change.before;
    
    switch (objectType) {
      case 'table':
        return `-- ❌ CANNOT ROLLBACK: Table ${path} was dropped. Data cannot be recovered.`;

      case 'column':
        return `-- ❌ CANNOT FULLY ROLLBACK: Column ${path} was dropped. Data cannot be recovered.`;

      case 'constraint':
        if (before && before.constraintType) {
          return this.generateConstraintRecreation(change, before, path);
        }
        return `-- ⚠️ CANNOT ROLLBACK: Constraint ${path} was dropped. Original definition not available.`;

      case 'index':
        if (before && (before.definition || before.columns)) {
          return this.generateIndexRecreation(change, before, path);
        }
        return `-- ⚠️ CANNOT ROLLBACK: Index ${path} was dropped. Original definition not available.`;

      case 'view':
        if (before && before.definition) {
          return `CREATE OR REPLACE VIEW ${path} AS ${before.definition};`;
        }
        return `-- ⚠️ CANNOT ROLLBACK: View ${path} was dropped. Original definition not available.`;

      case 'materializedView':
        if (before && before.definition) {
          return `CREATE MATERIALIZED VIEW ${path} AS ${before.definition};`;
        }
        return `-- ⚠️ CANNOT ROLLBACK: Materialized view ${path} was dropped. Original definition not available.`;

      case 'function':
      case 'procedure':
        if (before && before.source) {
          const args = before.argumentTypes ? `(${before.argumentTypes.join(', ')})` : '';
          return `CREATE OR REPLACE ${objectType === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} ${path}${args} AS $$${before.source}$$;`;
        }
        return `-- ⚠️ CANNOT ROLLBACK: ${objectType} ${path} was dropped. Original definition not available.`;

      case 'trigger':
        if (before && before.function) {
          return this.generateTriggerRecreation(before, path);
        }
        return `-- ⚠️ CANNOT ROLLBACK: Trigger ${path} was dropped. Original definition not available.`;

      case 'policy':
        if (before && before.table) {
          return this.generatePolicyRecreation(before, path);
        }
        return `-- ⚠️ CANNOT ROLLBACK: Policy ${path} was dropped. Original definition not available.`;

      case 'sequence':
        if (before) {
          return this.generateSequenceRecreation(before, path);
        }
        return `-- ⚠️ CANNOT ROLLBACK: Sequence ${path} was dropped. Original definition not available.`;

      case 'type':
        if (before) {
          return this.generateTypeRecreation(before, path);
        }
        return `-- ⚠️ CANNOT ROLLBACK: Type ${path} was dropped. Original definition not available.`;

      case 'rule':
        if (before && before.definition) {
          return `${before.definition};`;
        }
        return `-- ⚠️ CANNOT ROLLBACK: Rule ${path} was dropped. Original definition not available.`;

      case 'partition':
        return this.generatePartitionDetachRollback(change, path);

      default:
        return `-- CANNOT AUTO-ROLLBACK: DROP for object type "${objectType}" on ${path}`;
    }
  }

  /**
   * Generate index recreation DDL for rollback
   */
  generateIndexRecreation(change, before, path) {
    if (before.definition) {
      return `${before.definition};`;
    }
    
    let sql = 'CREATE ';
    if (before.isUnique) sql += 'UNIQUE ';
    sql += 'INDEX ';
    
    sql += `${path} ON ${before.schema || change.schema}.${before.table}`;
    if (before.accessMethod && before.accessMethod !== 'btree') {
      sql += ` USING ${before.accessMethod}`;
    }
    
    if (before.columns && before.columns.length > 0) {
      sql += ` (${before.columns.map(c => {
        let col = c.name || c;
        if (c.collation) col += ` COLLATE ${c.collation}`;
        if (c.opclass) col += ` ${c.opclass}`;
        if (c.isAscending === false) col += ' DESC';
        return col;
      }).join(', ')})`;
    }
    
    if (before.where) {
      sql += ` WHERE ${before.where}`;
    }
    
    return sql + ';';
  }

  /**
   * Generate constraint recreation DDL for rollback
   */
  generateConstraintRecreation(change, before, path) {
    const table = before.tableKey || before.tableName || change.schema;
    const name = before.name || path.split('.').pop();
    
    switch (before.constraintType) {
      case 'FOREIGN_KEY':
      case 'FOREIGN KEY':
        const refTable = before.referencedTable;
        return `ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${(before.columns || []).join(', ')}) REFERENCES ${refTable}(${(before.referencedColumns || []).join(', ')})${before.onDelete ? ` ON DELETE ${before.onDelete}` : ''}${before.onUpdate ? ` ON UPDATE ${before.onUpdate}` : ''};`;
      
      case 'UNIQUE':
        return `ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${(before.columns || []).join(', ')});`;
      
      case 'CHECK':
        return `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${before.checkExpression || before.expression});`;
      
      case 'PRIMARY_KEY':
      case 'PRIMARY KEY':
        return `ALTER TABLE ${table} ADD CONSTRAINT ${name} PRIMARY KEY (${(before.columns || []).join(', ')});`;
      
      default:
        return `-- Cannot recreate constraint ${name} of type ${before.constraintType}`;
    }
  }

  /**
   * Generate trigger recreation DDL for rollback
   */
  generateTriggerRecreation(before, path) {
    const parts = path.split('.');
    const name = parts.pop();
    
    let sql = `CREATE TRIGGER ${name}\n  ${before.timing || 'AFTER'} ${(before.events || ['INSERT', 'UPDATE']).join(' OR ')}`;
    sql += ` ON ${before.tableName || before.table}`;
    sql += ` FOR EACH ${before.isForEachRow ? 'ROW' : 'STATEMENT'}`;
    if (before.condition) sql += ` WHEN (${before.condition})`;
    sql += ` EXECUTE FUNCTION ${before.function}${before.functionArguments ? `(${before.functionArguments})` : ''};`;
    
    return sql;
  }

  /**
   * Generate policy recreation DDL for rollback
   */
  generatePolicyRecreation(before, path) {
    const parts = path.split('.');
    const name = parts.pop();
    
    let sql = `CREATE POLICY ${name} ON ${before.table}`;
    if (before.command) sql += ` FOR ${before.command}`;
    if (before.roles) sql += ` TO ${before.roles.join(', ')}`;
    if (before.using) sql += ` USING (${before.using})`;
    if (before.withCheck) sql += ` WITH CHECK (${before.withCheck})`;
    
    return sql + ';';
  }

  /**
   * Generate sequence recreation DDL for rollback
   */
  generateSequenceRecreation(before, path) {
    const startValue = before.startValue ?? before.start ?? 1;
    const increment = before.increment ?? 1;
    
    let sql = `CREATE SEQUENCE ${path} START WITH ${startValue} INCREMENT BY ${increment}`;
    
    if (before.minValue !== undefined) sql += ` MINVALUE ${before.minValue}`;
    if (before.maxValue !== undefined) sql += ` MAXVALUE ${before.maxValue}`;
    if (before.cache) sql += ` CACHE ${before.cache}`;
    if (before.cycle) sql += ' CYCLE';
    
    sql += ';';
    
    if (before.ownedBy) {
      sql += `\nALTER SEQUENCE ${path} OWNED BY ${before.ownedBy};`;
    }
    
    return sql;
  }

  /**
   * Generate type recreation DDL for rollback
   */
  generateTypeRecreation(before, path) {
    const typeCategory = before.typeCategory || before.kind;
    
    switch (typeCategory) {
      case 'composite':
      case 'COMPOSITE':
        return this.generateCompositeTypeRecreation(before, path);
      
      case 'domain':
      case 'DOMAIN':
        return this.generateDomainTypeRecreation(before, path);
      
      case 'range':
      case 'RANGE':
        return this.generateRangeTypeRecreation(before, path);
      
      case 'enum':
      case 'ENUM':
        return this.generateEnumTypeRecreation(before, path);
      
      default:
        if (before.enumValues) {
          return this.generateEnumTypeRecreation(before, path);
        }
        if (before.attributes) {
          return this.generateCompositeTypeRecreation(before, path);
        }
        if (before.baseType) {
          return this.generateDomainTypeRecreation(before, path);
        }
        return `-- Cannot recreate type ${path}: unknown type category ${typeCategory}`;
    }
  }

  /**
   * Generate composite type recreation
   */
  generateCompositeTypeRecreation(before, path) {
    const attributes = before.attributes || [];
    const attrDefs = attributes.map(a => `${a.name} ${a.dataType || a.type}`);
    return `CREATE TYPE ${path} AS (${attrDefs.join(', ')});`;
  }

  /**
   * Generate domain type recreation
   */
  generateDomainTypeRecreation(before, path) {
    let sql = `CREATE DOMAIN ${path} AS ${before.baseType}`;
    if (before.default) sql += ` DEFAULT ${before.default}`;
    if (before.notNull) sql += ' NOT NULL';
    if (before.check || before.checkExpression) {
      sql += ` CHECK (${before.check || before.checkExpression})`;
    }
    return sql + ';';
  }

  /**
   * Generate range type recreation
   */
  generateRangeTypeRecreation(before, path) {
    let sql = `CREATE TYPE ${path} AS RANGE (subtype = ${before.subtype}`;
    if (before.subtypeOpclass) sql += `, subtype_opclass = ${before.subtypeOpclass}`;
    if (before.canonicalFunction || before.canonical) sql += `, canonical = ${before.canonicalFunction || before.canonical}`;
    if (before.subtypeDiff) sql += `, subtype_diff = ${before.subtypeDiff}`;
    sql += ');';
    return sql;
  }

  /**
   * Generate enum type recreation
   */
  generateEnumTypeRecreation(before, path) {
    const values = before.enumValues || before.labels || [];
    const valueList = values.map(v => `'${typeof v === 'string' ? v : v.value || v}'`).join(', ');
    return `CREATE TYPE ${path} AS ENUM (${valueList});`;
  }

  /**
   * Generate undo for ALTER operations
   */
  generateUndoForAlter(change, objectType, path) {
    const property = change.property;
    const currentValue = change.currentValue;
    const desiredValue = change.desiredValue;
    const parts = path.split('.');
    const col = parts.pop();
    const table = parts.join('.');

    switch (property) {
      case 'dataType':
      case 'type':
        return this.generateTypeChangeRollback(change, table, col, currentValue);

      case 'isNullable':
      case 'notNull':
        return this.generateNotNullRollback(change, table, col, currentValue, desiredValue);

      case 'defaultValue':
      case 'default':
        return this.generateDefaultRollback(change, table, col, currentValue, desiredValue);

      case 'comment':
        if (currentValue) {
          return `COMMENT ON COLUMN ${path} IS '${currentValue.replace(/'/g, "''")}';`;
        }
        return `COMMENT ON COLUMN ${path} IS NULL;`;

      case 'owner':
        const previousOwner = change.before?.owner || currentValue;
        return `ALTER TABLE ${table} OWNER TO ${previousOwner};`;

      case 'storage':
      case 'storageParameter':
        return this.generateStorageParameterRollback(change, table, col);

      default:
        return `-- CANNOT AUTO-ROLLBACK: Property "${property}" change on ${path}`;
    }
  }

  /**
   * Generate rollback for column type changes - FIX: Include USING clause
   */
  generateTypeChangeRollback(change, table, col, currentType) {
    const before = change.before;
    const desiredType = change.desiredValue;
    const needsUsing = this.typeCastNeedsUsing(desiredType, currentType);
    
    let sql = `ALTER TABLE ${table} ALTER COLUMN "${col}" TYPE ${currentType}`;
    
    if (needsUsing) {
      let usingExpr = change.usingExpression || before?.usingExpression;
      if (!usingExpr) {
        usingExpr = `"${col}"::${currentType}`;
      }
      sql += ` USING ${usingExpr}`;
    }
    
    return sql + ';';
  }

  /**
   * Determine if type cast requires explicit USING clause
   */
  typeCastNeedsUsing(fromType, toType) {
    const fromLower = fromType?.toLowerCase();
    const toLower = toType?.toLowerCase();
    
    if (fromLower === toLower) return false;
    
    // Numeric promotions that don't need USING
    const implicitCasts = [
      ['int2', 'int4'], ['int4', 'int8'], ['int2', 'int8'],
      ['float4', 'float8'],
      ['smallint', 'integer'], ['integer', 'bigint'],
      ['real', 'double precision'],
    ];
    
    for (const [f, t] of implicitCasts) {
      if (fromLower?.includes(f) && toLower?.includes(t)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Generate undo for RENAME operations
   */
  generateUndoForRename(change, path) {
    const oldName = change.oldName || change.before?.name;
    const newName = change.newName || change.after?.name;
    const objectType = change.objectType;
    const schema = change.schema;

    if (!oldName) {
      return `-- ⚠️ CANNOT ROLLBACK RENAME: Original name not captured for ${path}`;
    }

    switch (objectType) {
      case 'table':
        return `ALTER TABLE ${schema}.${newName} RENAME TO "${oldName}";`;

      case 'column':
        const tableName = change.tableName || change.after?.tableName;
        return `ALTER TABLE ${schema}.${tableName} RENAME COLUMN "${newName}" TO "${oldName}";`;

      case 'index':
        return `ALTER INDEX ${schema}.${newName} RENAME TO "${oldName}";`;

      case 'constraint':
        const conTable = change.tableName || change.after?.tableName;
        return `ALTER TABLE ${schema}.${conTable} RENAME CONSTRAINT "${newName}" TO "${oldName}";`;

      default:
        return `-- CANNOT AUTO-ROLLBACK: RENAME for object type "${objectType}" on ${path}`;
    }
  }

  /**
   * Generate undo for REPLACE/RECREATE operations
   */
  generateUndoForReplace(change, objectType, path) {
    const currentValue = change.currentValue || change.before;
    const before = change.before;

    switch (objectType) {
      case 'view':
        if (currentValue?.definition || before?.definition) {
          return `CREATE OR REPLACE VIEW ${path} AS ${currentValue?.definition || before.definition};`;
        }
        return `-- CANNOT ROLLBACK: View ${path} was replaced. Original definition not available.`;

      case 'materializedView':
        return `-- CANNOT FULLY ROLLBACK: Materialized view ${path} was recreated. Data would need to be refreshed.`;

      case 'function':
      case 'procedure':
        if (currentValue?.source || before?.source) {
          return `CREATE OR REPLACE ${objectType === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} ${path} AS $$${currentValue?.source || before.source}$$;`;
        }
        return `-- CANNOT ROLLBACK: ${objectType} ${path} was replaced. Original source not available.`;

      case 'trigger':
        const trigTable = change.tableName || before?.tableName;
        const trigName = change.name || before?.name;
        return `DROP TRIGGER IF EXISTS ${trigName} ON ${trigTable};`;

      case 'policy':
        return `-- CANNOT FULLY ROLLBACK: Policy ${path} was recreated. May need manual restoration.`;

      default:
        return `-- CANNOT AUTO-ROLLBACK: REPLACE for object type "${objectType}" on ${path}`;
    }
  }

  /**
   * Check if rollback is possible for a change
   * @param {Object} change
   * @returns {{possible: boolean, reason: string}}
   */
  canRollback(change) {
    const changeType = change.changeType;
    const objectType = change.objectType;

    if (changeType?.startsWith('DROP')) {
      if (objectType === 'table' || objectType === 'column') {
        return { possible: false, reason: 'Data loss - cannot recover dropped data' };
      }
      
      // FIX: Check if before state is available
      if (change.before && Object.keys(change.before).length > 0) {
        return { 
          possible: true, 
          reason: 'Object can be recreated from captured before state',
          caveat: 'Definition preserved for definitional objects'
        };
      }
      
      return { possible: false, reason: 'Definition lost - need original DDL to recreate' };
    }

    if (changeType === 'ADD_ENUM_VALUES') {
      return { possible: false, reason: 'PostgreSQL cannot remove enum values without recreating type' };
    }

    return { possible: true, reason: 'Rollback available' };
  }

  /**
   * Generate full rollback script with comments
   * @param {Object} migration
   * @returns {string}
   */
  generateRollbackScript(migration) {
    const steps = this.generateRollback(migration);
    const lines = [];

    lines.push(`-- Rollback script for migration: ${migration.migration_id || migration.id}`);
    lines.push(`-- Schema Weaver Generated Rollback`);
    lines.push(`-- WARNING: This is a best-effort rollback. Some changes cannot be reversed.`);
    lines.push('');

    const transactional = steps.filter(s => s.isTransactional !== false);
    const nonTransactional = steps.filter(s => s.isTransactional === false);

    if (nonTransactional.length > 0) {
      lines.push('-- === NON-TRANSACTIONAL STEPS (cannot be rolled back, run outside transaction) ===');
      for (const step of nonTransactional) {
        lines.push(`-- Step ${step.originalChangeId}: ${step.changeType} ${step.objectKey}`);
        lines.push(step.sql);
        lines.push('');
      }
      lines.push('');
    }

    if (transactional.length > 0) {
      lines.push('-- === TRANSACTIONAL STEPS ===');
      lines.push('BEGIN;');
      lines.push('');

      for (const step of transactional) {
        if (step.sql.startsWith('--')) {
          lines.push(`-- Step ${step.originalChangeId}: (cannot rollback)`);
          lines.push(`-- ${step.sql.replace(/^-- /, '')}`);
        } else {
          lines.push(`-- Rollback step ${step.originalChangeId}: ${step.changeType} ${step.objectKey}`);
          lines.push(step.sql);
        }
        lines.push('');
      }

      lines.push('COMMIT;');
    }

    lines.push('');
    lines.push('-- End of rollback script');

    return lines.join('\n');
  }

  /**
   * Generate rollback for NOT NULL constraint changes
   * Handles PG18+ named NOT NULL constraints
   */
  generateNotNullRollback(change, table, col, currentValue, desiredValue) {
    const before = change.before;
    const constraintName = before?.notNullConstraintName || change.notNullConstraintName;
    
    // Rollback: if we SET NOT NULL (desiredValue=true), then DROP NOT NULL
    // Rollback: if we DROP NOT NULL (desiredValue=false), then SET NOT NULL
    const wasSetNotNull = desiredValue === true;
    const wasDropNotNull = desiredValue === false || (desiredValue === undefined && currentValue === true);
    
    if (wasDropNotNull) {
      // Need to restore NOT NULL
      if (this.isPg18Plus() && constraintName) {
        return `ALTER TABLE ${table} ADD CONSTRAINT "${constraintName}" CHECK ("${col}" IS NOT NULL);`;
      }
      return `ALTER TABLE ${table} ALTER COLUMN "${col}" SET NOT NULL;`;
    }
    
    // Need to remove NOT NULL
    if (this.isPg18Plus() && constraintName) {
      return `ALTER TABLE ${table} DROP CONSTRAINT "${constraintName}";`;
    }
    return `ALTER TABLE ${table} ALTER COLUMN "${col}" DROP NOT NULL;`;
  }

  /**
   * Generate rollback for DEFAULT value changes
   * Handles complex DEFAULT expressions including functions
   */
  generateDefaultRollback(change, table, col, currentValue, desiredValue) {
    const before = change.before;
    const originalDefault = before?.defaultValue ?? before?.default ?? currentValue;
    
    if (desiredValue === null) {
      if (originalDefault === null || originalDefault === undefined) {
        return `ALTER TABLE ${table} ALTER COLUMN "${col}" DROP DEFAULT;`;
      }
      return `ALTER TABLE ${table} ALTER COLUMN "${col}" SET DEFAULT ${originalDefault};`;
    }
    
    if (currentValue === null || currentValue === undefined) {
      return `ALTER TABLE ${table} ALTER COLUMN "${col}" DROP DEFAULT;`;
    }
    
    const escapedDefault = this.escapeDefaultExpression(originalDefault);
    return `ALTER TABLE ${table} ALTER COLUMN "${col}" SET DEFAULT ${escapedDefault};`;
  }

  /**
   * Escape and validate DEFAULT expression
   */
  escapeDefaultExpression(defaultValue) {
    if (defaultValue === null || defaultValue === undefined) {
      return 'NULL';
    }
    
    if (typeof defaultValue === 'string') {
      if (defaultValue.startsWith('(') && defaultValue.endsWith(')')) {
        return defaultValue;
      }
      
      const functionPattern = /^(nextval|currval|uuid_generate|gen_random_uuid|now|current_timestamp|current_date|current_time|current_user|session_user|user)\s*\(/i;
      if (functionPattern.test(defaultValue)) {
        return defaultValue;
      }
      
      const operatorPattern = /::/;
      if (operatorPattern.test(defaultValue)) {
        return defaultValue;
      }
      
      if (/^['"]/.test(defaultValue)) {
        return defaultValue;
      }
      
      if (/^\d+$/.test(defaultValue)) {
        return defaultValue;
      }
      
      if (/^(true|false|null)$/i.test(defaultValue)) {
        return defaultValue;
      }
      
      return defaultValue;
    }
    
    return String(defaultValue);
  }

  /**
   * Generate rollback for storage parameter changes
   */
  generateStorageParameterRollback(change, table, col) {
    const before = change.before;
    
    if (!before || !before.storageParameters) {
      const originalStorage = before?.storage || change.currentValue;
      if (originalStorage) {
        return `ALTER TABLE ${table} ALTER COLUMN "${col}" SET STORAGE ${originalStorage};`;
      }
      return `-- ⚠️ CANNOT ROLLBACK: Storage parameter for ${table}.${col} was changed. Original value not captured.`;
    }
    
    const params = before.storageParameters;
    const statements = [];
    
    if (params.storage) {
      statements.push(`ALTER TABLE ${table} ALTER COLUMN "${col}" SET STORAGE ${params.storage};`);
    }
    
    if (params.fillfactor) {
      statements.push(`ALTER TABLE ${table} SET (fillfactor = ${params.fillfactor});`);
    }
    
    if (params.autovacuum_enabled !== undefined) {
      statements.push(`ALTER TABLE ${table} SET (autovacuum_enabled = ${params.autovacuum_enabled});`);
    }
    
    if (statements.length === 0) {
      return `-- ⚠️ CANNOT ROLLBACK: Storage parameters for ${table}.${col} were changed. No original values captured.`;
    }
    
    return statements.join('\n');
  }

  /**
   * Generate undo for DETACH PARTITION operations
   * Handles PG17+ DETACH CONCURRENTLY
   */
  generatePartitionDetachRollback(change, path) {
    const before = change.before;
    const tableName = change.tableName || before?.tableName;
    const partitionName = change.partitionName || before?.partitionName;
    const isConcurrent = change.isConcurrent || before?.isConcurrent;
    
    if (!tableName || !partitionName) {
      return `-- ⚠️ CANNOT ROLLBACK: Partition detach for ${path}. Table or partition name not captured.`;
    }
    
    if (isConcurrent && this.isPg17Plus()) {
      return `-- ⚠️ PARTIAL ROLLBACK: DETACH CONCURRENTLY was used. Re-attach requires:
-- ALTER TABLE ${tableName} ATTACH PARTITION ${partitionName} FOR VALUES ...;
-- Note: Concurrent detach completed, re-attachment may require exclusive lock.`;
    }
    
    const attachSpec = before?.partitionValues || before?.attachSpec;
    if (attachSpec) {
      return `ALTER TABLE ${tableName} ATTACH PARTITION ${partitionName} ${attachSpec};`;
    }
    
    return `-- ⚠️ CANNOT FULLY ROLLBACK: Partition ${partitionName} was detached from ${tableName}. Re-attach requires partition specification.
-- Example: ALTER TABLE ${tableName} ATTACH PARTITION ${partitionName} FOR VALUES ...;`;
  }

  /**
   * Attach partition specification generator
   */
  generateAttachPartitionSpec(before) {
    const rangeValues = before?.rangeValues;
    const listValues = before?.listValues;
    const defaultPartition = before?.isDefault;
    
    if (defaultPartition) {
      return 'DEFAULT';
    }
    
    if (rangeValues) {
      if (Array.isArray(rangeValues)) {
        return `FOR VALUES FROM (${rangeValues[0]}) TO (${rangeValues[1]})`;
      }
      return `FOR VALUES FROM ${rangeValues.from} TO ${rangeValues.to}`;
    }
    
    if (listValues) {
      const values = Array.isArray(listValues) 
        ? listValues.map(v => `'${v}'`).join(', ')
        : listValues;
      return `FOR VALUES IN (${values})`;
    }
    
    return null;
  }

  /**
   * Build complete type change rollback with type modifiers
   */
  buildTypeChangeRollback(table, col, targetType, usingExpr, typeModifiers = {}) {
    let sql = `ALTER TABLE ${table} ALTER COLUMN "${col}" TYPE ${targetType}`;
    
    if (typeModifiers.array) {
      sql += '[]';
    }
    
    if (usingExpr) {
      sql += ` USING ${usingExpr}`;
    }
    
    return sql + ';';
  }
}
