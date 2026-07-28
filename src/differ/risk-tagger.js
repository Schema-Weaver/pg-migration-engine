/**
 * Schema Weaver Migration Engine - Schema Differ
 * https://schemaweaver.vivekmind.com/
 */

import { isWideningCast, isSafeCast } from './utils/type-compatibility.js';

const ALL_KNOWN_OBJECT_TYPES = new Set([
  'table', 'column', 'index', 'constraint', 'sequence', 'extension', 'schema', 
  'type', 'statistics', 'collation', 'operator', 'operatorClass', 'operatorFamily', 
  'cast', 'foreignTable', 'accessMethod', 'defaultPrivileges',
  'view', 'materializedView', 'function', 'procedure', 'trigger', 'eventTrigger', 
  'policy', 'rule', 'aggregate', 'textSearchConfig', 'textSearchDict', 'conversion', 
  'textSearchParser', 'textSearchTemplate', 'foreignDataWrapper', 'foreignServer', 
  'userMapping', 'publication', 'subscription', 'language',
  'database', 'domain', 'role', 'tablespace'
]);

export class RiskTagger {
  constructor(pgVersion = 150000) {
    this.pgVersion = pgVersion;
  }

  /**
   * Tag all changes with risk information.
   */
  tag(changes) {
    for (const change of changes) {
      change.risk = this.assessRisk(change);
    }
  }

