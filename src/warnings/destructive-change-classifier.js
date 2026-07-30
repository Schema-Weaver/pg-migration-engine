/**
 * Destructive Change Warning System - Change Classifier
 * Classifies DDL changes by destructiveness level
 */
export class DestructiveChangeClassifier {
  classify(change) {
    const ct = change.changeType;
    const ot = change.objectType;
    const normalized = `${ct}_${ot}`.toUpperCase();
    const classifier = this.classifiers[normalized] || this.classifiers[`${ct}_*`];
    if (classifier) return classifier(change);
    const wildcard = this.wildcards[ct];
    if (wildcard) return wildcard(change);
    return { level: 'safe', reason: 'Unknown operation, treated as safe' };
  }

  constructor() {
    this.wildcards = {
      CREATE: () => ({ level: 'safe', reason: 'Creating new objects is safe' }),
      ADD: () => ({ level: 'safe', reason: 'Adding new objects is safe' }),
      RENAME: () => ({ level: 'safe', reason: 'Renaming preserves data' }),
      COMMENT: () => ({ level: 'safe', reason: 'Comments have no data impact' }),
      GRANT: () => ({ level: 'safe', reason: 'Grants have no data impact' }),
      REVOKE: () => ({ level: 'safe', reason: 'Revokes have no data impact' }),
    };

    this.classifiers = {};

    const dataLoss = (change) => ({
      level: 'data_loss',
      reason: `Permanent data loss`,
      affectedRowsQuery: this.getDataLossQuery(change),
    });

    const dataRisk = (change) => ({
      level: 'data_risk',
      reason: `Possible data issues`,
      affectedRowsQuery: this.getDataRiskQuery(change),
    });

    const objectDestruction = (change) => ({
      level: 'object_destruction',
      reason: `Object will be removed`,
    });

    const safe = () => ({ level: 'safe' });

    this.addClassifier('DROP_table', dataLoss);
    this.addClassifier('DROP_column', dataLoss);
    this.addClassifier('ALTER_column', (change) => {
      if (change.property === 'dataType') {
        if (this.isWideningCast(change)) return safe();
        const info = this.getNarrowingInfo(change);
        if (info) return { level: 'data_loss', reason: info.reason, affectedRowsQuery: info.query, details: info };
        return { level: 'data_risk', reason: 'Type change may cause issues' };
      }
      if (change.property === 'isNullable' && change.desiredValue === true) return safe();
      if (change.property === 'isNullable' && change.desiredValue === false) {
        return { level: 'data_risk', reason: 'Adding NOT NULL', affectedRowsQuery: this.getNotNullQuery(change) };
      }
      if (change.property === 'defaultValue') return { level: 'data_risk', reason: 'Default value change' };
      if (change.property === 'dropDefault') return { level: 'data_risk', reason: 'Dropping default', affectedRowsQuery: this.getDropDefaultQuery(change) };
      return safe();
    });

    this.addClassifier('DROP_view', objectDestruction);
    this.addClassifier('DROP_materializedView', objectDestruction);
    this.addClassifier('DROP_function', objectDestruction);
    this.addClassifier('DROP_procedure', objectDestruction);
    this.addClassifier('DROP_trigger', objectDestruction);
    this.addClassifier('DROP_eventTrigger', objectDestruction);
    this.addClassifier('DROP_policy', objectDestruction);
    this.addClassifier('DROP_rule', objectDestruction);
    this.addClassifier('DROP_type', objectDestruction);
    this.addClassifier('DROP_domain', objectDestruction);
    this.addClassifier('DROP_sequence', objectDestruction);
    this.addClassifier('DROP_index', objectDestruction);
    this.addClassifier('DROP_constraint', objectDestruction);
    this.addClassifier('DROP_cast', objectDestruction);
    this.addClassifier('DROP_operator', objectDestruction);
    this.addClassifier('DROP_operatorClass', objectDestruction);
    this.addClassifier('DROP_operatorFamily', objectDestruction);
    this.addClassifier('DROP_statistics', objectDestruction);
    this.addClassifier('DROP_extension', objectDestruction);
    this.addClassifier('DROP_schema', objectDestruction);
    this.addClassifier('DROP_collation', objectDestruction);
    this.addClassifier('DROP_conversion', objectDestruction);
    this.addClassifier('DROP_textSearchConfig', objectDestruction);
    this.addClassifier('DROP_textSearchDict', objectDestruction);
    this.addClassifier('DROP_textSearchParser', objectDestruction);
    this.addClassifier('DROP_textSearchTemplate', objectDestruction);
    this.addClassifier('DROP_foreignTable', objectDestruction);
    this.addClassifier('DROP_foreignDataWrapper', objectDestruction);
    this.addClassifier('DROP_foreignServer', objectDestruction);
    this.addClassifier('DROP_userMapping', objectDestruction);
    this.addClassifier('DROP_publication', objectDestruction);
    this.addClassifier('DROP_subscription', objectDestruction);
    this.addClassifier('DROP_accessMethod', objectDestruction);
    this.addClassifier('DROP_language', objectDestruction);
    this.addClassifier('DROP_database', objectDestruction);
    this.addClassifier('DROP_role', objectDestruction);
    this.addClassifier('DROP_tablespace', objectDestruction);

    this.addClassifier('ADD_constraint', (change) => {
      if (change.constraintType === 'CHECK') return { level: 'data_risk', reason: 'Adding CHECK constraint', affectedRowsQuery: this.getCheckConstraintQuery(change) };
      if (change.constraintType === 'FOREIGN_KEY') return { level: 'data_risk', reason: 'Adding FOREIGN KEY', affectedRowsQuery: this.getForeignKeyQuery(change) };
      if (change.constraintType === 'UNIQUE' || change.constraintType === 'PRIMARY_KEY') return { level: 'data_risk', reason: 'Adding unique constraint', affectedRowsQuery: this.getUniqueConstraintQuery(change) };
      if (change.constraintType === 'NOT_NULL') return { level: 'data_risk', reason: 'Adding NOT NULL', affectedRowsQuery: this.getNotNullQuery(change) };
      if (change.constraintType === 'EXCLUSION') return { level: 'data_risk', reason: 'Adding exclusion constraint' };
      return safe();
    });

    this.addClassifier('ALTER_column', (change) => {
      if (change.property === 'dataType') {
        if (this.isWideningCast(change)) return safe();
        const info = this.getNarrowingInfo(change);
        if (info) return { level: 'data_risk', reason: `Narrowing type: ${info.reason}`, affectedRowsQuery: info.query, details: info, narrowingInfo: info };
        return { level: 'data_risk', reason: 'Type change may cause issues' };
      }
      if (change.property === 'isNullable' && change.desiredValue === true) return safe();
      if (change.property === 'isNullable' && change.desiredValue === false) {
        return { level: 'data_risk', reason: 'Adding NOT NULL', affectedRowsQuery: this.getNotNullQuery(change) };
      }
      if (change.property === 'defaultValue') return { level: 'data_risk', reason: 'Default value change' };
      if (change.property === 'dropDefault') return { level: 'data_risk', reason: 'Dropping default', affectedRowsQuery: this.getDropDefaultQuery(change) };
      return safe();
    });

    this.addClassifier('ALTER_view', objectDestruction);
    this.addClassifier('ALTER_function', objectDestruction);
    this.addClassifier('ALTER_procedure', objectDestruction);
    this.addClassifier('ALTER_trigger', objectDestruction);
    this.addClassifier('ALTER_policy', objectDestruction);
    this.addClassifier('ALTER_sequence', (change) => {
      if (change.property === 'dataType') return { level: 'data_risk', reason: 'Sequence type change' };
      return safe();
    });
  }

