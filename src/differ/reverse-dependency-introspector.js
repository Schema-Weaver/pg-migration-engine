/**
 * Schema Weaver Migration Engine - Reverse Dependency Introspector
 * https://schemaweaver.vivekmind.com/
 *
 * Layer 4: Reverse dependency introspection for DROP changes.
 *
 * The forward dependency resolver (dependency-resolver.js) only orders the
 * changes it is given — it never asks the live database what depends ON an
 * object being dropped. This module queries the PostgreSQL catalogs
 * (pg_depend, pg_constraint, pg_rewrite, pg_trigger, pg_policy, pg_attribute,
 * pg_index, pg_type, pg_proc, pg_attrdef) to find dependents of DROP targets
 * and:
 *
 *   1. adds explicit implicit DROP changes for dependents that MUST be
 *      dropped first (FK constraints pointing at a dropped table, views
 *      built on a dropped table, indexes/constraints on a dropped column,
 *      domains based on a dropped type, ...), flagged `implicitDrop: true`
 *   2. reports critical `dependency_violation` warnings for dependents that
 *      cannot be safely auto-dropped (e.g. columns of a dropped enum type,
 *      column defaults consuming a dropped sequence, functions used by
 *      surviving triggers/views)
 *
 * The planner (MigrationPlanner) subsequently orders the expanded change set
 * and assigns drop phases (behavioral 27 / constraints 28 / indexes 29 /
 * columns 30 / sequences 31 / structural 32).
 */

import { DependencyResolver } from './dependency-resolver.js';

const DEP_TYPES = {
  FK_REFERENCED_TABLE: 'fk_referenced_table',
  VIEW_DEPENDENT: 'view_dependent',
  TRIGGER_ON_TABLE: 'trigger_on_table',
  POLICY_ON_TABLE: 'policy_on_table',
  INDEX_ON_COLUMN: 'index_on_column',
  CONSTRAINT_ON_COLUMN: 'constraint_on_column',
  FK_REFERENCED_COLUMN: 'fk_referenced_column',
  VIEW_REFERENCING_COLUMN: 'view_referencing_column',
  COLUMN_USES_TYPE: 'column_uses_type',
  DOMAIN_BASED_ON_TYPE: 'domain_based_on_type',
  FUNCTION_USES_TYPE: 'function_uses_type',
  VIEW_DEPENDENT_ON_VIEW: 'view_dependent_on_view',
  TRIGGER_USES_FUNCTION: 'trigger_uses_function',
  VIEW_USES_FUNCTION: 'view_uses_function',
  DEFAULT_USES_SEQUENCE: 'default_uses_sequence',
  OBJECT_IN_SCHEMA: 'object_in_schema',
};

// Dep types that resolve automatically when the drop target goes (the
// dependents are cascade targets of DROP ... CASCADE), vs. dependents that
// block the drop and require explicit user action.
const CASCADE_DEP_TYPES = new Set([
  DEP_TYPES.TRIGGER_ON_TABLE,
  DEP_TYPES.POLICY_ON_TABLE,
  DEP_TYPES.OBJECT_IN_SCHEMA,
]);