  /**
   * Assess risk for a single change.
   */
  assessRisk(change) {
    const risk = {
      level: 'none',
      categories: [],
      warnings: [],
      safePatternAvailable: false,
      requiresDowntime: false,
      estimatedDuration: null,
    };

    // Check NONE risk first (zero risk)
    if (this.isNoneRisk(change)) {
      return risk;
    }

    if (this.isCriticalRisk(change)) {
      risk.level = 'critical';
      this.addRiskCategories(risk, ['data_loss', 'irreversible']);
      risk.warnings.push(this.getCriticalWarning(change));
    }

    else if (this.isHighRisk(change)) {
      risk.level = this.upgradeRisk(risk.level, 'high');
      this.addRiskCategories(risk, ['irreversible']);
      risk.warnings.push(this.getHighWarning(change));
    }

    else if (this.isMediumRisk(change)) {
      risk.level = this.upgradeRisk(risk.level, 'medium');
      risk.warnings.push(this.getMediumWarning(change));
    }

    else if (this.isLowRisk(change)) {
      risk.level = this.upgradeRisk(risk.level, 'low');
    }

    if (this.isLockHazard(change)) {
      risk.level = this.upgradeRisk(risk.level, 'medium');
      this.addRiskCategories(risk, ['lock_hazard']);
      risk.safePatternAvailable = this.hasSafePattern(change);
      if (!risk.safePatternAvailable) {
        risk.requiresDowntime = true;
      }
    }

    if (change.pgVersionMinimum && this.pgVersion < change.pgVersionMinimum * 10000) {
      risk.level = this.upgradeRisk(risk.level, 'critical');
      this.addRiskCategories(risk, ['version_incompatible']);
      risk.warnings.push(`Requires PostgreSQL ${change.pgVersionMinimum}+. Current: ${Math.floor(this.pgVersion / 10000)}`);
    }

    if (change.property === 'dataType' && change.changeType !== 'widening') {
      if (change.changeType === 'impossible') {
        risk.level = 'critical';
        this.addRiskCategories(risk, ['impossible_cast']);
        risk.warnings.push(`No cast path from ${change.currentValue} to ${change.desiredValue}`);
      } else if (change.changeType === 'unsafe_cast' || change.changeType === 'NARROWING_CAST') {
        risk.level = this.upgradeRisk(risk.level, 'high');
        this.addRiskCategories(risk, ['unsafe_cast']);
        risk.warnings.push(`Type change ${change.currentValue} → ${change.desiredValue} may fail or lose data`);
      }
    }

    if (change.property === 'isNullable' && change.desiredValue === false && change.currentValue !== false) {
      risk.level = this.upgradeRisk(risk.level, 'medium');
      this.addRiskCategories(risk, ['constraint_violation']);
      risk.safePatternAvailable = true;
      risk.warnings.push('Adding NOT NULL may fail if NULL values exist');
    }

    if (change.objectType === 'constraint' && change.constraintType === 'FOREIGN_KEY') {
      risk.level = this.upgradeRisk(risk.level, 'medium');
      this.addRiskCategories(risk, ['lock_hazard']);
      risk.safePatternAvailable = true;
    }

    if (change.objectType === 'index' && change.changeType === 'CREATE') {
      if (!change.isConcurrent) {
        risk.level = this.upgradeRisk(risk.level, 'medium');
        this.addRiskCategories(risk, ['lock_hazard']);
        risk.safePatternAvailable = true;
        risk.warnings.push('Non-concurrent index creation locks table');
      }
    }

    if (change.changeType === 'REMOVE_ENUM_VALUES') {
      risk.level = 'critical';
      this.addRiskCategories(risk, ['data_loss', 'irreversible']);
      risk.warnings.push(`Cannot remove enum values without DROP + CREATE type`);
    }

    if (change.changeType === 'RENAME' && !change.confirmed) {
      risk.level = this.upgradeRisk(risk.level, 'medium');
      this.addRiskCategories(risk, ['rename_unconfirmed']);
      risk.warnings.push('Rename detected but not confirmed. Will be treated as drop+add if not confirmed.');
    }

    if (change.collateralDamage && change.collateralDamage.length > 0) {
      risk.level = this.upgradeRisk(risk.level, 'high');
      this.addRiskCategories(risk, ['collateral_damage']);
      risk.warnings.push(`Affects: ${change.collateralDamage.join(', ')}`);
    }

    // FIX RISK-002: ALTER TABLE SET ACCESS METHOD rewrites entire table
    if (change.objectType === 'table' && change.changeType === 'ALTER') {
      const changedProperties = change.changedProperties || (change.property ? [change.property] : []);
      if (changedProperties.includes('accessMethod')) {
        risk.level = 'critical';
        this.addRiskCategories(risk, ['table_rewrite', 'data_loss']);
        risk.warnings.push('ALTER TABLE SET ACCESS METHOD rewrites the entire table. This operation may take a long time on large tables and requires sufficient disk space.');
        risk.safePatternAvailable = false;
      }
    }

    // FIX RISK-003: DROP EXTENSION logic was inverted
    if (change.objectType === 'extension' && change.changeType === 'DROP') {
      if (change.isUsed) {
        risk.level = this.upgradeRisk(risk.level, 'high');
        this.addRiskCategories(risk, ['collateral_damage']);
        risk.warnings.push('Extension is used by other objects. Dropping will CASCADE to dependents.');
        risk.safePatternAvailable = false;
      } else {
        risk.level = 'low';
        risk.warnings = risk.warnings.filter(w => !w.includes('Extension'));
        risk.warnings.push('Extension is not used by any objects.');
      }
    }

    // FIX RISK-004: CASCADE DROP is always critical
    if (change.changeType === 'DROP' && change.cascade === true) {
      risk.level = 'critical';
      if (!risk.categories.includes('cascade_risk')) {
        this.addRiskCategories(risk, ['cascade_risk']);
      }
      const objectName = change.objectKey || change.name || 'unknown';
      risk.warnings.push(
        `CASCADE DROP on ${change.objectType} '${objectName}' may destroy dependent objects. ` +
        `Review dependent objects before proceeding.`
      );
      risk.safePatternAvailable = false;
    }

    // FIX RISK-007: Add missing risk categories

    // dependency_impact — objects that others depend on
    if (change.changeType === 'DROP' && change.isUsed) {
      if (!risk.categories.includes('dependency_impact')) {
        this.addRiskCategories(risk, ['dependency_impact']);
      }
      const depWarning = change.objectType === 'type' 
        ? 'Type is used by columns or functions. Dropping will break dependent objects.'
        : change.objectType === 'function'
        ? 'Function is used by triggers or views. Dropping will break dependent objects.'
        : `${change.objectType} is used by other objects. Dropping will break dependents.`;
      if (!risk.warnings.some(w => w.includes('used by'))) {
        risk.warnings.push(depWarning);
      }
    }

    // data_validation — ADD NOT NULL validated
    if (change.objectType === 'column' && change.changeType === 'ALTER') {
      const changedProperties = change.changedProperties || (change.property ? [change.property] : []);
      if (changedProperties.includes('isNullable') || change.property === 'isNullable') {
        if (change.desiredValue === false && change.currentValue !== false) {
          if (!risk.categories.includes('data_validation')) {
            this.addRiskCategories(risk, ['data_validation']);
          }
        }
      }
    }

    // performance_impact — operations that scan/rewrite full table
    if (change.objectType === 'index' && change.changeType === 'CREATE' && !change.isConcurrent) {
      if (!risk.categories.includes('performance_impact')) {
        this.addRiskCategories(risk, ['performance_impact']);
      }
    }
    if (change.objectType === 'column' && change.changeType === 'ALTER') {
      const changedProperties = change.changedProperties || (change.property ? [change.property] : []);
      if (changedProperties.includes('dataType') || change.property === 'dataType') {
        if (!risk.categories.includes('performance_impact')) {
          this.addRiskCategories(risk, ['performance_impact']);
        }
      }
    }
    // ACCESS METHOD already adds table_rewrite, also add performance_impact
    if (change.objectType === 'table' && change.changeType === 'ALTER') {
      const changedProperties = change.changedProperties || (change.property ? [change.property] : []);
      if (changedProperties.includes('accessMethod')) {
        if (!risk.categories.includes('performance_impact')) {
          this.addRiskCategories(risk, ['performance_impact']);
        }
      }
    }

    // reversibility — all DROP operations
    if (change.changeType === 'DROP' || change.changeType?.startsWith('DROP')) {
      const hardReverse = ['table', 'column', 'sequence'];
      const easyReverse = ['view', 'materializedView', 'function', 'procedure', 'trigger', 
                           'eventTrigger', 'policy', 'rule', 'aggregate', 'index',
                           'textSearchConfig', 'textSearchDict', 'textSearchParser', 'textSearchTemplate',
                           'conversion', 'operator', 'operatorClass', 'operatorFamily', 'cast'];
      
      if (!risk.categories.includes('reversibility')) {
        this.addRiskCategories(risk, ['reversibility']);
      }
      
      if (hardReverse.includes(change.objectType)) {
        if (!risk.warnings.some(w => w.includes('irreversible'))) {
          risk.warnings.push(`${change.objectType} drop is irreversible — data cannot be recovered.`);
        }
      }
    }

    // FIX RISK-001: Unknown object types default to "high" risk
    if (!ALL_KNOWN_OBJECT_TYPES.has(change.objectType)) {
      risk.level = this.upgradeRisk(risk.level, 'high');
      risk.warnings.push(`Unknown object type '${change.objectType}' — risk assessment may be inaccurate`);
      risk.safePatternAvailable = false;
    }

    return risk;
  }

