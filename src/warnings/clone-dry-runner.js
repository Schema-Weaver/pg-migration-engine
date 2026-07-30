import crypto from 'crypto';

export class CloneDryRunner {
  constructor(pool) {
    this.pool = pool;
    this.schemaName = null;
    this.originalSchema = 'public';
    this.results = null;
  }

  async run(plan, options = {}) {
    const sampleSize = options.sampleSize || 1000;
    const affectedTables = this._extractAffectedTables(plan);
    this.schemaName = `sw_dryrun_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    this.results = { schemaName: this.schemaName, steps: [], errors: [], warnings: [], success: true };

    try {
      await this.pool.query('BEGIN');

      // Step 1: Create ephemeral schema
      await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schemaName}"`);
      this.results.steps.push({ step: 'create_schema', status: 'ok', detail: `Created schema "${this.schemaName}"` });

      // Step 2: Clone affected tables
      for (const table of affectedTables) {
        const cloneResult = await this._cloneTable(table, sampleSize);
        this.results.steps.push(cloneResult);
        if (cloneResult.status === 'error') {
          this.results.errors.push(cloneResult);
          this.results.success = false;
        }
      }

      // Step 3: Extract and run DDL against clone
      const ddlStatements = this._extractDDL(plan);
      for (const ddl of ddlStatements) {
        const testResult = await this._testDDL(ddl);
        this.results.steps.push(testResult);
        if (testResult.status === 'error') {
          this.results.errors.push(testResult);
          this.results.success = false;
        }
      }

      await this.pool.query('COMMIT');
    } catch (err) {
      await this.pool.query('ROLLBACK');
      this.results.success = false;
      this.results.errors.push({ step: 'dry_run', status: 'error', detail: err.message });
    }

    return {
      ...this.results,
      safeToProceed: this.results.errors.length === 0,
    };
  }

  async cleanup() {
    if (!this.schemaName) return;
    try {
      await this.pool.query(`DROP SCHEMA IF EXISTS "${this.schemaName}" CASCADE`);
    } catch {
      // Best-effort cleanup
    }
    this.schemaName = null;
  }

  _extractAffectedTables(plan) {
    const tables = new Set();
    const changes = plan.changes || plan.steps || [];
    for (const c of changes) {
      if (c.objectType === 'table' && c.tableName) {
        tables.add({ schema: c.schema || 'public', name: c.tableName });
      } else if (c.objectType === 'column' && c.tableName) {
        tables.add({ schema: c.schema || 'public', name: c.tableName });
      } else if (c.objectType === 'constraint' && c.tableName) {
        tables.add({ schema: c.schema || 'public', name: c.tableName });
      } else if (c.objectType === 'index' && c.tableName) {
        tables.add({ schema: c.schema || 'public', name: c.tableName });
      } else if (c.objectKey) {
        const parts = c.objectKey.split('.');
        if (parts.length >= 2) {
          tables.add({ schema: parts[0] || 'public', name: parts[1] });
        }
      }
    }
    return [...tables];
  }

  async _cloneTable(table, sampleSize) {
    const src = `"${table.schema}"."${table.name}"`;
    const dst = `"${this.schemaName}"."${table.name}"`;
    try {
      // Get row count
      const countResult = await this.pool.query(`SELECT COUNT(*) AS cnt FROM ${src}`);
      const totalRows = parseInt(countResult.rows[0]?.cnt, 10) || 0;

      // Create clone with indexes, defaults, constraints
      const pkResult = await this.pool.query(`
        SELECT array_agg(a.attname ORDER BY a.attnum) AS pk_cols
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary
      `, [`${table.schema}.${table.name}`]);
      const pkCols = pkResult.rows[0]?.pk_cols || [];

      let ddl = `CREATE TABLE ${dst} (LIKE ${src} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`;
      await this.pool.query(ddl);

      // Copy data (sampled for large tables, full for small)
      const actualSample = totalRows > sampleSize ? sampleSize : totalRows;
      if (totalRows > 0) {
        if (totalRows <= sampleSize) {
          await this.pool.query(`INSERT INTO ${dst} SELECT * FROM ${src}`);
        } else {
          const colsResult = await this.pool.query(`
            SELECT array_agg(a.attname ORDER BY a.attnum) AS cols
            FROM pg_attribute a
            WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
          `, [`${table.schema}.${table.name}`]);
          const cols = colsResult.rows[0]?.cols || [];
          const colList = cols.map(c => `"${c}"`).join(', ');
          await this.pool.query(
            `INSERT INTO ${dst} (${colList}) SELECT ${colList} FROM ${src} ORDER BY random() LIMIT $1`,
            [sampleSize]
          );
        }
      }

      return {
        step: `clone_${table.name}`,
        status: 'ok',
        detail: `Cloned "${table.name}" (${totalRows} rows, sampled ${actualSample} into "${this.schemaName}")`,
        totalRows,
        sampledRows: actualSample,
      };
    } catch (err) {
      return {
        step: `clone_${table.name}`,
        status: 'error',
        detail: `Failed to clone "${table.name}": ${err.message}`,
      };
    }
  }

  async _testDDL(ddl) {
    if (!ddl || !ddl.sql) {
      return { step: 'ddl_test', status: 'skip', detail: 'No SQL to execute' };
    }
    const rewritten = this._rewriteDDL(ddl.sql);
    try {
      await this.pool.query(rewritten);
      return {
        step: `ddl_${ddl.id || 'unknown'}`,
        status: 'ok',
        detail: `Applied: ${rewritten.substring(0, 80)}`,
        originalSql: ddl.sql,
      };
    } catch (err) {
      return {
        step: `ddl_${ddl.id || 'unknown'}`,
        status: 'error',
        detail: err.message,
        originalSql: ddl.sql,
        rewrittenSql: rewritten,
        severity: err.code === '23505' ? 'data_conflict' :
                  err.code === '23503' ? 'fk_violation' :
                  err.code === '23514' ? 'check_violation' :
                  err.code === '22001' ? 'truncation' : 'ddl_error',
      };
    }
  }

  _rewriteDDL(sql) {
    return sql.replace(
      /"\w+"\./g,
      (match) => {
        const schema = match.replace('.', '').replace(/"/g, '');
        if (schema === this.originalSchema || schema === 'public') {
          return `"${this.schemaName}".`;
        }
        return match;
      }
    );
  }

  _extractDDL(plan) {
    const steps = plan.steps || plan.changes || [];
    return steps
      .filter(s => s.sql && s.sql.trim().length > 0)
      .map(s => ({ id: s.id, sql: s.sql, type: s.type || s.changeType }));
  }
}
