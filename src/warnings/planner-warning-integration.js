/**
 * Destructive Change Warning System - Planner Warning Integration
 * Integrates the warning system into the existing Planner/MigrationEngine flow
 */
import { DestructiveChangeClassifier } from './destructive-change-classifier.js';
import { DataImpactAnalyzer } from './data-impact-analyzer.js';
import { WarningFormatter } from './warning-formatter.js';

export class DestructiveWarningIntegrator {
  constructor() {
    this.classifier = new DestructiveChangeClassifier();
    this.formatter = new WarningFormatter();
    this.analyzer = null;
  }

  setPool(pool) {
    this.analyzer = new DataImpactAnalyzer(pool);
    return this;
  }

  async generateWarningReport(plan, options = {}) {
    const changes = plan.changes || plan.steps || [];
    const allOperations = [];
    const warnings = [];

    for (const change of changes) {
      if (change.type === 'pre_check' || change.type === 'advisory_lock' || 
          change.type === 'snapshot' || change.type === 'verify' ||
          change.type === 'post_check' || change.preCheck) {
        continue;
      }

      const changeForClassify = change.changeType ? change : {
        changeType: change.type?.startsWith('add') ? 'CREATE' : 
                     change.type?.startsWith('drop') ? 'DROP' : 
                     change.type?.startsWith('alter') ? 'ALTER' : 
                     change.type?.startsWith('rename') ? 'RENAME' : 'UNKNOWN',
        objectType: change.objectType || 'unknown',
        objectKey: change.objectKey || change.sql || 'unknown',
        ...change,
      };

      const classification = this.classifier.classify(changeForClassify);
      const operation = change.description || change.sql?.split('\n')[0] || `${change.changeType || change.type} ${change.objectType || ''}`;
      const target = change.objectKey || change.objectName || change.schema || 'public';

      const warning = {
        level: classification.level,
        operation: change.changeType || change.type || 'OPERATION',
        objectType: change.objectType || 'unknown',
        objectName: change.name || change.objectKey?.split('.').pop() || '',
        target: target,
        sql: change.sql || '',
        description: change.description || classification.reason,
        message: classification.reason,
        dataImpactQuery: classification.affectedRowsQuery || null,
        affectedRows: null,
        verification: null,
        reversible: change.changeType !== 'DROP',
      };

      allOperations.push(warning);

      if (classification.level !== 'safe') {
        warnings.push(warning);

          if (this.analyzer && classification.affectedRowsQuery) {
            try {
              const impactResult = await this.analyzer.analyze(changeForClassify, classification.affectedRowsQuery, classification);
              warning.affectedRows = impactResult.affectedRows;
              warning.impactResult = impactResult;
              if (impactResult.samples) {
                warning.samples = impactResult.samples;
              }

            if (classification.details) {
              const verification = await this.analyzer.verifyTypeNarrowing(changeForClassify, classification.details);
              warning.verification = verification;

              if (warning.level === 'data_risk' && verification?.willOverflow) {
                warning.level = 'data_loss';
                warning.message = `Overflow detected: ${verification.message}`;
              }
            }

            if (warning.level === 'data_loss' && warning.affectedRows === 0) {
              warning.level = 'safe';
              warning.message = `No data affected - safe to proceed (0 rows)`;
              warning.affectedRows = 0;
            }
          } catch (err) {
            warning.affectedRows = null;
            warning.queryError = err.message;
          }
        }
      } else {
        allOperations[allOperations.length - 1].affectedRows = 0;
      }
    }

    const activeWarnings = warnings.filter(w => w.level !== 'safe');
    const dataLossOps = activeWarnings.filter(w => w.level === 'data_loss');
    const dataRiskOps = activeWarnings.filter(w => w.level === 'data_risk');
    const objectDestOps = activeWarnings.filter(w => w.level === 'object_destruction');

    const report = {
      hasDestructiveChanges: activeWarnings.length > 0,
      warnings: activeWarnings,
      safeOperations: allOperations.filter(o => o.level === 'safe'),
      allOperations,
      summary: {
        totalSteps: allOperations.length,
        safeSteps: allOperations.filter(o => o.level === 'safe').length,
        dataLossSteps: dataLossOps.length,
        dataRiskSteps: dataRiskOps.length,
        objectDestructionSteps: objectDestOps.length,
      },
      planId: plan.id,
      timestamp: new Date().toISOString(),
    };

    return report;
  }

  shouldBlock(report) {
    if (options && options.acceptDataLoss) return false;
    if (options && options.force) return false;
    return report.hasDestructiveChanges;
  }

  getPromptMessage(report) {
    return `Do you want to proceed? [y/N]`;
  }
}