export class ReverseDependencyIntrospector {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Expand a change list with implicit DROP changes for reverse dependents.
   *
   * @param {Array<Object>} changes - SchemaDiff changes
   * @param {Object} [options]
   * @param {boolean} [options.includeColumnDropsForType=false] - Also emit
   *   DROP COLUMN changes for columns using a dropped type (destructive —
   *   default is to warn only)
   * @returns {Promise<{changes: Array, additions: Array, warnings: Array, assessments: Array}>}
   */
  async expandDropChanges(changes, options = {}) {
    const additions = [];
    const warnings = [];
    const assessments = [];

    for (const change of changes) {
      const changeType = String(change.changeType || '').toUpperCase();
      if (changeType !== 'DROP' && !changeType.startsWith('REMOVE')) {
        continue;
      }

      let result;
      try {
        result = await this.introspectDependents(change, options);
      } catch (error) {
        warnings.push({
          level: 'medium',
          category: 'dependency_introspection_failed',
          changeKey: change.objectKey,
          message: `Could not introspect reverse dependencies for ${change.objectKey}: ${error.message}`,
        });
        continue;
      }

      if (!result) continue;

      // Risk assessment for this drop target
      assessments.push({
        changeKey: change.objectKey,
        changeType,
        dependents: result.additions.map(a => a.detail || a.objectKey),
        blockingDependents: result.warnings.map(w => w.detail || w.objectKey),
        totalDependents: result.additions.length + result.warnings.length,
        resolved: result.additions.length > 0 ? 'implicit_drops_added' : 'none',
      });

      for (const warning of result.warnings) {
        warnings.push({
          level: 'critical',
          category: 'dependency_violation',
          changeKey: change.objectKey,
          message: this._warningMessage(change, warning),
          ...warning,
        });
      }

      for (const dep of result.additions) {
        const existing = changes.some(c =>
          c.objectType === dep.objectType &&
          c.objectKey === dep.objectKey &&
          String(c.changeType || '').toUpperCase() === 'DROP'
        );
        if (existing) continue;

        const addition = this._makeAddition(change, dep);
        additions.push(addition);
      }
    }

    return {
      changes: [...changes, ...additions],
      additions,
      warnings,
      assessments,
    };
  }

  /**
   * Introspect dependents of a single DROP change.
   *
   * @param {Object} change
   * @param {Object} [options]
   * @returns {Promise<{additions: Array, warnings: Array}>}
   */
  async introspectDependents(change, options = {}) {
    const objectType = change.objectType;
    const objectKey = change.objectKey;

    switch (objectType) {
      case 'table':
        return this._tableDependents(change);
      case 'column':
        return this._columnDependents(change);
      case 'type':
      case 'domain':
        return this._typeDependents(change, options);
      case 'view':
      case 'materializedView':
        return this._viewDependents(change);
      case 'function':
      case 'procedure':
        return this._functionDependents(change);
      case 'sequence':
        return this._sequenceDependents(change);
      case 'schema':
        return this._schemaDependents(change);
      case 'constraint':
      case 'index':
      case 'trigger':
      case 'policy':
      case 'extension':
      case 'rule':
      default:
        return { additions: [], warnings: [] };
    }
  }

  /**
   * Assess drop risk for all DROP changes (no mutation).
   * @param {Array<Object>} changes
   * @returns {Promise<Array<Object>>} Risk findings
   */
  async assessDropRisk(changes) {
    const findings = [];
    for (const change of changes) {
      const changeType = String(change.changeType || '').toUpperCase();
      if (changeType !== 'DROP' && !changeType.startsWith('REMOVE')) continue;

      const result = await this.introspectDependents(change, {});
      const total = result.additions.length + result.warnings.length;
      if (total === 0) continue;

      findings.push({
        level: result.warnings.length > 0 ? 'critical' : 'high',
        category: 'dependency_violation',
        changeKey: change.objectKey,
        objectType: change.objectType,
        message: `Cannot drop ${change.objectKey}: ${total} dependent object(s) found`,
        dependents: [
          ...result.additions.map(a => ({ objectKey: a.objectKey, kind: 'implicit_drop', ...a })),
          ...result.warnings.map(w => ({ objectKey: w.objectKey, kind: 'requires_review', ...w })),
        ],
        options: result.warnings.length > 0
          ? ['drop_or_migrate_dependents_first', 'cascade_with_review']
          : ['dependents_will_be_dropped_implicitly'],
        blocking: result.warnings.length > 0,
      });
    }
    return findings;
  }

  // ============================================================
  // Per-object-type introspection
  // ============================================================

