/**
 * Schema Weaver Migration Engine - Schema Differ
 * https://schemaweaver.vivekmind.com/
 */
import { similarity, isSimilarEnough } from './utils/levenshtein.js';
import { sameTypeFamily, typesEqual, isImplicitCast } from './utils/type-compatibility.js';
import { buildPath } from './utils/path-builder.js';
import { InputValidationError } from '../errors.js';

/**
 * Object matcher handles matching objects between two snapshots
 * and detecting potential renames.
 */

const RENAME_SIMILARITY_THRESHOLD = 0.15;
const HIGH_CONFIDENCE_THRESHOLD = 0.80;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.55;
const LOW_CONFIDENCE_THRESHOLD = 0.35;

export class ObjectMatcher {
  constructor() {
    this.logger = console;
  }

  /**
   * Match objects between desired and current snapshots.
   * @param {Object} desired - Desired schema snapshot
   * @param {Object} current - Current schema snapshot
   * @returns {Object} Match result with creates, drops, matches, and renames
   */
  match(desired, current) {
    if (!desired || !current) {
      throw new InputValidationError(
        'match() requires both desired and current schema snapshots',
        { expected: 'desired=<Object>, current=<Object>', actual: `desired=${typeof desired}, current=${typeof current}`, method: 'ObjectMatcher.match' }
      );
    }
    const result = {
      matches: [],        // Objects that exist in both (same key)
      creates: [],        // Objects only in desired
      drops: [],          // Objects only in current
      renames: [],        // Detected renames
    };

    // Match all object types
    this.matchObjects(desired.tables, current.tables, 'table', result, desired, current);
    this.matchObjects(desired.views, current.views, 'view', result, desired, current);
    this.matchObjects(desired.materializedViews, current.materializedViews, 'materializedView', result, desired, current);
    this.matchObjects(desired.functions, current.functions, 'function', result, desired, current);
    this.matchObjects(desired.procedures, current.procedures, 'procedure', result, desired, current);
    this.matchObjects(desired.aggregates, current.aggregates, 'aggregate', result, desired, current);
    this.matchObjects(desired.triggers, current.triggers, 'trigger', result, desired, current);
    this.matchObjects(desired.policies, current.policies, 'policy', result, desired, current);
    this.matchObjects(desired.sequences, current.sequences, 'sequence', result, desired, current);
    this.matchObjects(desired.types, current.types, 'type', result, desired, current);
    this.matchObjects(desired.extensions, current.extensions, 'extension', result, desired, current);
    this.matchObjects(desired.indexes, current.indexes, 'index', result, desired, current);
    this.matchObjects(desired.constraints, current.constraints, 'constraint', result, desired, current);
    this.matchObjects(desired.statistics, current.statistics, 'statistics', result, desired, current);
    this.matchObjects(desired.collations, current.collations, 'collation', result, desired, current);
    this.matchObjects(desired.operators, current.operators, 'operator', result, desired, current);
    this.matchObjects(desired.foreignServers, current.foreignServers, 'foreignServer', result, desired, current);
    this.matchObjects(desired.eventTriggers, current.eventTriggers, 'eventTrigger', result, desired, current);
    this.matchObjects(desired.rules, current.rules, 'rule', result, desired, current);
    this.matchObjects(desired.publications, current.publications, 'publication', result, desired, current);
    this.matchObjects(desired.subscriptions, current.subscriptions, 'subscription', result, desired, current);
    this.matchObjects(desired.textSearchConfigs, current.textSearchConfigs, 'textSearchConfig', result, desired, current);
    this.matchObjects(desired.textSearchDictionaries, current.textSearchDictionaries, 'textSearchDict', result, desired, current);
    this.matchObjects(desired.languages, current.languages, 'language', result, desired, current);
    // 11 missing object types
    this.matchObjects(desired.casts, current.casts, 'cast', result, desired, current);
    this.matchObjects(desired.conversions, current.conversions, 'conversion', result, desired, current);
    this.matchObjects(desired.operatorClasses, current.operatorClasses, 'operatorClass', result, desired, current);
    this.matchObjects(desired.operatorFamilies, current.operatorFamilies, 'operatorFamily', result, desired, current);
    this.matchObjects(desired.textSearchParsers, current.textSearchParsers, 'textSearchParser', result, desired, current);
    this.matchObjects(desired.textSearchTemplates, current.textSearchTemplates, 'textSearchTemplate', result, desired, current);
    this.matchObjects(desired.foreignDataWrappers, current.foreignDataWrappers, 'foreignDataWrapper', result, desired, current);
    this.matchObjects(desired.userMappings, current.userMappings, 'userMapping', result, desired, current);
    this.matchObjects(desired.foreignTables, current.foreignTables, 'foreignTable', result, desired, current);
    this.matchObjects(desired.defaultPrivileges, current.defaultPrivileges, 'defaultPrivileges', result, desired, current);
    this.matchObjects(desired.accessMethods, current.accessMethods, 'accessMethod', result, desired, current);

    // Match columns for matched tables
    const tableMatches = result.matches.filter(m => m.objectType === 'table');
    for (const tableMatch of tableMatches) {
      const tableKey = tableMatch.key;
      const desiredCols = {};
      const currentCols = {};
      
      if (Array.isArray(tableMatch.desired.columns)) {
        tableMatch.desired.columns.forEach(c => {
          desiredCols[`${tableKey}.${c.name}`] = { ...c, schema: tableMatch.desired.schema, table: tableKey };
        });
      }
      if (Array.isArray(tableMatch.current.columns)) {
        tableMatch.current.columns.forEach(c => {
          currentCols[`${tableKey}.${c.name}`] = { ...c, schema: tableMatch.current.schema, table: tableKey };
        });
      }
      
      this.matchObjects(desiredCols, currentCols, 'column', result, desired, current);
    }

    // Detect potential renames from unmatched drops and creates
    this.detectRenames(result, desired, current);

    return result;
  }