  /**
   * Determine if this is a CRITICAL risk change.
   * Critical = data loss with no recovery path, or irreversible structural damage.
   */
  isCriticalRisk(change) {
    if (change.changeType === 'DROP' || change.changeType?.startsWith('DROP')) {
      if (change.objectType === 'table') {
        return true;
      }
      if (change.objectType === 'column') {
        return true;
      }
      if (change.objectType === 'type') {
        return true;
      }
      if (change.objectType === 'domain') {
        return true;
      }
    }
    
    if (change.changeType === 'REMOVE_ENUM_VALUES') {
      return true;
    }
    
    if (change.property === 'dataType') {
      if (change.changeType === 'impossible') {
        return true;
      }
      const info = this.getTypeChangeInfo(change.currentValue, change.desiredValue);
      if (info && info.dataLossRisk === 'critical') {
        return true;
      }
    }
    
    if (change.changeType === 'TRUNCATE') {
      return true;
    }
    
    return false;
  }

  /**
   * Determine if this is a HIGH risk change.
   * High = potential data loss, but may be recoverable or has safe patterns.
   */
  isHighRisk(change) {
    if (change.changeType === 'DROP' || change.changeType?.startsWith('DROP')) {
      if (change.objectType === 'table') {
        return true;
      }
      if (change.objectType === 'column') {
        return true;
      }
      if (change.objectType === 'type') {
        return true;
      }
      if (change.objectType === 'constraint') {
        if (change.constraintType === 'FOREIGN_KEY') {
          return true;
        }
        return true;
      }
      if (change.objectType === 'sequence') {
        return true;
      }
      if (change.objectType === 'view' || change.objectType === 'materializedView') {
        return true;
      }
      if (change.objectType === 'domain') {
        return true;
      }
      if (change.objectType === 'foreignDataWrapper' || change.objectType === 'foreignTable') {
        return true;
      }
      if (change.objectType === 'schema') {
        return true;
      }
      if (change.objectType === 'extension') {
        return true;
      }
    }
    
    if (change.changeType?.includes('RECREATE') && change.requiresRecreation) {
      return true;
    }
    
    if (change.property === 'dataType') {
      const info = this.getTypeChangeInfo(change.currentValue, change.desiredValue);
      if (info && info.dataLossRisk === 'truncation') {
        return true;
      }
    }
    
    if (change.changeType === 'DROP' && change.objectType === 'index') {
      const isConcurrent = change.isConcurrent || change.ddlStrategy === 'DROP_INDEX_CONCURRENTLY';
      if (!isConcurrent) {
        return true;
      }
    }
    
    if (change.changeType === 'ALTER' && change.objectType === 'table' &&
        change.changedProperties?.includes('schema')) {
      return true;
    }
    
    return false;
  }