  /**
   * Dependents of a DROP TABLE:
   *   additions: FK constraints from other tables, views/matviews on it
   *   warnings:  triggers/policies/indexes on the table (cascade targets)
   */
  async _tableDependents(change) {
    const additions = [];
    const warnings = [];

    const fks = await this._query(`
      SELECT n.nspname AS schema, rc.relname AS table_name, c.conname,
             rn.nspname AS ref_schema, refc.relname AS ref_table
      FROM pg_constraint c
      JOIN pg_class rc ON rc.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = rc.relnamespace
      JOIN pg_class refc ON refc.oid = c.confrelid
      JOIN pg_namespace rn ON rn.oid = refc.relnamespace
      WHERE c.contype = 'f'
        AND c.confrelid = $1::regclass
        AND c.conrelid <> c.confrelid
    `, [change.objectKey]);

    for (const fk of fks) {
      additions.push({
        objectType: 'constraint',
        constraintType: 'FOREIGN_KEY',
        objectKey: `${fk.schema}.${fk.table_name}.${fk.conname}`,
        name: fk.conname,
        schema: fk.schema,
        tableKey: `${fk.schema}.${fk.table_name}`,
        referencedTable: `${fk.ref_schema}.${fk.ref_table}`,
        depType: DEP_TYPES.FK_REFERENCED_TABLE,
        detail: `FK constraint ${fk.schema}.${fk.table_name}.${fk.conname} references ${change.objectKey}`,
      });
    }

    const views = await this._query(`
      SELECT DISTINCT dn.nspname AS schema, dc.relname AS name, dc.relkind AS kind
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class dc ON dc.oid = r.ev_class
      JOIN pg_namespace dn ON dn.oid = dc.relnamespace
      WHERE d.refobjid = $1::regclass
        AND d.deptype IN ('normal', 'internal')
        AND r.ev_class <> $1::regclass
        AND dc.relkind IN ('v', 'm')
    `, [change.objectKey]);

    for (const view of views) {
      const objectType = view.kind === 'm' ? 'materializedView' : 'view';
      additions.push({
        objectType,
        objectKey: `${view.schema}.${view.name}`,
        name: view.name,
        schema: view.schema,
        depType: DEP_TYPES.VIEW_DEPENDENT,
        detail: `${objectType} ${view.schema}.${view.name} depends on ${change.objectKey}`,
      });
    }

    const triggers = await this._query(`
      SELECT n.nspname AS schema, c.relname AS table_name, t.tgname AS name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal
    `, [change.objectKey]);

    for (const trg of triggers) {
      warnings.push({
        objectType: 'trigger',
        objectKey: `${trg.schema}.${trg.table_name}.${trg.name}`,
        name: trg.name,
        schema: trg.schema,
        tableName: `${trg.schema}.${trg.table_name}`,
        depType: DEP_TYPES.TRIGGER_ON_TABLE,
        detail: `trigger ${trg.schema}.${trg.table_name}.${trg.name} will be cascaded`,
      });
    }

    const policies = await this._query(`
      SELECT n.nspname AS schema, c.relname AS table_name, p.polname AS name
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE p.polrelid = $1::regclass
    `, [change.objectKey]);

    for (const pol of policies) {
      warnings.push({
        objectType: 'policy',
        objectKey: `${pol.schema}.${pol.table_name}.${pol.name}`,
        name: pol.name,
        schema: pol.schema,
        table: `${pol.schema}.${pol.table_name}`,
        depType: DEP_TYPES.POLICY_ON_TABLE,
        detail: `policy ${pol.schema}.${pol.table_name}.${pol.name} will be cascaded`,
      });
    }

    return { additions, warnings };
  }

