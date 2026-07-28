/**
 * Schema Weaver Migration Engine - Migration Planner
 * https://schemaweaver.vivekmind.com/
 */
import crypto from 'crypto';
import { SmartMigrator } from './smart-migrator.js';
import { BackfillPlanner } from './backfill-planner.js';
import { StepSequencer } from './step-sequencer.js';
import { DdlGenerator } from '../ddl-generator/statement-factory.js';

const DROP_PHASES = {
  behavioral: 27,
  constraints: 28,
  indexes: 29,
  columns: 30,
  sequences: 31,
  structural: 32,
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class MigrationPlanner {
  constructor() {
    this.smartMigrator = new SmartMigrator();
    this.backfillPlanner = new BackfillPlanner();
    this.sequencer = new StepSequencer();
  }

  correlateRenames(changes) {
    const renameMap = new Map();
    for (const change of changes) {
      if (change.changeType === 'RENAME') {
        const oldKey = change.objectKey;
        const schema = change.schema || oldKey.split('.')[0] || 'public';
        const renameTo = change.renameTo || change.after?.name;
        if (renameTo) {
          const newKey = this.buildObjectKey(change.objectType, renameTo, schema);
          renameMap.set(oldKey, {
            newKey,
            renameChange: change,
            objectType: change.objectType,
            oldName: change.before?.name || oldKey.split('.').pop(),
            newName: renameTo,
          });
        }
      }
    }
    for (const [oldKey, renameInfo] of renameMap) {
      for (const [otherOldKey, otherRenameInfo] of renameMap) {
        if (renameInfo.newKey === otherOldKey && oldKey !== otherOldKey) {
          const secondRename = otherRenameInfo.renameChange;
          const firstRename = renameInfo.renameChange;
          if (!secondRename.dependencies) secondRename.dependencies = [];
          if (firstRename.id && !secondRename.dependencies.includes(firstRename.id)) {
            secondRename.dependencies.push(firstRename.id);
          }
        }
      }
    }
    for (const change of changes) {
      const changeType = change.changeType?.toUpperCase();
      if (changeType === 'ALTER') {
        for (const [oldKey, renameInfo] of renameMap) {
          if (change.objectKey === renameInfo.newKey) {
            if (!change.dependencies) change.dependencies = [];
            const renameId = renameInfo.renameChange.id;
            if (renameId && !change.dependencies.includes(renameId)) {
              change.dependencies.push(renameId);
            }
          }
        }
      }
    }
    for (const change of changes) {
      if (change.changeType === 'RENAME' && change.objectType === 'column') {
        const renameInfo = renameMap.get(change.objectKey);
        if (renameInfo) {
          const tableKey = change.objectKey.substring(0, change.objectKey.lastIndexOf('.'));
          const oldColName = renameInfo.oldName;
          const newColName = renameInfo.newName;
          if (oldColName && newColName) {
            const newColumnKey = `${tableKey}.${newColName}`;
            for (const alterChange of changes) {
              const alterChangeType = alterChange.changeType?.toUpperCase();
              if (alterChangeType === 'ALTER' && alterChange.objectKey === newColumnKey) {
                if (!alterChange.dependencies) alterChange.dependencies = [];
                const renameId = change.id;
                if (renameId && !alterChange.dependencies.includes(renameId)) {
                  alterChange.dependencies.push(renameId);
                }
              }
            }
          }
        }
      }
    }
  }

  buildObjectKey(objectType, name, schema) {
    return `${schema}.${name}`;
  }

  /**
   * @param {import('../types/changes.js').SchemaChange[]|import('../types/changes.js').SchemaDiff} changes
   * @param {import('../types/execution.js').PlanOptions} options
   * @returns {import('../types/migration.js').MigrationPlan}
   */
  createPlan(changes, options = {}) {
    const changesArray = Array.isArray(changes) ? changes : (changes.changes || []);
    const warnings = Array.isArray(changes) ? [] : (changes.warnings || []);

    const generator = new DdlGenerator();
    for (const change of changesArray) {
      if (!change.sql) {
        change.sql = generator.generate([change], options);
      }
    }

    this.correlateRenames(changesArray);
    
    const steps = [];
    let stepId = 1;

    steps.push({
      id: `step_${String(stepId++).padStart(3, '0')}`,
      type: 'pre_check',
      phase: 0,
      description: 'Pre-flight validation',
      sql: 'SELECT 1;',
      isTransactional: true,
      riskLevel: 'none',
      dependencies: [],
    });

    // Note: Advisory lock acquisition is now handled by MigrationExecutor
    // The step below is a legacy placeholder. The actual lock is acquired
    // before any migration steps are executed.
    // This step can be safely removed in a future version.
    steps.push({
      id: `step_${String(stepId++).padStart(3, '0')}`,
      type: 'advisory_lock',
      phase: 1,
      description: '[DEPRECATED] Advisory lock placeholder - lock is acquired by executor',
      sql: 'SELECT 1 as lock_placeholder;',
      isTransactional: true,
      riskLevel: 'none',
      dependencies: [`step_001`],
      deprecated: true,
      note: 'Actual advisory lock acquisition is handled by MigrationExecutor.acquireAdvisoryLock()',
    });

    const phases = {};
    for (const change of changesArray) {
      const phase = change.phase || this.mapChangeToPhase(change);
      if (!phases[phase]) phases[phase] = [];
      phases[phase].push(change);
    }

    const phaseOrder = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
    
    for (const phaseNum of phaseOrder) {
      const phaseChanges = phases[phaseNum] || [];
      for (const change of phaseChanges) {
        const smartSteps = this.smartMigrator.analyze(change);
        const changeId = change.id || `change_${stepId}`;
        
        if (smartSteps) {
          for (const s of smartSteps) {
            s.id = `step_${String(stepId++).padStart(3, '0')}`;
            s.phase = phaseNum;
            s.changeId = changeId;
            steps.push(s);
          }
        } else {
          const isConcurrentIndex = change.objectType === 'index' && 
                                    change.changeType === 'CREATE' && 
                                    (change.isConcurrent || change.isNonTransactional || phaseNum === 23);
          
          if (isConcurrentIndex) {
            const indexName = change.after?.name || change.name || change.objectKey?.split('.').pop();
            const tableName = change.after?.table || change.tableName;
            const schema = change.schema || change.objectKey?.split('.')[0] || 'public';
            
            steps.push({
              id: `step_${String(stepId++).padStart(3, '0')}`,
              type: 'pre_check',
              phase: 22,
              changeId,
              description: `Pre-check: Verify index ${indexName} does not already exist`,
              sql: `SELECT 1 FROM pg_indexes WHERE indexname = '${indexName}' AND schemaname = '${schema}'${tableName ? ` AND tablename = '${tableName}'` : ''}`,
              isTransactional: true,
              riskLevel: 'none',
              dependencies: [],
              preCheck: true,
              preCheckExpectEmpty: true,
              preCheckMessage: `Index ${indexName} already exists`,
            });
          }
          
          const step = {
            id: `step_${String(stepId++).padStart(3, '0')}`,
            type: this.mapChangeToStepType(change),
            phase: phaseNum,
            changeId,
            description: `${change.changeType} ${change.objectType} ${change.objectKey}`,
            sql: change.sql || `-- ${change.changeType} ${change.objectType} ${change.objectKey}`,
            isTransactional: change.isNonTransactional !== true,
            riskLevel: change.risk?.level || 'none',
            dependencies: (change.dependencies || []).map(d => `change_${d}`),
            track: change.track,
          };
          
          if (isConcurrentIndex) {
            const indexName = change.after?.name || change.name || change.objectKey?.split('.').pop();
            const schema = change.schema || change.objectKey?.split('.')[0] || 'public';
            step.recoverySql = `DROP INDEX IF EXISTS ${schema}.${indexName}`;
          }
          
          steps.push(step);
        }
      }
    }

    steps.push({
      id: `step_${String(stepId++).padStart(3, '0')}`,
      type: 'snapshot',
      phase: 26,
      description: 'Capture post-migration snapshot',
      sql: '-- Snapshot capture',
      isTransactional: false,
      riskLevel: 'none',
      dependencies: [`step_${String(stepId - 2).padStart(3, '0')}`],
    });

    steps.push({
      id: `step_${String(stepId++).padStart(3, '0')}`,
      type: 'verify',
      phase: 26,
      description: 'Post-migration verification',
      sql: '-- Verify schema matches target',
      isTransactional: false,
      riskLevel: 'none',
      dependencies: [`step_${String(stepId - 2).padStart(3, '0')}`],
    });

    const sequencedSteps = this.sequencer.sequence(changesArray, steps);
    const summary = Array.isArray(changes) ? this.buildSummary(changes) : changes.summary;

    const changeKeys = changesArray.map(c => c.objectKey || c.id).sort().join(',');
    const contentHash = crypto.createHash('sha256').update(changeKeys).digest('hex').slice(0, 12);

    return {
      id: `migration_${contentHash}`,
      name: options.name || `migration`,
      description: options.description,
      createdAt: null,
      sourceChecksum: options.sourceChecksum,
      targetChecksum: options.targetChecksum,
      changes: changesArray,
      warnings,
      steps: sequencedSteps,
      riskAssessment: {
        overallRisk: summary?.riskSummary ? this.getOverallRisk(summary.riskSummary) : 'none',
        findings: [],
        destructiveChanges: summary?.riskSummary?.categories?.data_loss || 0,
        dataLossChanges: summary?.riskSummary?.categories?.data_loss || 0,
        lockRiskChanges: summary?.riskSummary?.categories?.lock_hazard || 0,
        canAutoFix: Array.isArray(summary?.riskSummary?.categories) 
          ? summary.riskSummary.categories.map(c => c.safePatternAvailable).filter(Boolean).length 
          : 0,
        requiresReview: summary?.riskSummary?.categories?.rename_unconfirmed || 0,
        estimatedDowntime: summary?.requiresDowntime ? 'POTENTIAL' : 'NONE',
      },
      isReversible: this.checkReversibility(changesArray),
      summary,
    };
  }

  buildSummary(changes) {
    return {
      totalChanges: changes.length,
      creates: changes.filter(c => c.changeType === 'CREATE').length,
      drops: changes.filter(c => c.changeType === 'DROP').length,
      alters: changes.filter(c => c.changeType === 'ALTER').length,
      renames: changes.filter(c => c.changeType === 'RENAME').length,
    };
  }

  getOverallRisk(riskSummary) {
    if (riskSummary.critical > 0) return 'critical';
    if (riskSummary.high > 0) return 'high';
    if (riskSummary.medium > 0) return 'medium';
    if (riskSummary.low > 0) return 'low';
    return 'none';
  }

  mapChangeToStepType(change) {
    const objType = change.objectType;
    if (objType === 'index') return 'index';
    if (objType === 'constraint') return 'constraint';
    if (objType === 'trigger') return 'post_structural';
    if (objType === 'policy') return 'policy';
    if (objType === 'view' || objType === 'materializedView') return 'view';
    if (objType === 'function' || objType === 'procedure') return 'function';
    return 'structural';
  }

  mapChangeToPhase(change) {
    const objType = change.objectType;
    const changeType = change.changeType?.toUpperCase();
    
    if (changeType === 'DROP' || changeType?.startsWith('REMOVE')) {
      if (['trigger', 'policy', 'rule', 'eventTrigger'].includes(objType)) return DROP_PHASES.behavioral;
      if (['view', 'materializedView'].includes(objType)) return DROP_PHASES.behavioral;
      if (['function', 'procedure', 'aggregate'].includes(objType)) return DROP_PHASES.behavioral;
      if (['textSearchConfig', 'textSearchDict', 'textSearchParser', 'textSearchTemplate'].includes(objType)) return DROP_PHASES.behavioral;
      if (['conversion', 'language'].includes(objType)) return DROP_PHASES.behavioral;
      if (['foreignDataWrapper', 'foreignServer', 'userMapping'].includes(objType)) return DROP_PHASES.behavioral;
      if (['publication', 'subscription'].includes(objType)) return DROP_PHASES.behavioral;
      
      if (objType === 'constraint') return DROP_PHASES.constraints;
      
      if (objType === 'index') return DROP_PHASES.indexes;
      
      if (objType === 'column') return DROP_PHASES.columns;
      
      if (objType === 'sequence') return DROP_PHASES.sequences;
      
      if (['table', 'foreignTable'].includes(objType)) return DROP_PHASES.structural;
      if (['type', 'collation', 'operator', 'operatorClass', 'operatorFamily', 'cast'].includes(objType)) return DROP_PHASES.structural;
      if (['extension', 'schema', 'accessMethod', 'defaultPrivileges'].includes(objType)) return DROP_PHASES.structural;
      if (['statistics'].includes(objType)) return DROP_PHASES.structural;
      
      return DROP_PHASES.behavioral;
    }
    
    if (changeType === 'CREATE' || changeType?.startsWith('ADD')) {
      if (objType === 'extension') return 3;
      if (objType === 'schema') return 5;
      if (objType === 'type' || objType === 'domain') return 4;
      if (objType === 'sequence') return 5;
      if (objType === 'table') return 6;
      if (objType === 'foreignTable') return 6;
      if (objType === 'column') return 7;
      if (objType === 'index') return change.isNonTransactional || change.isConcurrent ? 23 : 9;
      if (objType === 'constraint' && change.constraintType !== 'FOREIGN_KEY') return 10;
      if (objType === 'view') return 14;
      if (objType === 'materializedView') return 15;
      if (objType === 'function' || objType === 'procedure') return 16;
      if (objType === 'trigger') return 17;
      if (objType === 'eventTrigger') return 17;
      if (objType === 'policy') return 18;
      if (objType === 'rule') return 19;
      if (objType === 'operator') return 20;
      if (objType === 'operatorClass') return 20;
      if (objType === 'operatorFamily') return 20;
      return 10;
    }
    
    if (changeType === 'ALTER') {
      if (objType === 'column') return 11;
      if (objType === 'constraint') return change.constraintType === 'FOREIGN_KEY' ? 12 : 10;
      if (objType === 'function' || objType === 'procedure') return 16;
      if (objType === 'view') return 14;
      if (objType === 'sequence') return 8;
      if (objType === 'policy') return 18;
      return 20;
    }
    
    return 10;
  }

  checkReversibility(changes) {
    return !changes.some(c => c.changeType === 'DROP' && c.objectType === 'table');
  }
}