  /**
   * Match objects of a specific type.
   */
  matchObjects(desiredMap, currentMap, objectType, result, desired, current) {
    if (!desiredMap) desiredMap = {};
    if (!currentMap) currentMap = {};

    const desiredKeys = new Set(Object.keys(desiredMap));
    const currentKeys = new Set(Object.keys(currentMap));

    // Find matches (same key in both)
    for (const key of desiredKeys) {
      if (currentKeys.has(key)) {
        result.matches.push({
          key,
          objectType,
          desired: desiredMap[key],
          current: currentMap[key],
        });
      } else {
        // Only in desired - potential CREATE or rename target
        result.creates.push({
          key,
          objectType,
          object: desiredMap[key],
          schema: this.extractSchema(desiredMap[key], objectType),
          name: this.extractName(desiredMap[key], objectType, key),
          parent: this.extractParent(desiredMap[key], objectType),
        });
      }
    }

    // Find drops (in current but not in desired)
    for (const key of currentKeys) {
      if (!desiredKeys.has(key)) {
        // Skip identity sequences - they are automatically dropped when the owning column is dropped
        if (objectType === 'sequence' && currentMap[key]?.ownedBy) {
          continue;
        }
        result.drops.push({
          key,
          objectType,
          object: currentMap[key],
          schema: this.extractSchema(currentMap[key], objectType),
          name: this.extractName(currentMap[key], objectType, key),
          parent: this.extractParent(currentMap[key], objectType),
        });
      }
    }
  }

