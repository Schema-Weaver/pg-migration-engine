/**
 * Schema Weaver Migration Engine - Schema Differ
 * https://schemaweaver.vivekmind.com/
 */
import crypto from 'crypto';
import { ObjectMatcher } from './object-matcher.js';
import { PropertyDiffer } from './property-differ.js';
import { DependencyResolver } from './dependency-resolver.js';
import { ChangeClassifier } from './change-classifier.js';
import { RiskTagger } from './risk-tagger.js';
import { isEngineInternalChange, isInternalObjectKey } from './utils/internal-objects.js';

export { isEngineInternalChange, isInternalObjectKey };

/**
 * Schema Differ - Main orchestrator for comparing two schema snapshots.
 * Produces a complete SchemaDiff with all changes, properly ordered and classified.
 */

export class SchemaDiffer {
  constructor(options = {}) {
    this.pgVersion = options.pgVersion || 150000;
    this.objectMatcher = new ObjectMatcher();
    this.propertyDiffer = new PropertyDiffer(this.pgVersion);
    this.dependencyResolver = new DependencyResolver();
    this.changeClassifier = new ChangeClassifier();
    this.riskTagger = new RiskTagger(this.pgVersion);
  }

  /**
   * Diff two schema snapshots (desired vs current).
   * @param {Object} desired - The desired/target schema
   * @param {Object} current - The current/live schema
   * @returns {Object} SchemaDiff
   */
  diff(desired, current) {
    const startTime = Date.now();

    // Early exit for identical schemas
    if (desired.checksum && current.checksum && desired.checksum === current.checksum) {
      return {
        summary: {
          totalChanges: 0,
          creates: 0,
          drops: 0,
          alters: 0,
          renames: 0,
          recreates: 0,
          replaces: 0,
          byTrack: { track1: { count: 0, phases: {} }, track2: { count: 0, phases: {} } },
          byPhase: {},
          byObjectType: {},
          riskSummary: { critical: 0, high: 0, medium: 0, low: 0, none: 0, categories: {} },
          requiresDowntime: false,
          estimatedDuration: '0 seconds',
        },
        changes: [],
        warnings: [],
        dependencyGraph: { nodes: [], edges: [] },
        metadata: {
          diffDuration: Date.now() - startTime,
          pgVersion: this.pgVersion,
          desiredChecksum: desired.checksum,
          currentChecksum: current.checksum,
          earlyExit: true,
        },
      };
    }

    const allChanges = [];

    // Step 1: Match objects between snapshots
    const matched = this.objectMatcher.match(desired, current);

    // Step 1.5: FK constraints nested inside desired table objects.
    // CREATE TABLE never renders FKs inline, so they are emitted as explicit
    // ADD_FOREIGN_KEY constraint changes. Running after every table create
    // (phase 10+) also makes circular FK pairs work: both tables exist before
    // either FK is added, so no DEFERRABLE tricks are needed.
    allChanges.push(...this.extractNestedForeignKeys(desired, current));

    // Step 2: Handle creates (objects only in desired)
    for (const create of matched.creates) {
      allChanges.push(this.createChangeObject('CREATE', create.objectType, create.key, null, create.object, create));
    }

    // Step 3: Handle drops (objects only in current)
    for (const drop of matched.drops) {
      allChanges.push(this.createChangeObject('DROP', drop.objectType, drop.key, drop.object, null, drop));
    }

    // Step 4: Handle detected renames
    for (const rename of matched.renames) {
      allChanges.push(this.createChangeObject('RENAME', rename.objectType, rename.key, rename, rename, rename, rename));
    }

    // Step 5: Property-level diff for matched objects
    const propertyResults = this.propertyDiffer.diff(matched.matches, desired, current);
    allChanges.push(...propertyResults.changes.map(c => {
      let pluralKey = c.objectType + 's';
      if (c.objectType === 'index') pluralKey = 'indexes';
      else if (c.objectType === 'materializedView') pluralKey = 'materializedViews';
      else if (c.objectType === 'operatorClass') pluralKey = 'operatorClasses';
      else if (c.objectType === 'operatorFamily') pluralKey = 'operatorFamilies';
      else if (c.objectType === 'defaultPrivileges') pluralKey = 'defaultPrivileges';
      else if (c.objectType === 'foreignTable') pluralKey = 'tables';
      else if (c.objectType === 'function' && desired.procedures?.[c.path]) pluralKey = 'procedures';
      else if (c.objectType === 'function' && desired.aggregates?.[c.path]) pluralKey = 'aggregates';
      else if (c.objectType === 'textSearchConfig') pluralKey = 'textSearchConfigs';
      else if (c.objectType === 'textSearchDict') pluralKey = 'textSearchDictionaries';
      else if (c.objectType === 'textSearchParser') pluralKey = 'textSearchParsers';
      else if (c.objectType === 'textSearchTemplate') pluralKey = 'textSearchTemplates';

      const beforeObj = current[pluralKey]?.[c.path] || null;
      const afterObj = desired[pluralKey]?.[c.path] || null;

      const changeObj = this.createChangeObject(
        'ALTER',
        c.objectType,
        c.path,
        beforeObj,
        afterObj,
        c,
        c.property
      );
      changeObj.currentValue = c.currentValue;
      changeObj.desiredValue = c.desiredValue;
      return changeObj;
    }));

    // Step 6: Process warnings from property differ

    // Step 6.5: Drop changes for the engine's own bookkeeping objects
    // (migration_history / migration_execution_log tables, their indexes,
    // constraints, the migration_status type, the transition-trigger
    // function/trigger) plus core/synthetic extensions (plpgsql is required
    // by the engine's own trigger functions, uuid-ossp is always reported by
    // the introspector). These objects are owned by the migration engine and
    // must never be diffed into a plan.
    const userChanges = allChanges.filter(change => !isEngineInternalChange(change));

    // Step 7: Classify changes (track 1 vs track 2)
    this.changeClassifier.classify(userChanges);

    // Step 8: Resolve dependency order
    const orderedChanges = this.dependencyResolver.resolve(userChanges, desired, current);

    // Step 9: Tag risks
    this.riskTagger.tag(orderedChanges);

    // Step 10: Build output
    return {
      summary: this.buildSummary(orderedChanges),
      changes: orderedChanges,
      warnings: [...matched.renames.filter(r => !r.confirmed).map(r => ({
        code: 'RENAME_UNCONFIRMED',
        message: `Possible rename detected: ${r.oldName} → ${r.newName}`,
        changeKey: r.key,
        action: 'Confirm rename or treat as drop+add',
      })), ...propertyResults.warnings],
      dependencyGraph: this.dependencyResolver.getGraph(),
      metadata: {
        diffDuration: Date.now() - startTime,
        pgVersion: this.pgVersion,
        desiredChecksum: desired.checksum,
        currentChecksum: current.checksum,
      },
    };
  }