  /**
   * Dependents of a DROP COLUMN (schema.table.column):
   *   additions: indexes using it, constraints using it, FKs referencing it,
   *              views referencing it
   */
  async _columnDependents(change) {
    const additions = [];
    const parts = (change.objectKey || '').split('.');
    if (parts.length < 3) return { additions, warnings: [] };

    const schemaName = parts[0];
    const tableName = parts.slice(1, -1).join('.');
    const columnName = parts[parts.length - 1];

    const tableOid = await this._query(`
      SELECT c.oid FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = $2 AND n.nspname = $1
    `, [schemaName, tableName]);

    if (tableOid.length === 0) return { additions, warnings: [] };
    const oid = tableOid[0].oid;

    const column = await this._query(`
      SELECT attnum FROM pg_attribute
      WHERE attrelid = $1 AND attname = $2 AND attnum > 0 AND NOT attisdropped
    `, [oid, columnName]);

    if (column.length === 0) return { additions, warnings: [] };
    const attnum = column[0].attnum;

    const indexes = await this._query(`
      SELECT n.nspname AS schema, ic.relname AS name, t.relname AS table_name
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = ic.relnamespace
      JOIN pg_class t ON t.oid = i.indrelid
      WHERE i.indrelid = $1
        AND $2 = ANY (i.indkey::int2[])
    `, [oid, attnum]);

    for (const idx of indexes) {
      additions.push({
        objectType: 'index',
        objectKey: `${idx.schema}.${idx.name}`,
        name: idx.name,
        schema: idx.schema,
        table: `${idx.schema}.${idx.table_name}`,
        depType: DEP_TYPES.INDEX_ON_COLUMN,
        detail: `index ${idx.schema}.${idx.name} uses column ${change.objectKey}`,
      });
    }

    const constraints = await this._query(`
      SELECT n.nspname AS schema, t.relname AS table_name, c.conname AS name, c.contype
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.conrelid = $1
        AND $2 = ANY (c.conkey)
        AND c.contype <> 'f'
    `, [oid, attnum]);

    for (const con of constraints) {
      additions.push({
        objectType: 'constraint',
        constraintType: this._constraintTypeName(con.contype),
        objectKey: `${con.schema}.${con.table_name}.${con.name}`,
        name: con.name,
        schema: con.schema,
        tableKey: `${con.schema}.${con.table_name}`,
        depType: DEP_TYPES.CONSTRAINT_ON_COLUMN,
        detail: `constraint ${con.schema}.${con.table_name}.${con.name} uses column ${change.objectKey}`,
      });
    }

    const refFks = await this._query(`
      SELECT n.nspname AS schema, rc.relname AS table_name, c.conname AS name
      FROM pg_constraint c
      JOIN pg_class rc ON rc.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = rc.relnamespace
      WHERE c.contype = 'f'
        AND c.confrelid = $1
        AND $2 = ANY (c.confkey)
    `, [oid, attnum]);

    for (const fk of refFks) {
      additions.push({
        objectType: 'constraint',
        constraintType: 'FOREIGN_KEY',
        objectKey: `${fk.schema}.${fk.table_name}.${fk.name}`,
        name: fk.name,
        schema: fk.schema,
        tableKey: `${fk.schema}.${fk.table_name}`,
        referencedTable: change.objectKey.slice(0, change.objectKey.lastIndexOf('.')),
        depType: DEP_TYPES.FK_REFERENCED_COLUMN,
        detail: `FK constraint ${fk.schema}.${fk.table_name}.${fk.name} references column ${change.objectKey}`,
      });
    }

    const views = await this._query(`
      SELECT DISTINCT dn.nspname AS schema, dc.relname AS name, dc.relkind AS kind
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class dc ON dc.oid = r.ev_class
      JOIN pg_namespace dn ON dn.oid = dc.relnamespace
      WHERE d.refobjid = $1
        AND d.refobjsubid = $2
        AND dc.relkind IN ('v', 'm')
    `, [oid, attnum]);

    for (const view of views) {
      const objectType = view.kind === 'm' ? 'materializedView' : 'view';
      additions.push({
        objectType,
        objectKey: `${view.schema}.${view.name}`,
        name: view.name,
        schema: view.schema,
        depType: DEP_TYPES.VIEW_REFERENCING_COLUMN,
        detail: `${objectType} ${view.schema}.${view.name} uses column ${change.objectKey}`,
      });
    }

    return { additions, warnings: [] };
  }