  addClassifier(key, fn) {
    this.classifiers[key.toUpperCase()] = fn;
  }

  getDataLossQuery(change) {
    const ot = change.objectType;
    if (ot === 'column') {
      const schema = change.schema || 'public';
      const table = change.tableName || change.objectKey?.split('.')?.[1] || '';
      const column = change.columnName || change.name || change.objectKey?.split('.')?.[2] || '';
      if (!table || !column) return null;
      return `SELECT COUNT("${column}") AS non_null_count FROM "${schema}"."${table}" WHERE "${column}" IS NOT NULL`;
    }
    if (ot === 'table') {
      const schema = change.schema || 'public';
      const table = change.tableName || change.name || change.objectKey?.split('.')?.[1] || '';
      if (!table) return null;
      return `SELECT COUNT(*) AS total_rows FROM "${schema}"."${table}"`;
    }
    return null;
  }

  getDataRiskQuery(change) {
    const ot = change.objectType;
    if (ot === 'constraint') {
      if (change.constraintType === 'CHECK') return this.getCheckConstraintQuery(change);
      if (change.constraintType === 'FOREIGN_KEY') return this.getForeignKeyQuery(change);
      if (change.constraintType === 'UNIQUE' || change.constraintType === 'PRIMARY_KEY') return this.getUniqueConstraintQuery(change);
      if (change.constraintType === 'NOT_NULL') return this.getNotNullQuery(change);
    }
    if (ot === 'column' && change.property === 'isNullable' && change.desiredValue === false) {
      return this.getNotNullQuery(change);
    }
    return null;
  }