  /**
   * Create a standardized change object.
   */
  createChangeObject(changeType, objectType, objectKey, before, after, extra = {}, property = null) {
    const safeObjectKey = (objectKey || '').replace(/[^a-zA-Z0-9_.]/g, '_');
    const id = `${changeType.toLowerCase()}_${objectType}_${safeObjectKey}`;
    const parts = (objectKey || '').split('.');
    const name = extra?.name || parts[parts.length - 1] || '';

    let schema = extra?.schema || (parts.length > 1 ? parts[0] : undefined);
    let tableName = extra?.tableName;
    let columnName = extra?.columnName;
    let constraintName = extra?.constraintName;
    let indexName = extra?.indexName;
    let viewName = extra?.viewName;
    let functionName = extra?.functionName;
    let triggerName = extra?.triggerName;

    if (objectType === 'column') {
      if (parts.length >= 3) {
        schema = parts[0];
        tableName = parts[1];
        columnName = parts[2];
      } else if (parts.length === 2) {
        tableName = parts[0];
        columnName = parts[1];
      }
    } else if (objectType === 'constraint') {
      if (parts.length >= 3) {
        schema = parts[0];
        tableName = parts[1];
        constraintName = parts[2];
      } else {
        constraintName = name;
      }
    } else if (objectType === 'table') {
      tableName = name;
    } else if (objectType === 'index') {
      indexName = name;
      if (parts.length >= 2) tableName = parts[0];
    } else if (objectType === 'view' || objectType === 'materializedView') {
      viewName = name;
    } else if (objectType === 'function' || objectType === 'procedure' || objectType === 'aggregate') {
      functionName = name;
    } else if (objectType === 'trigger') {
      triggerName = name;
      if (parts.length >= 3) tableName = parts[1];
    }

    let typePrefix = changeType === 'CREATE' ? 'add' : changeType === 'DROP' ? 'drop' : changeType === 'ALTER' ? 'alter' : changeType === 'RENAME' ? 'rename' : changeType;
    let typeSuffix = objectType.charAt(0).toUpperCase() + objectType.slice(1);
    let type = `${typePrefix}${typeSuffix}`;

    if (objectType === 'index') {
      if (changeType === 'CREATE') type = 'createIndex';
      if (changeType === 'DROP') type = 'dropIndex';
    }

    let normalizedChangeType = changeType;
    if (type.startsWith('add') || type.startsWith('create')) {
      normalizedChangeType = 'CREATE';
    } else if (type.startsWith('drop')) {
      normalizedChangeType = 'DROP';
    } else if (type.startsWith('rename')) {
      normalizedChangeType = 'RENAME';
    }

    const deferrable = extra?.deferrable ?? after?.deferrable ?? after?.isDeferrable ?? before?.deferrable;

    return {
      id,
      type,
      changeType: normalizedChangeType,
      objectType,
      objectKey,
      schema,
      name,
      tableName,
      columnName,
      constraintName,
      indexName,
      viewName,
      functionName,
      triggerName,
      property,
      deferrable,
      before: before || null,
      after: after || null,
      track: extra?.track || 1,
      phase: extra?.phase || 10,
      ddlStrategy: extra?.ddlStrategy || 'ALTER',
      dependencies: extra?.dependencies || [],
      dependents: [],
      risk: extra?.risk || { level: 'none', categories: [], warnings: [] },
      requiresRecreation: extra?.requiresRecreation || false,
      safePatternAvailable: extra?.safePatternAvailable || false,
      isNonTransactional: extra?.isTransactional === false,
      pgVersionMinimum: extra?.pgVersionMinimum,
      dataLossRisk: extra?.dataLossRisk,
      ...extra,
    };
  }