  /**
   * Dependents of a DROP TYPE / DROP DOMAIN:
   *   additions: domains based on the type
   *   warnings:  columns using the type (destructive — user review),
   *              functions using the type (blocking)
   */
  async _typeDependents(change, options = {}) {
    const additions = [];
    const warnings = [];

    const domains = await this._query(`
      SELECT dn.nspname AS schema, dt.typname AS name
      FROM pg_type dt
      JOIN pg_namespace dn ON dn.oid = dt.typnamespace
      WHERE dt.typbasetype = $1::regtype
        AND dt.typtype = 'd'
    `, [change.objectKey]);

    for (const dom of domains) {
      additions.push({
        objectType: 'domain',
        objectKey: `${dom.schema}.${dom.name}`,
        name: dom.name,
        schema: dom.schema,
        depType: DEP_TYPES.DOMAIN_BASED_ON_TYPE,
        detail: `domain ${dom.schema}.${dom.name} is based on ${change.objectKey}`,
      });
    }

    const columns = await this._query(`
      SELECT n.nspname AS schema, t.relname AS table_name, a.attname AS name
      FROM pg_attribute a
      JOIN pg_class t ON t.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE a.attnum > 0
        AND NOT a.attisdropped
        AND a.atttypid IN (
          $1::regtype,
          (SELECT typarray FROM pg_type WHERE oid = $1::regtype)
        )
    `, [change.objectKey]);

    for (const col of columns) {
      const warning = {
        objectType: 'column',
        objectKey: `${col.schema}.${col.table_name}.${col.name}`,
        name: col.name,
        schema: col.schema,
        tableKey: `${col.schema}.${col.table_name}`,
        depType: DEP_TYPES.COLUMN_USES_TYPE,
        detail: `column ${col.schema}.${col.table_name}.${col.name} uses type ${change.objectKey}`,
      };
      if (options.includeColumnDropsForType) {
        additions.push({ ...warning, implicitDestructive: true });
      } else {
        warnings.push(warning);
      }
    }

    const functions = await this._query(`
      SELECT DISTINCT n.nspname AS schema, p.proname AS name,
             pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_depend d
      JOIN pg_proc p ON p.oid = d.objid
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE d.refobjid = $1::regtype
        AND d.classid = 'pg_proc'::regclass
        AND d.deptype IN ('normal', 'internal')
    `, [change.objectKey]);

    for (const fn of functions) {
      warnings.push({
        objectType: 'function',
        objectKey: `${fn.schema}.${fn.name}`,
        name: fn.name,
        schema: fn.schema,
        argumentTypes: fn.args ? fn.args.split(',').map(a => a.trim()) : [],
        depType: DEP_TYPES.FUNCTION_USES_TYPE,
        detail: `function ${fn.schema}.${fn.name}(${fn.args || ''}) uses type ${change.objectKey}`,
      });
    }

    return { additions, warnings };
  }

  /**
   * Dependents of a DROP VIEW / DROP MATERIALIZED VIEW:
   *   additions: views/matviews built on it
   */
  async _viewDependents(change) {
    const additions = [];

    const views = await this._query(`
      SELECT DISTINCT dn.nspname AS schema, dc.relname AS name, dc.relkind AS kind
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class dc ON dc.oid = r.ev_class
      JOIN pg_namespace dn ON dn.oid = dc.relnamespace
      WHERE d.refobjid = $1::regclass
        AND d.deptype IN ('normal', 'internal')
        AND r.ev_class <> $1::regclass
        AND dc.relkind IN ('v', 'm')
    `, [change.objectKey]);

    for (const view of views) {
      const objectType = view.kind === 'm' ? 'materializedView' : 'view';
      additions.push({
        objectType,
        objectKey: `${view.schema}.${view.name}`,
        name: view.name,
        schema: view.schema,
        depType: DEP_TYPES.VIEW_DEPENDENT_ON_VIEW,
        detail: `${objectType} ${view.schema}.${view.name} depends on ${change.objectKey}`,
      });
    }

    return { additions, warnings: [] };
  }