  /**
   * Determine if this is a MEDIUM risk change.
   * Medium = functional impact, application breaking, but no direct data loss.
   */
  isMediumRisk(change) {
    if (change.changeType === 'DROP' || change.changeType?.startsWith('DROP')) {
      if (change.objectType === 'function' || change.objectType === 'procedure') {
        return true;
      }
      if (change.objectType === 'trigger' || change.objectType === 'eventTrigger') {
        return true;
      }
      if (change.objectType === 'policy' || change.objectType === 'rule') {
        return true;
      }
      if (change.objectType === 'index' && change.isConcurrent) {
        return true;
      }
      if (change.objectType === 'publication' || change.objectType === 'subscription') {
        return true;
      }
      if (change.objectType === 'foreignServer' || change.objectType === 'foreignTable') {
        return true;
      }
      if (change.objectType === 'language') {
        return true;
      }
      if (change.objectType === 'cast') {
        return true;
      }
    }
    
    if (change.property === 'dataType') {
      return !isWideningCast(change.currentValue, change.desiredValue);
    }
    
    if (change.property === 'isNullable' && change.desiredValue === false) {
      return true;
    }
    
    if (change.changeType === 'ALTER' && change.objectType === 'function') {
      return true;
    }
    
    if (change.changeType === 'ALTER' && change.objectType === 'table' &&
        change.changedProperties?.includes('owner')) {
      return true;
    }
    
    if (change.changeType === 'ALTER' && change.objectType === 'schema') {
      return true;
    }
    
    return false;
  }