  /**
   * Detect potential renames from unmatched drops and creates.
   */
  detectRenames(result, desired, current) {
    const dropsByType = this.groupBy(result.drops, 'objectType');
    const createsByType = this.groupBy(result.creates, 'objectType');

    const detectedRenames = [];

    for (const [objectType, drops] of Object.entries(dropsByType)) {
      const creates = createsByType[objectType] || [];

      for (const drop of drops) {
        const candidates = this.findRenameCandidates(drop, creates, desired, current);

        if (candidates.length === 1) {
          const candidate = candidates[0];
          const rename = this.createRenameChange(drop, candidate, objectType);

          if (rename.confidence >= LOW_CONFIDENCE_THRESHOLD) {
            detectedRenames.push(rename);

            result.creates = result.creates.filter(c => c.key !== candidate.key);
            result.drops = result.drops.filter(d => d.key !== drop.key);
          }
        } else if (candidates.length > 1) {
          const sortedCandidates = candidates.map(c => ({
            candidate: c,
            score: this.computeRenameScore(drop, c, desired, current)
          })).sort((a, b) => b.score - a.score);

          const best = sortedCandidates[0];
          const rename = this.createRenameChange(drop, best.candidate, objectType);

          const isHighConfidence = best.score >= HIGH_CONFIDENCE_THRESHOLD;

          if (isHighConfidence) {
            detectedRenames.push(rename);

            result.creates = result.creates.filter(c => c.key !== best.candidate.key);
            result.drops = result.drops.filter(d => d.key !== drop.key);
          } else {
            rename.ambiguous = true;
            rename.candidates = candidates;
            rename.warnings = [`Multiple rename candidates detected. Best match: "${best.candidate.name}" (confidence: ${rename.confidence.toFixed(2)})`];
            detectedRenames.push(rename);
          }
        }
      }
    }

    result.renames = detectedRenames;
  }

  /**
   * Find potential rename candidates for a dropped object.
   */
  findRenameCandidates(drop, creates, desired, current) {
    return creates.filter(create => {
      // Must be same object type
      if (drop.objectType !== create.objectType) return false;

      // Must be in same schema
      if (drop.schema !== create.schema) return false;

      // Must have same parent (for child objects like columns, triggers)
      if (drop.parent && create.parent && drop.parent !== create.parent) return false;

      // Name similarity must be above threshold
      if (!isSimilarEnough(drop.name, create.name, RENAME_SIMILARITY_THRESHOLD)) return false;

      // Type compatibility check (for columns and types)
      if (!this.typesCompatible(drop, create, desired, current)) return false;

      // Structural compatibility check for indexes:
      // Reject index renames when columns don't meaningfully overlap
      if (drop.objectType === 'index' && drop.object && create.object) {
        const structScore = this.computeStructuralSimilarity(drop.object, create.object);
        if (structScore < 0.50) return false;
      }

      return true;
    });
  }

  /**
   * Create a rename change object.
   */
  createRenameChange(drop, create, objectType) {
    const nameSimilarity = similarity(drop.name, create.name);
    const confidence = this.computeRenameScore(drop, create, null, null);

    return {
      key: drop.key,
      objectType,
      schema: drop.schema,
      parent: drop.parent,
      oldKey: drop.key,
      newKey: create.key,
      oldName: drop.name,
      newName: create.name,
      renameFrom: drop.name,
      renameTo: create.name,
      isRename: true,
      changeType: 'RENAME',
      similarity: nameSimilarity,
      confidence,
      confidenceLevel: this.getConfidenceLevel(confidence),
      confirmed: false,
      confidenceDetails: {
        nameSimilarity: nameSimilarity.toFixed(3),
        finalScore: confidence.toFixed(3),
        threshold: RENAME_SIMILARITY_THRESHOLD.toFixed(2),
        highThreshold: HIGH_CONFIDENCE_THRESHOLD.toFixed(2),
        mediumThreshold: MEDIUM_CONFIDENCE_THRESHOLD.toFixed(2),
      },
      fallback: {
        drop: { key: drop.key, objectType, changeType: 'DROP' },
        create: { key: create.key, objectType, changeType: 'CREATE', object: create.object },
      },
      warnings: [],
    };
  }