  /**
   * Dependents of a DROP FUNCTION / DROP PROCEDURE:
   *   additions: triggers calling it (on surviving tables)
   *   warnings:  views using it
   */
  async _functionDependents(change) {
    const additions = [];
    const warnings = [];

    const fn = await this._query(`
      SELECT p.oid, p.pronamespace, n.nspname AS schema, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname || '.' || p.proname = $1
        OR n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = $1
    `, [change.objectKey]);

    if (fn.length === 0) return { additions, warnings: [] };
    const fnOid = fn[0].oid;

    const triggers = await this._query(`
      SELECT n.nspname AS schema, c.relname AS table_name, t.tgname AS name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE t.tgfoid = $1 AND NOT t.tgisinternal
    `, [fnOid]);

    for (const trg of triggers) {
      additions.push({
        objectType: 'trigger',
        objectKey: `${trg.schema}.${trg.table_name}.${trg.name}`,
        name: trg.name,
        schema: trg.schema,
        tableName: `${trg.schema}.${trg.table_name}`,
        depType: DEP_TYPES.TRIGGER_USES_FUNCTION,
        detail: `trigger ${trg.schema}.${trg.table_name}.${trg.name} calls ${change.objectKey}`,
      });
    }

    const views = await this._query(`
      SELECT DISTINCT dn.nspname AS schema, dc.relname AS name, dc.relkind AS kind
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_class dc ON dc.oid = r.ev_class
      JOIN pg_namespace dn ON dn.oid = dc.relnamespace
      WHERE d.refobjid = $1
        AND d.classid = 'pg_proc'::regclass
        AND dc.relkind IN ('v', 'm')
    `, [fnOid]);

    for (const view of views) {
      const objectType = view.kind === 'm' ? 'materializedView' : 'view';
      warnings.push({
        objectType,
        objectKey: `${view.schema}.${view.name}`,
        name: view.name,
        schema: view.schema,
        depType: DEP_TYPES.VIEW_USES_FUNCTION,
        detail: `${objectType} ${view.schema}.${view.name} calls ${change.objectKey}`,
      });
    }

    return { additions, warnings };
  }

  /**
   * Dependents of a DROP SEQUENCE:
   *   warnings: column defaults consuming nextval (dropping breaks them),
   *             owned-by columns (auto-dropped — informational)
   */
  async _sequenceDependents(change) {
    const warnings = [];

    const defaults = await this._query(`
      SELECT n.nspname AS schema, t.relname AS table_name, a.attname AS name, ad.adsrc
      FROM pg_attrdef ad
      JOIN pg_depend d ON d.objid = ad.oid AND d.refobjid = $1::regclass
      JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
      JOIN pg_class t ON t.oid = ad.adrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
    `, [change.objectKey]);

    for (const def of defaults) {
      warnings.push({
        objectType: 'column',
        objectKey: `${def.schema}.${def.table_name}.${def.name}`,
        name: def.name,
        schema: def.schema,
        tableKey: `${def.schema}.${def.table_name}`,
        depType: DEP_TYPES.DEFAULT_USES_SEQUENCE,
        detail: `column default nextval() on ${def.schema}.${def.table_name}.${def.name} consumes ${change.objectKey}`,
      });
    }

    return { additions: [], warnings };
  }

