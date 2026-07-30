export class DataSampler {
  constructor(pool) {
    this.pool = pool;
    this.SAMPLE_LIMIT = 5;
  }

  async sample(change, classification) {
    const query = this.buildSampleQuery(change, classification);
    if (!query) return null;
    try {
      const result = await this.pool.query(query);
      return {
        query,
        totalColumns: result.fields.length,
        columns: result.fields.map(f => f.name),
        rows: result.rows,
        rowCount: result.rows.length,
        truncated: result.rows.length >= this.SAMPLE_LIMIT,
      };
    } catch {
      return null;
    }
  }

  buildSampleQuery(change, classification) {
    if (!classification) return null;

    const schema = change.schema || change.objectKey?.split('.')[0] || 'public';

    if (change.objectType === 'table' && change.changeType === 'DROP') {
      const table = change.tableName || change.name || change.objectKey?.split('.')[1] || '';
      if (!table) return null;
      return `SELECT * FROM "${schema}"."${table}" LIMIT ${this.SAMPLE_LIMIT}`;
    }

    if (change.objectType === 'column' && change.changeType === 'DROP') {
      const table = change.tableName || change.objectKey?.split('.')[1] || '';
      const column = change.columnName || change.name || change.objectKey?.split('.')[2] || '';
      if (!table || !column) return null;
      return `SELECT "${column}" FROM "${schema}"."${table}" WHERE "${column}" IS NOT NULL LIMIT ${this.SAMPLE_LIMIT}`;
    }

    if (change.objectType === 'column' && change.property === 'dataType' && classification.narrowingInfo) {
      return this.buildNarrowingSampleQuery(change, classification.narrowingInfo);
    }

    if (change.objectType === 'constraint' && change.changeType !== 'DROP') {
      const ct = change.constraintType || '';
      if (ct === 'CHECK') {
        const table = change.tableName || change.objectKey?.split('.')[1] || '';
        const checkExpr = change.after?.checkExpression || change.checkExpression || change.definition || '';
        if (!table || !checkExpr) return null;
        return `SELECT * FROM "${schema}"."${table}" WHERE NOT (${checkExpr}) LIMIT ${this.SAMPLE_LIMIT}`;
      }
      if (ct === 'FOREIGN_KEY') {
        const table = change.tableName || change.objectKey?.split('.')[1] || '';
        const columns = change.after?.columns || change.columns || [];
        const refTable = change.after?.referencedTable || change.referencedTable || '';
        const refSchema = change.after?.referencedSchema || schema;
        const refColumns = change.after?.referencedColumns || change.referencedColumns || [];
        if (!table || !columns.length || !refTable || !refColumns.length) return null;
        const fkCol = columns[0];
        const pkCol = refColumns[0];
        return `SELECT * FROM "${schema}"."${table}" WHERE "${fkCol}" IS NOT NULL AND "${fkCol}" NOT IN (SELECT "${pkCol}" FROM "${refSchema}"."${refTable}") LIMIT ${this.SAMPLE_LIMIT}`;
      }
      if (ct === 'UNIQUE' || ct === 'PRIMARY_KEY') {
        const table = change.tableName || change.objectKey?.split('.')[1] || '';
        const columns = change.after?.columns || change.columns || [];
        if (!table || !columns.length) return null;
        const colList = columns.map(c => `"${c}"`).join(', ');
        return `SELECT ${colList}, COUNT(*) AS dup_count FROM "${schema}"."${table}" GROUP BY ${colList} HAVING COUNT(*) > 1 LIMIT ${this.SAMPLE_LIMIT}`;
      }
      if (ct === 'NOT_NULL') {
        const table = change.tableName || change.objectKey?.split('.')[1] || '';
        const column = change.columnName || change.name || change.objectKey?.split('.')[2] || '';
        if (!table || !column) return null;
        return `SELECT * FROM "${schema}"."${table}" WHERE "${column}" IS NULL LIMIT ${this.SAMPLE_LIMIT}`;
      }
    }

    if (change.objectType === 'column' && change.property === 'isNullable' && change.desiredValue === false) {
      const table = change.tableName || change.objectKey?.split('.')[1] || '';
      const column = change.columnName || change.name || change.objectKey?.split('.')[2] || '';
      if (!table || !column) return null;
      return `SELECT * FROM "${schema}"."${table}" WHERE "${column}" IS NULL LIMIT ${this.SAMPLE_LIMIT}`;
    }

    return null;
  }

  buildNarrowingSampleQuery(change, narrowingInfo) {
    const schema = change.schema || change.objectKey?.split('.')[0] || 'public';
    const table = change.tableName || change.objectKey?.split('.')[1] || '';
    const column = change.columnName || change.name || change.objectKey?.split('.')[2] || '';
    if (!table || !column) return null;

    const from = narrowingInfo.fromType || change.currentValue || change.before?.dataType || '';
    const to = narrowingInfo.toType || change.desiredValue || change.after?.dataType || '';
    const fromUpper = from.toUpperCase();
    const toUpper = to.toUpperCase();

    if ((fromUpper.includes('INTEGER') || fromUpper.includes('INT4') || fromUpper === 'INT') && toUpper.includes('SMALLINT')) {
      return `SELECT "${column}" FROM "${schema}"."${table}" WHERE "${column}" > 32767 LIMIT ${this.SAMPLE_LIMIT}`;
    }
    if (fromUpper.includes('BIGINT') && (toUpper.includes('SMALLINT') || toUpper.includes('INT2'))) {
      return `SELECT "${column}" FROM "${schema}"."${table}" WHERE "${column}" > 32767 LIMIT ${this.SAMPLE_LIMIT}`;
    }
    if (fromUpper.includes('BIGINT') && (toUpper.includes('INTEGER') || toUpper.includes('INT4') || toUpper.includes('INT'))) {
      return `SELECT "${column}" FROM "${schema}"."${table}" WHERE "${column}" > 2147483647 LIMIT ${this.SAMPLE_LIMIT}`;
    }
    if ((fromUpper.includes('DOUBLE') || fromUpper.includes('FLOAT8')) && (toUpper.includes('REAL') || toUpper.includes('FLOAT4'))) {
      return `SELECT "${column}" FROM "${schema}"."${table}" WHERE "${column}" != "${column}"::REAL LIMIT ${this.SAMPLE_LIMIT}`;
    }
    if (fromUpper.includes('NUMERIC') && toUpper.includes('NUMERIC')) {
      return `SELECT "${column}" FROM "${schema}"."${table}" WHERE "${column}"::TEXT != "${column}"::${to}::TEXT LIMIT ${this.SAMPLE_LIMIT}`;
    }
    if ((fromUpper.includes('VARCHAR') || fromUpper.includes('CHARACTER VARYING')) && toUpper.includes('VARCHAR')) {
      const toMatch = to.match(/VARCHAR\s*\((\d+)\)/i);
      if (toMatch) {
        return `SELECT "${column}" FROM "${schema}"."${table}" WHERE LENGTH("${column}") > ${toMatch[1]} LIMIT ${this.SAMPLE_LIMIT}`;
      }
    }
    if (fromUpper.includes('TEXT') && toUpper.includes('VARCHAR')) {
      const toMatch = to.match(/VARCHAR\s*\((\d+)\)/i);
      if (toMatch) {
        return `SELECT "${column}" FROM "${schema}"."${table}" WHERE LENGTH("${column}") > ${toMatch[1]} LIMIT ${this.SAMPLE_LIMIT}`;
      }
    }
    if ((fromUpper.includes('TIMESTAMPTZ') || fromUpper.includes('TIMESTAMP WITH TIME ZONE')) && toUpper.includes('DATE')) {
      return `SELECT "${column}" FROM "${schema}"."${table}" WHERE "${column}" != "${column}"::DATE LIMIT ${this.SAMPLE_LIMIT}`;
    }
    if (fromUpper.includes('TIMESTAMP') && !fromUpper.includes('TIMESTAMPTZ') && toUpper.includes('DATE')) {
      return `SELECT "${column}" FROM "${schema}"."${table}" WHERE "${column}" != "${column}"::DATE LIMIT ${this.SAMPLE_LIMIT}`;
    }

    return null;
  }
}