  getCheckConstraintQuery(change) {
    const schema = change.schema || 'public';
    const table = change.tableName || change.objectKey?.split('.')?.[1] || '';
    const checkExpr = change.after?.checkExpression || change.checkExpression || change.definition || '';
    if (!table || !checkExpr) return null;
    return `SELECT COUNT(*) AS violations FROM "${schema}"."${table}" WHERE NOT (${checkExpr})`;
  }

  getForeignKeyQuery(change) {
    const schema = change.schema || 'public';
    const table = change.tableName || change.objectKey?.split('.')?.[1] || '';
    const columns = change.after?.columns || change.columns || [];
    const refTable = change.after?.referencedTable || change.referencedTable || '';
    const refSchema = change.after?.referencedSchema || schema;
    const refColumns = change.after?.referencedColumns || change.referencedColumns || [];
    if (!table || !columns.length || !refTable || !refColumns.length) return null;
    const fkCols = columns.map(c => `"${c}"`).join(', ');
    const pkCols = refColumns.map(c => `"${c}"`).join(', ');
    const fkCol = columns[0];
    const pkCol = refColumns[0];
    return `SELECT COUNT(*) AS violations FROM "${schema}"."${table}" WHERE "${fkCol}" IS NOT NULL AND "${fkCol}" NOT IN (SELECT "${pkCol}" FROM "${refSchema}"."${refTable}")`;
  }

  getUniqueConstraintQuery(change) {
    const schema = change.schema || 'public';
    const table = change.tableName || change.objectKey?.split('.')?.[1] || '';
    const columns = change.after?.columns || change.columns || [];
    if (!table || !columns.length) return null;
    const colList = columns.map(c => `"${c}"`).join(', ');
    return `SELECT COUNT(*) AS duplicates FROM (SELECT ${colList}, COUNT(*) AS c FROM "${schema}"."${table}" GROUP BY ${colList} HAVING COUNT(*) > 1) sub`;
  }

  getNotNullQuery(change) {
    const schema = change.schema || 'public';
    const table = change.tableName || change.objectKey?.split('.')?.[1] || '';
    const column = change.columnName || change.name || change.objectKey?.split('.')?.[2] || '';
    if (!table || !column) return null;
    return `SELECT COUNT(*) AS null_count FROM "${schema}"."${table}" WHERE "${column}" IS NULL`;
  }

  getDropDefaultQuery(change) {
    const schema = change.schema || 'public';
    const table = change.tableName || change.objectKey?.split('.')?.[1] || '';
    const column = change.columnName || change.name || change.objectKey?.split('.')?.[2] || '';
    if (!table || !column) return null;
    return `SELECT COUNT(*) AS row_count FROM "${schema}"."${table}"`;
  }