  /**
   * Compute rename confidence score.
   */
  computeRenameScore(drop, create, desired, current) {
    let score = similarity(drop.name, create.name);

    const nameSim = score;

    if (drop.object && create.object) {
      const dropType = drop.object.dataType || drop.object.type || drop.object.kind;
      const createType = create.object.dataType || create.object.type || create.object.kind;

      if (dropType && createType) {
        if (typesEqual(dropType, createType)) {
          score += 0.25;
        } else if (sameTypeFamily(dropType, createType)) {
          score += 0.15;
        }
      }
    }

    if (drop.parent === create.parent && drop.parent) {
      score += 0.15;
    }

    const minLen = Math.min(drop.name.length, create.name.length);
    if (minLen < 4) {
      score -= 0.05;
    }

    if (this.isPrefixOrSuffixRename(drop.name, create.name)) {
      score += 0.25;
    }

    if (this.isSubstringRename(drop.name, create.name)) {
      score += 0.20;
    }

    if ((drop.objectType === 'table' || drop.objectType === 'column' || drop.objectType === 'index') && drop.object && create.object) {
      const structuralSimilarity = this.computeStructuralSimilarity(drop.object, create.object);
      score += 0.20 * structuralSimilarity;
    }

    if (this.isCommonRenamePattern(drop.name, create.name)) {
      score += 0.15;
    }

    if (this.hasCommonWord(drop.name, create.name)) {
      score += 0.10;
    }

    return Math.min(Math.max(score, 0), 1);
  }

  isSubstringRename(oldName, newName) {
    const oldLower = oldName.toLowerCase();
    const newLower = newName.toLowerCase();
    if (oldLower.length < 4 || newLower.length < 4) return false;
    
    if (oldLower.includes(newLower) || newLower.includes(oldLower)) {
      return true;
    }
    
    const oldParts = oldLower.split(/[_\-.]/).filter(p => p.length >= 3);
    const newParts = newLower.split(/[_\-.]/).filter(p => p.length >= 3);
    if (oldParts.length === 0 || newParts.length === 0) return false;
    
    for (const op of oldParts) {
      for (const np of newParts) {
        const shorter = op.length < np.length ? op : np;
        const longer = op.length < np.length ? np : op;
        if (longer.includes(shorter) && shorter.length >= 3) {
          return true;
        }
      }
    }
    return false;
  }

  hasCommonWord(oldName, newName) {
    const oldWords = oldName.toLowerCase().split(/[_\-.]/).filter(w => w.length >= 3);
    const newWords = newName.toLowerCase().split(/[_\-.]/).filter(w => w.length >= 3);
    for (const ow of oldWords) {
      if (newWords.includes(ow)) {
        return true;
      }
    }
    return false;
  }

  isPrefixOrSuffixRename(oldName, newName) {
    const oldLower = oldName.toLowerCase();
    const newLower = newName.toLowerCase();
    
    if (oldLower.startsWith(newLower) || newLower.startsWith(oldLower)) {
      return true;
    }
    if (oldLower.endsWith(newLower) || newLower.endsWith(oldLower)) {
      return true;
    }
    
    const oldParts = oldLower.split(/[_\-.]/);
    const newParts = newLower.split(/[_\-.]/);
    if (oldParts.length > 1 && newParts.length > 1) {
      const sharedParts = oldParts.filter(p => newParts.includes(p) && p.length > 2);
      if (sharedParts.length >= Math.min(oldParts.length, newParts.length) - 1) {
        return true;
      }
    }
    
    return false;
  }