  /**
   * Build summary statistics.
   */
  /**
   * Extract FOREIGN KEY constraints nested inside desired table objects and
   * turn them into standalone ADD_FOREIGN_KEY constraint changes. This is the
   * only path that creates FKs from the compact table-centric desired schema
   * format (CREATE TABLE never renders FKs inline).
   */
  extractNestedForeignKeys(desired, current) {
    const changes = [];
    const currentConstraints = current.constraints || {};
    const desiredConstraints = desired.constraints || {};

    for (const [tableKey, tableObj] of Object.entries(desired.tables || {})) {
      const cons = Array.isArray(tableObj.constraints) ? tableObj.constraints : [];
      for (const con of cons) {
        if (con.constraintType !== 'FOREIGN_KEY' && con.constraintType !== 'FOREIGN KEY') continue;
        const name = con.name;
        if (!name) continue;

        const key = `${tableKey}.${name}`;
        // Already tracked via the top-level constraints section (desired or
        // current) - skip to avoid duplicates.
        if (desiredConstraints[key] || currentConstraints[key]) continue;

        const schema = tableObj.schema || tableKey.split('.')[0] || 'public';
        const tableName = tableObj.name || tableKey.split('.')[1] || '';

        // Normalize the referenced table to a full key so the dependency
        // resolver can find the referenced table's CREATE change.
        let refTable = con.referencedTable || con.refTable || '';
        if (refTable && !refTable.includes('.')) {
          refTable = `${con.referencedSchema || con.refSchema || schema}.${refTable}`;
        }

        changes.push(this.createChangeObject(
          'ADD_FOREIGN_KEY',
          'constraint',
          key,
          null,
          { ...con, name, schema, tableName, tableKey, referencedTable: refTable, constraintType: 'FOREIGN_KEY' },
          { constraintType: 'FOREIGN_KEY', name, schema, tableName, referencedTable: refTable }
        ));
      }
    }

    return changes;
  }