  getNarrowingInfo(change) {
    const from = change.currentValue || change.before?.dataType || change.before?.type || '';
    const to = change.desiredValue || change.after?.dataType || change.after?.type || '';
    if (!from || !to) return null;

    const schema = change.schema || 'public';
    const table = change.tableName || change.objectKey?.split('.')?.[1] || '';
    const column = change.columnName || change.name || change.objectKey?.split('.')?.[2] || '';
    if (!table || !column) return null;

    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();

    if ((fromUpper.includes('INTEGER') || fromUpper.includes('INT4') || fromUpper === 'INT') && toUpper.includes('SMALLINT') || toUpper.includes('INT2')) {
      return { reason: `INTEGER → SMALLINT narrowing: max 32,767`, query: `SELECT MAX("${column}") AS max_val FROM "${schema}"."${table}"` };
    }
    if ((fromUpper.includes('BIGINT') || fromUpper.includes('INT8')) && toUpper.includes('INTEGER') || toUpper.includes('INT4') || toUpper.includes('INT')) {
      return { reason: `BIGINT → INTEGER narrowing: max 2,147,483,647`, query: `SELECT MAX("${column}") AS max_val FROM "${schema}"."${table}"` };
    }
    if (fromUpper.includes('BIGINT') && (toUpper.includes('SMALLINT') || toUpper.includes('INT2'))) {
      return { reason: `BIGINT → SMALLINT narrowing: max 32,767`, query: `SELECT MAX("${column}") AS max_val FROM "${schema}"."${table}"` };
    }
    if ((fromUpper.includes('DOUBLE') || fromUpper.includes('FLOAT8')) && (toUpper.includes('REAL') || toUpper.includes('FLOAT4'))) {
      return { reason: `DOUBLE PRECISION → REAL: precision loss`, query: `SELECT COUNT(*) AS affected FROM "${schema}"."${table}" WHERE "${column}" != "${column}"::REAL` };
    }
    if (fromUpper.includes('NUMERIC') && toUpper.includes('NUMERIC')) {
      return { reason: `NUMERIC precision reduction`, query: `SELECT COUNT(*) AS affected FROM "${schema}"."${table}" WHERE "${column}"::TEXT != "${column}"::${to}::TEXT` };
    }
    if ((fromUpper.includes('VARCHAR') || fromUpper.includes('CHARACTER VARYING')) && toUpper.includes('VARCHAR')) {
      const toMatch = to.match(/VARCHAR\s*\((\d+)\)/i) || to.match(/CHARACTER VARYING\s*\((\d+)\)/i);
      if (toMatch) {
        return { reason: `VARCHAR truncation: max length ${toMatch[1]}`, query: `SELECT MAX(LENGTH("${column}")) AS max_length FROM "${schema}"."${table}"` };
      }
    }
    if (fromUpper.includes('TEXT') && toUpper.includes('VARCHAR')) {
      const toMatch = to.match(/VARCHAR\s*\((\d+)\)/i);
      if (toMatch) {
        return { reason: `TEXT → VARCHAR(${toMatch[1]}): truncation`, query: `SELECT MAX(LENGTH("${column}")) AS max_length FROM "${schema}"."${table}"` };
      }
    }
    if ((fromUpper.includes('TIMESTAMPTZ') || fromUpper.includes('TIMESTAMP WITH TIME ZONE')) && (toUpper.includes('DATE'))) {
      return { reason: `TIMESTAMPTZ → DATE: time/tz lost`, query: `SELECT COUNT(*) AS affected FROM "${schema}"."${table}" WHERE "${column}" != "${column}"::DATE` };
    }
    if (fromUpper.includes('TIMESTAMP') && !fromUpper.includes('TIMESTAMPTZ') && toUpper.includes('DATE')) {
      return { reason: `TIMESTAMP → DATE: time part lost`, query: `SELECT COUNT(*) AS affected FROM "${schema}"."${table}" WHERE "${column}" != "${column}"::DATE` };
    }

    return null;
  }

  isWideningCast(change) {
    const wideningPairs = [
      ['SMALLINT', 'INTEGER'], ['SMALLINT', 'BIGINT'], ['INTEGER', 'BIGINT'],
      ['REAL', 'DOUBLE'], ['REAL', 'DOUBLE PRECISION'],
      ['VARCHAR', 'TEXT'], ['VARCHAR', 'VARCHAR'],
    ];
    const from = (change.currentValue || change.before?.dataType || '').toUpperCase();
    const to = (change.desiredValue || change.after?.dataType || '').toUpperCase();
    return wideningPairs.some(([f, t]) => from.includes(f) && to.includes(t) && !from.includes(t));
  }
}