  /**
   * Determine if this is a LOW risk change.
   * Low = cosmetic changes, no data or application impact.
   */
  isLowRisk(change) {
    if (change.changeType === 'DROP' || change.changeType?.startsWith('DROP')) {
      if (change.objectType === 'cast') return true;
      if (change.objectType === 'operator') return true;
      if (change.objectType === 'operatorClass' || change.objectType === 'operatorFamily') return true;
      if (change.objectType === 'conversion') return true;
      if (change.objectType === 'statistics') return true;
      if (change.objectType === 'collation') return true;
      if (change.objectType === 'textSearchConfig' || change.objectType === 'textSearchDict') return true;
      if (change.objectType === 'textSearchParser' || change.objectType === 'textSearchTemplate') return true;
      if (change.objectType === 'extension' && !change.isUsed) return true;
    }
    
    if (change.property === 'defaultValue') {
      return true;
    }
    
    if (change.property === 'comment') {
      return true;
    }
    
    if (change.property === 'owner') {
      return true;
    }
    
    if (change.changeType === 'RENAME' && change.confirmed) {
      return true;
    }
    
    return false;
  }

  /**
   * Determine if this is a NONE risk change (zero risk).
   * None = no impact on data or application behavior.
   */
  isNoneRisk(change) {
    if (change.property === 'comment') {
      return true;
    }
    
    if (change.property === 'owner') {
      return true;
    }
    
    if (change.changeType === 'CREATE' || change.changeType?.startsWith('ADD')) {
      if (change.objectType === 'function' || change.objectType === 'procedure') {
        return true;
      }
      if (change.objectType === 'view') {
        return true;
      }
      if (change.objectType === 'trigger') {
        return true;
      }
      if (change.objectType === 'index' && change.isConcurrent) {
        return true;
      }
      if (change.objectType === 'column' && change.isNullable !== false) {
        return true;
      }
    }
    
    if (change.objectType === 'index' && change.isConcurrent) {
      return true;
    }
    
    if (change.objectType === 'constraint' && change.isValidated === false) {
      return true;
    }
    
    return false;
  }

  addRiskCategories(risk, categories) {
    for (const cat of categories) {
      if (!risk.categories.includes(cat)) {
        risk.categories.push(cat);
      }
    }
  }

  getCriticalWarning(change) {
    if (change.objectType === 'table' && change.changeType === 'DROP') {
      return `Dropping table ${change.objectKey} will permanently delete all data`;
    }
    if (change.objectType === 'column' && change.changeType === 'DROP') {
      return `Dropping column ${change.objectKey} will lose all data in that column`;
    }
    if (change.objectType === 'type' && change.changeType === 'DROP') {
      return `Dropping type ${change.objectKey} will cascade to all columns using it`;
    }
    if (change.changeType === 'REMOVE_ENUM_VALUES') {
      return `Removing enum values will require DROP + CREATE type, affecting all columns using it`;
    }
    if (change.objectType === 'domain' && change.changeType === 'DROP') {
      return `Dropping domain ${change.objectKey} will cascade to all columns using it`;
    }
    if (change.changeType === 'TRUNCATE') {
      return `TRUNCATE ${change.objectKey} will permanently delete all data in the table`;
    }
    return 'This change may cause irreversible data loss';
  }