  isCommonRenamePattern(oldName, newName) {
    const patterns = [
      [/^(.+)s$/, '$1'],  // plural to singular
      [/^(.+?)_(.+)$/, '$2_$1'],  // Swap parts
      [/^v_(.+)$/, 'vw_$1'],  // View naming
      [/^idx_(.+)$/, 'ix_$1'],  // Index naming
      [/^fk_(.+)$/, 'fk_$1_ref'],  // FK naming
      [/^get_(.+)$/, 'fetch_$1'],  // Function naming
      [/^get_(.+)$/, 'get_$1_data'],  // Function with suffix
      [/(.+)s$/, '$1_list'],  // plural to _list
      [/(.+)_id$/, '$1_ref'],  // _id to _ref
    ];
    
    for (const [pattern] of patterns) {
      if (pattern.test(oldName) && pattern.test(newName)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Compute structural similarity between two objects.
   */
  computeStructuralSimilarity(objA, objB) {
    // For columns
    if (objA.dataType && objB.dataType) {
      let score = sameTypeFamily(objA.dataType, objB.dataType) ? 1 : 0;
      if (objA.isNullable === objB.isNullable) score += 0.25;
      if (objA.defaultValue === objB.defaultValue) score += 0.25;
      return Math.min(score, 1);
    }

    // For tables (column overlap)
    if (objA.columns && objB.columns) {
      const colsA = new Set(objA.columns.map(c => this.extractName(c, 'column', '')).filter(Boolean));
      const colsB = new Set(objB.columns.map(c => c.name));
      let shared = 0;
      for (const col of colsB) {
        if (colsA.has(col)) shared++;
      }
      const total = Math.max(colsA.size, colsB.size);
      return total > 0 ? shared / total : 0;
    }

    // For indexes
    if (objA.isUnique !== undefined || objA.method !== undefined || objA.columns !== undefined) {
      let score = 0;
      if (objA.columns && objB.columns) {
        const exprA = objA.columns.map(c => c.expression || c.column_name || '').filter(Boolean);
        const exprB = objB.columns.map(c => c.expression || c.column_name || '').filter(Boolean);
        let shared = 0;
        for (const e of exprB) { if (exprA.includes(e)) shared++; }
        const total = Math.max(exprA.length, exprB.length);
        score += total > 0 ? shared / total : 0;
      }
      if (objA.isUnique === objB.isUnique) score += 0.25;
      if (objA.method === objB.method) score += 0.15;
      if ((objA.whereClause || objA.condition || objA.predicate) === (objB.whereClause || objB.condition || objB.predicate)) score += 0.15;
      return Math.min(score, 1);
    }

    return 0;
  }

  /**
   * Check if types are compatible for rename detection.
   */
  typesCompatible(drop, create, desired, current) {
    // For columns
    if (drop.object?.dataType && create.object?.dataType) {
      return sameTypeFamily(drop.object.dataType, create.object.dataType) ||
             isImplicitCast(drop.object.dataType, create.object.dataType);
    }

    // For other object types, always consider compatible
    return true;
  }

  /**
   * Get confidence level label.
   */
  getConfidenceLevel(confidence) {
    if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'HIGH';
    if (confidence >= MEDIUM_CONFIDENCE_THRESHOLD) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Extract schema from object.
   */
  extractSchema(obj, objectType) {
    if (!obj) return null;
    return obj.schema || null;
  }

  /**
   * Extract name from object.
   */
  extractName(obj, objectType, key) {
    if (!obj) {
      // Extract from key
      const parts = key.split('.');
      return parts[parts.length - 1];
    }
    return obj.name || obj.relname || obj.proname || obj.typname || key.split('.').pop();
  }

  /**
   * Extract parent path from object.
   */
  extractParent(obj, objectType) {
    if (!obj) return null;

    // For columns
    if (obj.table) return obj.table;

    // For triggers, policies, rules
    if (obj.table) return obj.table;

    // For indexes
    if (obj.table) return obj.table;

    return null;
  }

  /**
   * Group array by property.
   */
  groupBy(array, prop) {
    const result = {};
    for (const item of array) {
      const key = item[prop];
      if (!result[key]) result[key] = [];
      result[key].push(item);
    }
    return result;
  }
}