  /**
   * Dependents of a DROP SCHEMA:
   *   warnings: objects inside the schema (informational; DROP SCHEMA CASCADE)
   */
  async _schemaDependents(change) {
    const warnings = [];

    const objects = await this._query(`
      SELECT n.nspname AS schema,
             c.relname AS name,
             CASE c.relkind
               WHEN 'r' THEN 'table' WHEN 'v' THEN 'view'
               WHEN 'm' THEN 'materializedView' WHEN 'S' THEN 'sequence'
               WHEN 'i' THEN 'index' WHEN 'I' THEN 'index'
               WHEN 'f' THEN 'foreignTable'
               ELSE 'relation' END AS object_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'v', 'm', 'S', 'i', 'I', 'f')
      ORDER BY c.relname
    `, [change.objectKey]);

    const types = await this._query(`
      SELECT n.nspname AS schema, t.typname AS name,
             CASE t.typtype
               WHEN 'e' THEN 'type' WHEN 'd' THEN 'domain'
               WHEN 'c' THEN 'type' WHEN 'r' THEN 'type'
               WHEN 'b' THEN 'type' ELSE 'type' END AS object_type
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1
        AND t.typtype IN ('e', 'd', 'c', 'r')
        AND t.typrelid = 0
    `, [change.objectKey]);

    for (const obj of [...objects, ...types]) {
      warnings.push({
        objectType: obj.object_type,
        objectKey: `${obj.schema}.${obj.name}`,
        name: obj.name,
        schema: obj.schema,
        depType: DEP_TYPES.OBJECT_IN_SCHEMA,
        detail: `${obj.object_type} ${obj.schema}.${obj.name} will be cascaded by DROP SCHEMA`,
      });
    }

    return { additions: [], warnings };
  }

  // ============================================================
  // Helpers
  // ============================================================

  async _query(sql, params) {
    if (!this.pool) {
      throw new Error('ReverseDependencyIntrospector requires a pool');
    }
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  /**
   * Human-readable message for a blocking/cascade dependent warning.
   */
  _warningMessage(dropChange, warning) {
    if (CASCADE_DEP_TYPES.has(warning.depType)) {
      return `Cannot drop ${dropChange.objectKey}: ${warning.detail || warning.objectKey}`;
    }
    return `Cannot drop ${dropChange.objectKey}: ${warning.detail || warning.objectKey}. Drop or migrate the dependent first.`;
  }

  /**
   * Assign the same phase numbering the differ's forward resolver uses, so
   * implicit additions interleave correctly with diff changes (e.g. the
   * FK constraint drop at phase 12 runs before the DROP TABLE at phase 24).
   */
  _additionPhase(addition) {
    if (!this._phaseResolver) {
      this._phaseResolver = new DependencyResolver();
    }
    return this._phaseResolver.computePhase(addition);
  }

  _makeAddition(dropChange, dep) {
    const addition = {
      changeType: 'DROP',
      objectType: dep.objectType,
      objectKey: dep.objectKey,
      name: dep.name,
      schema: dep.schema,
      detail: dep.detail,
      depType: dep.depType,
      implicitDrop: true,
      implicitDependencyOf: dropChange.objectKey,
      before: {
        name: dep.name,
        objectKey: dep.objectKey,
        schema: dep.schema,
      },
    };

    if (dep.objectType === 'constraint') {
      addition.constraintType = dep.constraintType || 'CHECK';
      addition.tableKey = dep.tableKey;
      addition.referencedTable = dep.referencedTable;
      addition.before.tableKey = dep.tableKey;
      addition.before._tableKey = dep.tableKey;
      addition.before.constraintType = addition.constraintType;
    }
    if (dep.objectType === 'trigger') {
      addition.tableName = dep.tableName;
      addition.before.tableName = dep.tableName;
    }
    if (dep.objectType === 'policy') {
      addition.table = dep.table;
      addition.before.table = dep.table;
    }
    if (dep.objectType === 'index') {
      addition.table = dep.table;
      addition.before.table = dep.table;
    }
    if (dep.objectType === 'column') {
      addition.tableKey = dep.tableKey;
    }
    if (dep.objectType === 'function' || dep.objectType === 'procedure') {
      addition.argumentTypes = dep.argumentTypes || [];
      addition.before.argumentTypes = addition.argumentTypes;
    }
    if (dep.implicitDestructive) {
      addition.implicitDestructive = true;
    }

    addition.phase = this._additionPhase(addition);

    return addition;
  }

  _constraintTypeName(contype) {
    switch (contype) {
      case 'p': return 'PRIMARY_KEY';
      case 'u': return 'UNIQUE';
      case 'f': return 'FOREIGN_KEY';
      case 'c': return 'CHECK';
      case 'x': return 'EXCLUSION';
      default: return 'CHECK';
    }
  }
}

export { DEP_TYPES };
