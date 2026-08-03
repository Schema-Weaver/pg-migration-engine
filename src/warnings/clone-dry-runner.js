import crypto from 'crypto';

const CLONABLE_RELKINDS = new Set(['r', 'p', 'f']);

export class CloneDryRunner {
  constructor(pool) {
    this.pool = pool;
    this.schemaName = null;
    this.originalSchema = 'public';
    this.results = null;
    this.client = null;
  }

  async run(plan, options = {}) {
    const sampleSize = options.sampleSize || 1000;
    const affectedTables = this._extractAffectedTables(plan);
    this.schemaName = `sw_dryrun_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    this.results = { schemaName: this.schemaName, steps: [], errors: [], warnings: [], success: true };

    // Bug 8: every statement must run on ONE dedicated connection so the shadow
    // schema (and its transaction) is visible to all steps. pool.query() checks
    // out a different client per call, which is why the schema was never seen.
    let client;
    try {
      client = await this.pool.connect();
      this.client = client;

      await client.query('BEGIN');

      // Step 1: Create ephemeral schema
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schemaName}"`);
      this.results.steps.push({ step: 'create_schema', status: 'ok', detail: `Created schema "${this.schemaName}"` });

      // Step 1.5: Route unqualified lookups (nextval('seq'::regclass), OWNED BY
      // "tbl"."col", ...) into the shadow schema for the duration of this run.
      await client.query(`SET LOCAL search_path TO "${this.schemaName}", pg_catalog`);

      // Step 2: Clone affected tables
      for (const table of affectedTables) {
        const cloneResult = await this._cloneTable(client, table, sampleSize);
        this.results.steps.push(cloneResult);
        if (cloneResult.status === 'error') {
          this.results.errors.push(cloneResult);
          this.results.success = false;
        }
      }

      // Step 3: Extract and run DDL against clone. Each statement is isolated
      // behind its own savepoint so one failed step does not abort the whole
      // transaction (which would poison every later step).
      const ddlStatements = this._extractDDL(plan);
      for (let i = 0; i < ddlStatements.length; i++) {
        const sp = `sp_ddl_${i}`;
        await client.query(`SAVEPOINT ${sp}`).catch(() => {});
        const testResult = await this._testDDL(client, ddlStatements[i]);
        if (testResult.status === 'error') {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
        } else {
          await client.query(`RELEASE SAVEPOINT ${sp}`).catch(() => {});
        }
        this.results.steps.push(testResult);
        if (testResult.status === 'error') {
          this.results.errors.push(testResult);
          this.results.success = false;
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
      this.results.success = false;
      this.results.errors.push({ step: 'dry_run', status: 'error', detail: err.message });
    } finally {
      if (client) client.release();
      this.client = null;
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
      } else if (c.objectKey && c.objectType !== 'sequence') {
        const parts = c.objectKey.split('.');
        if (parts.length >= 2) {
          tables.add({ schema: parts[0] || 'public', name: parts[1] });
        }
      }
    }
    return [...tables];
  }

  async _cloneTable(client, table, sampleSize) {
    const src = `"${table.schema}"."${table.name}"`;
    const dst = `"${this.schemaName}"."${table.name}"`;
    try {
      // Only real tables can be cloned. Sequences (relkind 'S'), views and
      // brand-new tables (no source yet) are created by the plan DDL instead.
      const rel = await client.query(
        `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`,
        [table.schema, table.name]
      );
      const relkind = rel.rows[0]?.relkind;
      if (!relkind || !CLONABLE_RELKINDS.has(relkind)) {
        return {
          step: `clone_${table.name}`,
          status: 'skip',
          detail: `"${table.schema}.${table.name}" has no clonable source (relkind ${relkind || 'missing'}) - created by the plan DDL`,
        };
      }

      // Get row count
      const countResult = await client.query(`SELECT COUNT(*) AS cnt FROM ${src}`);
      const totalRows = parseInt(countResult.rows[0]?.cnt, 10) || 0;

      // Create clone with indexes, defaults, constraints
      const pkResult = await client.query(`
        SELECT array_agg(a.attname ORDER BY a.attnum) AS pk_cols
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary
      `, [`${table.schema}.${table.name}`]);
      const pkCols = pkResult.rows[0]?.pk_cols || [];

      let ddl = `CREATE TABLE ${dst} (LIKE ${src} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`;
      await client.query(ddl);

      // Copy data (sampled for large tables, full for small)
      const actualSample = totalRows > sampleSize ? sampleSize : totalRows;
      if (totalRows > 0) {
        if (totalRows <= sampleSize) {
          await client.query(`INSERT INTO ${dst} SELECT * FROM ${src}`);
        } else {
          const colsResult = await client.query(`
            SELECT array_agg(a.attname ORDER BY a.attnum) AS cols
            FROM pg_attribute a
            WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
          `, [`${table.schema}.${table.name}`]);
          const cols = colsResult.rows[0]?.cols || [];
          const colList = cols.map(c => `"${c}"`).join(', ');
          await client.query(
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

  async _testDDL(client, ddl) {
    if (!ddl || !ddl.sql) {
      return { step: 'ddl_test', status: 'skip', detail: 'No SQL to execute' };
    }
    const rewritten = this._rewriteDDL(ddl.sql);
    try {
      await client.query(rewritten);
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
    if (!sql) return sql;
    const shadow = `"${this.schemaName}"`;
    const rewriteQualified = (m) => {
      const schema = m.slice(1, -2).replace(/"/g, '');
      return (schema === this.originalSchema || schema === 'public') ? `${shadow}.` : m;
    };
    return sql
      // "public".swt_x  ->  "sw_dryrun_xxx".swt_x
      .replace(/"([^"]+)"\./g, rewriteQualified)
      // bare public.swt_x -> "sw_dryrun_xxx".swt_x (ALTER SEQUENCE uses the
      // raw objectKey without ident-quoting)
      .replace(/(^|[^."'`\w])public\./g, `$1${shadow}.`);
  }

  _extractDDL(plan) {
    const steps = plan.steps || plan.changes || [];
    return steps
      .filter(s => s.sql && s.sql.trim().length > 0)
      .map(s => ({ id: s.id, sql: s.sql, type: s.type || s.changeType }));
  }
}