  getHighWarning(change) {
    if (change.objectType === 'constraint') {
      return `Dropping constraint ${change.objectKey} removes data integrity protection`;
    }
    if (change.objectType === 'index' && change.changeType === 'DROP') {
      return `Dropping index ${change.objectKey} non-blockingly will impact performance`;
    }
    if (change.objectType === 'sequence') {
      return `Dropping sequence ${change.objectKey} may break auto-generated values`;
    }
    if (change.objectType === 'view' || change.objectType === 'materializedView') {
      return `Dropping ${change.objectType} ${change.objectKey} removes query abstraction`;
    }
    if (change.property === 'dataType') {
      return `Type change ${change.currentValue} → ${change.desiredValue} may truncate data`;
    }
    if (change.objectType === 'schema' && change.changeType === 'DROP') {
      return `Dropping schema ${change.objectKey} will cascade to all objects within it`;
    }
    if (change.objectType === 'extension' && change.changeType === 'DROP') {
      return `Dropping extension ${change.objectKey} removes dependent functionality`;
    }
    if (change.objectType === 'foreignDataWrapper' || change.objectType === 'foreignTable') {
      return `Dropping ${change.objectType} ${change.objectKey} removes external data access`;
    }
    if (change.objectType === 'domain' && change.changeType === 'DROP') {
      return `Dropping domain ${change.objectKey} cascades to all columns using it`;
    }
    if (change.changeType === 'ALTER' && change.objectType === 'table' &&
        change.changedProperties?.includes('schema')) {
      return `Moving table ${change.objectKey} between schemas breaks existing references`;
    }
    return 'This change may impact data integrity';
  }

  getMediumWarning(change) {
    if (change.objectType === 'function' || change.objectType === 'procedure') {
      return `Dropping ${change.objectType} ${change.objectKey} may break application code`;
    }
    if (change.objectType === 'trigger' || change.objectType === 'eventTrigger') {
      return `Dropping trigger ${change.objectKey} disables automated behavior`;
    }
    if (change.objectType === 'policy') {
      return `Dropping policy ${change.objectKey} changes row-level security`;
    }
    if (change.objectType === 'rule') {
      return `Dropping rule ${change.objectKey} changes query behavior`;
    }
    if (change.objectType === 'index' && change.changeType === 'DROP') {
      return `Dropping index ${change.objectKey} concurrently is safer but slower`;
    }
    if (change.objectType === 'language' && change.changeType === 'DROP') {
      return `Dropping language ${change.objectKey} removes procedural language support`;
    }
    if (change.objectType === 'cast' && change.changeType === 'DROP') {
      return `Dropping cast ${change.objectKey} removes type conversion behavior`;
    }
    if (change.objectType === 'publication' || change.objectType === 'subscription') {
      return `Dropping ${change.objectType} ${change.objectKey} affects logical replication`;
    }
    if (change.objectType === 'foreignServer') {
      return `Dropping foreign server ${change.objectKey} breaks foreign table access`;
    }
    if (change.changeType === 'ALTER' && change.objectType === 'schema') {
      return `Altering schema ${change.objectKey} may affect namespace resolution`;
    }
    if (change.property === 'isNullable' && change.desiredValue === false) {
      return `Setting NOT NULL on ${change.objectKey} may cause validation failures on existing rows`;
    }
    return 'This change may have unintended side effects';
  }

  getTypeChangeInfo(fromType, toType) {
    if (!fromType || !toType) return null;
    
    try {
      const { getCastInfo } = require('./utils/type-compatibility.js');
      return getCastInfo(fromType, toType);
    } catch {
      return null;
    }
  }

  isLockHazard(change) {
    if (change.objectType === 'index' && !change.isConcurrent && change.ddlStrategy === 'CREATE_INDEX') {
      return true;
    }
    if (change.objectType === 'constraint' && change.constraintType === 'FOREIGN_KEY') {
      return true;
    }
    if (change.property === 'dataType') {
      return true;
    }
    return false;
  }

  hasSafePattern(change) {
    if (change.objectType === 'index' && !change.isConcurrent) return true;
    if (change.property === 'isNullable' && change.desiredValue === false) return true;
    if (change.objectType === 'constraint' && change.constraintType === 'FOREIGN_KEY') return true;
    return false;
  }

  upgradeRisk(current, newLevel) {
    const levels = ['none', 'low', 'medium', 'high', 'critical'];
    const currentIdx = levels.indexOf(current);
    const newIdx = levels.indexOf(newLevel);
    return levels[Math.max(currentIdx, newIdx)];
  }
}