  buildSummary(changes) {
    const summary = {
      totalChanges: changes.length,
      creates: 0,
      drops: 0,
      alters: 0,
      renames: 0,
      recreates: 0,
      replaces: 0,

      byTrack: {
        track1: { count: 0, phases: {} },
        track2: { count: 0, phases: {} },
      },

      byPhase: {},

      byObjectType: {},

      riskSummary: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        none: 0,
        categories: {},
      },

      requiresDowntime: false,
      estimatedDuration: this.estimateDuration(changes),
    };

    for (const change of changes) {
      const ct = (change.changeType || change.type || '').toUpperCase();
      const t = (change.type || '').toLowerCase();
      // Count by change type
      if (ct.includes('CREATE') || ct.includes('ADD') || t.startsWith('add') || t.startsWith('create')) summary.creates++;
      else if (ct.includes('DROP') || t.startsWith('drop')) summary.drops++;
      else if (ct.includes('ALTER') || t.startsWith('alter')) summary.alters++;
      else if (ct.includes('RENAME') || t.startsWith('rename')) summary.renames++;
      else if (ct.includes('RECREATE')) summary.recreates++;
      else if (ct.includes('REPLACE')) summary.replaces++;

      // Count by track
      const track = change.track === 2 ? 'track2' : 'track1';
      summary.byTrack[track].count++;
      const phase = change.phase;
      if (!summary.byTrack[track].phases[phase]) {
        summary.byTrack[track].phases[phase] = 0;
      }
      summary.byTrack[track].phases[phase]++;

      // Count by phase
      if (!summary.byPhase[phase]) summary.byPhase[phase] = { count: 0, name: this.getPhaseName(phase) };
      summary.byPhase[phase].count++;

      // Count by object type
      const objType = change.objectType;
      if (!summary.byObjectType[objType]) summary.byObjectType[objType] = 0;
      summary.byObjectType[objType]++;

      // Risk counts
      const level = change.risk?.level || 'none';
      summary.riskSummary[level]++;

      for (const cat of (change.risk?.categories || [])) {
        if (!summary.riskSummary.categories[cat]) {
          summary.riskSummary.categories[cat] = 0;
        }
        summary.riskSummary.categories[cat]++;
      }

      // Check for downtime
      if (change.risk?.requiresDowntime) {
        summary.requiresDowntime = true;
      }
    }

    return summary;
  }

  /**
   * Get human-readable phase name.
   */
  getPhaseName(phase) {
    const phases = {
      1: 'pre_check',
      2: 'advisory_lock',
      3: 'extensions',
      4: 'types',
      5: 'schemas',
      6: 'tables_create',
      7: 'columns_add',
      8: 'sequences',
      9: 'indexes_create',
      10: 'constraints_non_fk',
      11: 'data_migration',
      12: 'constraints_fk',
      13: 'validate_constraints',
      14: 'views',
      15: 'materialized_views',
      16: 'functions',
      17: 'triggers',
      18: 'policies',
      19: 'rules',
      20: 'behavioral_other',
      21: 'grants',
      22: 'comments',
      23: 'indexes_concurrent',
      24: 'cleanup',
      25: 'post_check',
    };
    return phases[phase] || `phase_${phase}`;
  }

  /**
   * Estimate migration duration.
   */
  estimateDuration(changes) {
    let seconds = 0;

    for (const change of changes) {
      switch (change.objectType) {
        case 'index':
          seconds += change.isConcurrent ? 30 : 2;
          break;
        case 'constraint':
          seconds += change.constraintType === 'FOREIGN_KEY' ? 5 : 2;
          break;
        case 'table':
          seconds += change.changeType === 'CREATE' ? 1 : 2;
          break;
        case 'column':
          seconds += change.property === 'dataType' ? 10 : 1;
          break;
        case 'type':
          seconds += 2;
          break;
        case 'view':
        case 'materializedView':
          seconds += 3;
          break;
        case 'function':
          seconds += 2;
          break;
        default:
          seconds += 1;
      }
    }

    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} minutes`;
    return `${Math.ceil(seconds / 3600)} hours`;
  }
}

// Export all sub-modules
export { ObjectMatcher } from './object-matcher.js';
export { PropertyDiffer } from './property-differ.js';
export { DependencyResolver } from './dependency-resolver.js';
export { ChangeClassifier } from './change-classifier.js';
export { RiskTagger } from './risk-tagger.js';
