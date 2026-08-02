/**
 * Schema Weaver Migration Engine - Schema Differ
 * https://schemaweaver.vivekmind.com/
 */
import { getCastInfo, isSafeCast, isWideningCast, typesEqual } from './utils/type-compatibility.js';

const PG_VERSION_17 = 170000;

/**
 * Property Differ - Deep property-level diffing for all object types.
 * Handles column properties (nullable, default, type, etc.) and object properties.
 */

export class PropertyDiffer {
  constructor(pgVersion = 150000) {
    this.warnings = [];
    this.pgVersion = pgVersion;
  }

  /**
   * Filter out MAINTAIN privilege for PG < 17.
   * @param {Array} privileges
   * @returns {Array}
   */
  filterPrivileges(privileges) {
    if (this.pgVersion >= PG_VERSION_17) return privileges;
    return (privileges || []).filter(p => p.privilege !== 'MAINTAIN');
  }

  /**
   * Diff all matched objects at the property level.
   */
  diff(matches, desired, current) {
    const changes = [];
    this.warnings = [];

    for (const match of matches) {
      const objType = match.objectType;
      const desiredObj = match.desired;
      const currentObj = match.current;

      const objectChanges = this.diffObject(objType, desiredObj, currentObj, match.key);
      changes.push(...objectChanges);
    }

    return { changes, warnings: this.warnings };
  }

  /**
   * Diff a single object of any type.
   */
  diffObject(objectType, desired, current, key) {
    const changes = [];

    switch (objectType) {
      case 'table':
        changes.push(...this.diffTable(desired, current, key));
        break;
      case 'column':
        changes.push(...this.diffColumn(desired, current, key));
        break;
      case 'index':
        changes.push(...this.diffIndex(desired, current, key));
        break;
      case 'constraint':
        changes.push(...this.diffConstraint(desired, current, key));
        break;
      case 'view':
        changes.push(...this.diffView(desired, current, key));
        break;
      case 'materializedView':
        changes.push(...this.diffMaterializedView(desired, current, key));
        break;
      case 'function':
      case 'procedure':
        changes.push(...this.diffFunction(desired, current, key));
        break;
      case 'aggregate':
        changes.push(...this.diffAggregate(desired, current, key));
        break;
      case 'trigger':
        changes.push(...this.diffTrigger(desired, current, key));
        break;
      case 'policy':
        changes.push(...this.diffPolicy(desired, current, key));
        break;
      case 'sequence':
        changes.push(...this.diffSequence(desired, current, key));
        break;
      case 'type':
      case 'domain':
        changes.push(...this.diffType(desired, current, key));
        break;
      case 'rule':
        changes.push(...this.diffRule(desired, current, key));
        break;
      case 'eventTrigger':
        changes.push(...this.diffEventTrigger(desired, current, key));
        break;
      case 'operator':
        changes.push(...this.diffOperator(desired, current, key));
        break;
      case 'operatorClass':
      case 'operatorFamily':
        changes.push(...this.diffOperatorClass(desired, current, key, objectType));
        break;
      case 'textSearchConfig':
      case 'textSearchDict':
      case 'textSearchParser':
      case 'textSearchTemplate':
        changes.push(...this.diffTextSearch(desired, current, key, objectType));
        break;
      case 'publication':
      case 'subscription':
        changes.push(...this.diffReplication(desired, current, key, objectType));
        break;
      case 'statistics':
        changes.push(...this.diffStatistics(desired, current, key));
        break;
      case 'collation':
        changes.push(...this.diffCollation(desired, current, key));
        break;
      case 'cast':
        changes.push(...this.diffCast(desired, current, key));
        break;
      case 'foreignServer':
      case 'foreignDataWrapper':
      case 'userMapping':
        changes.push(...this.diffForeignObject(desired, current, key, objectType));
        break;
      case 'conversion':
        changes.push(...this.diffConversion(desired, current, key));
        break;
      case 'defaultPrivileges':
        changes.push(...this.diffDefaultPrivileges(desired, current, key));
        break;
      case 'accessMethod':
        changes.push(...this.diffAccessMethod(desired, current, key));
        break;
      case 'foreignTable':
        changes.push(...this.diffForeignTable(desired, current, key));
        break;
      case 'extension':
        changes.push(...this.diffExtension(desired, current, key));
        break;
      case 'schema':
        changes.push(...this.diffSchema(desired, current, key));
        break;
      default:
        changes.push(...this.diffGeneric(desired, current, key, objectType));
    }

    return changes;
  }

  diffTable(desired, current, key) {
    const changes = [];

    const simpleProps = [
      'tablespace',
      'owner',
      'isLogged',
      'isTemporary',
      'isUnlogged',
      'rowLevelSecurity',
      'forceRowLevelSecurity',
      'rlsEnabled',
      'rlsForced',
      'replicaIdentity',
      'hasOids',
      'comment',
      'userCatalog',
      'isPartition',
      'isDefaultPartition',
      'isForeignTable',
      'foreignServer',
      'accessMethod',
    ];

    for (const prop of simpleProps) {
      if (desired[prop] !== current[prop] && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('table', key, prop, current[prop], desired[prop]));
      }
    }

    // Partition properties that require recreation (CRITICAL)
    const criticalPartitionProps = [
      'isPartitioned',
      'partitionStrategy',
      'partitionColumns',
      'partitionKeyDef',
      'partitionExpression',
    ];

    for (const prop of criticalPartitionProps) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        const change = this.createPropertyChange('table', key, prop, current[prop], desired[prop]);
        change.requiresRecreation = true;
        change.changeType = 'PARTITION_STRUCTURE_CHANGE';
        this.warnings.push({
          code: 'PARTITION_STRUCTURE_CHANGE',
          message: `Partition structure change detected for ${key}: ${prop} changed`,
          changeKey: key,
          severity: 'critical',
          reason: 'partition_structure_requires_recreation',
          suggestions: [
            'Changing partition structure requires DROP and CREATE',
            'Ensure all partition children are handled correctly',
          ],
        });
        changes.push(change);
      }
    }

    // 1. Storage Parameters (JSON stringify comparison)
    const curStorage = current.storageParameters || {};
    const desStorage = desired.storageParameters || {};
    if (JSON.stringify(desStorage) !== JSON.stringify(curStorage) && desired.storageParameters !== undefined) {
      changes.push(this.createPropertyChange('table', key, 'storageParameters', curStorage, desStorage));
    }

    // 1b. TOAST Storage Parameters (JSON stringify comparison)
    const curToastStorage = current.toastStorageOptions || {};
    const desToastStorage = desired.toastStorageOptions || {};
    if (JSON.stringify(desToastStorage) !== JSON.stringify(curToastStorage) && desired.toastStorageOptions !== undefined) {
      changes.push(this.createPropertyChange('table', key, 'toastStorageOptions', curToastStorage, desToastStorage));
    }

    // 2. Inherits From (JSON stringify comparison)
    const curInherits = current.inheritsFrom || [];
    const desInherits = desired.inheritsFrom || [];
    if (JSON.stringify(desInherits.sort()) !== JSON.stringify(curInherits.sort()) && desired.inheritsFrom !== undefined) {
      changes.push(this.createPropertyChange('table', key, 'inheritsFrom', curInherits, desInherits));
    }

    // 3. Partition Parent & Bound (Attach/Detach)
    if ((desired.partitionParent !== current.partitionParent || desired.partitionBound !== current.partitionBound) &&
        (desired.partitionParent !== undefined || desired.partitionBound !== undefined)) {
      changes.push(this.createPropertyChange('table', key, 'partitionParent',
        { parent: current.partitionParent, bound: current.partitionBound },
        { parent: desired.partitionParent, bound: desired.partitionBound }
      ));
    }

    // Foreign table options (JSON comparison)
    const curForeignOpts = current.foreignOptions || {};
    const desForeignOpts = desired.foreignOptions || {};
    if (JSON.stringify(desForeignOpts) !== JSON.stringify(curForeignOpts) && desired.foreignOptions !== undefined) {
      changes.push(this.createPropertyChange('table', key, 'foreignOptions', curForeignOpts, desForeignOpts));
    }

    // 4. Privileges (Grants & Revokes)
    const curPrivs = this.filterPrivileges(current.privileges);
    const desPrivs = this.filterPrivileges(desired.privileges);
    const findPriv = (list, p) => list.find(x => x.privilege === p.privilege && x.grantee === p.grantee && x.isGrantable === p.isGrantable);
    
    const grantsToMake = [];
    const revokesToMake = [];
    
    for (const dp of desPrivs) {
      if (!findPriv(curPrivs, dp)) {
        grantsToMake.push(dp);
      }
    }
    for (const cp of curPrivs) {
      if (!findPriv(desPrivs, cp)) {
        revokesToMake.push(cp);
      }
    }
    
    if (grantsToMake.length > 0 || revokesToMake.length > 0) {
      changes.push(this.createPropertyChange('table', key, 'privileges', curPrivs, desPrivs, {
        grantsToMake,
        revokesToMake
      }));
    }

    return changes;
  }

  diffColumn(desired, current, key) {
    const changes = [];

    if (desired.default !== undefined && desired.defaultValue === undefined) {
      desired.defaultValue = desired.default;
    }

    const props = [
      { name: 'dataType', critical: true },
      { name: 'isNullable', critical: false },
      { name: 'defaultValue', critical: false },
      { name: 'isPrimaryKey', critical: false },
      { name: 'isUnique', critical: false },
      { name: 'isForeignKey', critical: false },
      { name: 'fkRelation', critical: false },
      { name: 'check', critical: false },
      { name: 'collation', critical: false },
      { name: 'isIdentity', critical: false },
      { name: 'identityMode', critical: false },
      { name: 'identityStart', critical: false },
      { name: 'identityIncrement', critical: false },
      { name: 'identityMin', critical: false },
      { name: 'identityMax', critical: false },
      { name: 'identityCycle', critical: false },
      { name: 'identityCache', critical: false },
      { name: 'isGenerated', critical: false },
      { name: 'generatedExpression', critical: false },
      { name: 'generatedStorage', critical: false },
      { name: 'comment', critical: false },
      { name: 'isDecimal', critical: false },
      { name: 'storage', critical: false },
      { name: 'statisticsTarget', critical: false },
      { name: 'compression', critical: false },
      { name: 'privileges', critical: false },
      { name: 'foreignOptions', critical: false },
      { name: 'inheritedCount', critical: false },
      { name: 'isLocal', critical: false },
      { name: 'length', critical: false },
      { name: 'arrayDimensions', critical: false },
    ];

    for (const prop of props) {
      // Desired-driven diffing: a property that is absent from the desired
      // column object means "no intent" for that property, so nothing is
      // diffed. Introspection populates many props unconditionally (identity
      // params, length, defaultValue ...) - comparing current-only values
      // would produce spurious DROP IDENTITY / DROP DEFAULT / no-op ALTERs
      // for minimal desired schemas. To remove something explicitly, set the
      // prop to null in desired (e.g. defaultValue: null -> DROP DEFAULT).
      if (desired[prop.name] === undefined) continue;
      // dataType is compared via type normalization so aliases are equal
      // (varchar(255) vs character varying(255), int vs integer, ...).
      const differs = prop.name === 'dataType'
        ? !typesEqual(desired[prop.name], current[prop.name])
        : JSON.stringify(desired[prop.name]) !== JSON.stringify(current[prop.name]);
      if (differs) {
        changes.push(this.createPropertyChange('column', key, prop.name, current[prop.name], desired[prop.name]));
      }
    }

    // Type change handling
    const typeChange = changes.find(c => c.property === 'dataType');
    if (typeChange && typeChange.currentValue !== undefined) {
      const castInfo = getCastInfo(typeChange.currentValue, typeChange.desiredValue);

      // Determine type change type
      if (castInfo.canCast === false) {
        typeChange.changeType = 'IMPOSSIBLE_CAST';
        typeChange.dataLossRisk = true;
        typeChange.requiresRecreation = true;
        this.warnings.push({
          code: 'IMPOSSIBLE_TYPE_CAST',
          message: `No cast path from ${typeChange.currentValue} to ${typeChange.desiredValue} for column ${key}`,
          changeKey: key,
          severity: 'critical',
          reason: 'no_cast_context_or_binary',
          suggestions: [
            'Add a USING clause with explicit conversion logic',
            'Create intermediate column, copy data, then swap',
          ],
        });
      } else if (!isSafeCast(typeChange.currentValue, typeChange.desiredValue)) {
        typeChange.changeType = 'UNSAFE_CAST';

        // Narrowing cast
        if (!isWideningCast(typeChange.currentValue, typeChange.desiredValue)) {
          typeChange.changeType = 'NARROWING_CAST';
          typeChange.dataLossRisk = true;
          this.warnings.push({
            code: 'NARROWING_TYPE_CAST',
            message: `Narrowing cast ${typeChange.currentValue} → ${typeChange.desiredValue} may truncate data`,
            changeKey: key,
            severity: 'high',
            reason: 'precision_loss',
            suggestions: [
              'Check for data that would be truncated',
              'Add USING clause to handle edge cases',
            ],
          });
        }
      } else {
        typeChange.changeType = isWideningCast(typeChange.currentValue, typeChange.desiredValue)
          ? 'WIDENING_CAST'
          : 'SAFE_CAST';
      }
    }

    return changes;
  }

  diffIndex(desired, current, key) {
    const changes = [];

    const props = [
      'definition',
      'whereClause',
      'isUnique',
      'isPrimary',
      'isConcurrent',
      'tablespace',
      'storageParameters',
      'method',
      'comment',
      'isValid',
      'isReady',
      'isLive',
      'isReplicaIdentity',
      'isClustered',
      'nullsNotDistinct',
      'brinPagesPerRange',
      'owner',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('index', key, prop, current[prop], desired[prop]));
      }
    }

    // Columns are compared in canonical form: the introspector emits
    // { expression, direction, nullsOrder } while desired schemas commonly
    // use { name } (e.g. [{ name: 'user_id' }]). Without normalization the
    // index is recreated on every migration.
    const normDirection = d => ((d ?? 'ASC') + '').replace(/^NULLS\s+/i, '').toUpperCase();
    const normNulls = n => ((n ?? 'LAST') + '').replace(/^NULLS\s+/i, '').toUpperCase();
    const normalizedColumns = cols => (Array.isArray(cols) ? cols.map(c => ({
      expression: c?.expression ?? c?.name ?? c?.column_name ?? c,
      direction: normDirection(c?.direction),
      nullsOrder: normNulls(c?.nullsOrder),
    })) : cols);
    const normalizedIncludes = cols => (Array.isArray(cols)
      ? cols.map(c => c?.name ?? c?.column_name ?? c)
      : cols);

    if (JSON.stringify(normalizedColumns(desired.columns)) !== JSON.stringify(normalizedColumns(current.columns))) {
      changes.push(this.createPropertyChange('index', key, 'columns', current.columns, desired.columns));
    }
    if (JSON.stringify(normalizedIncludes(desired.includeColumns)) !== JSON.stringify(normalizedIncludes(current.includeColumns))) {
      changes.push(this.createPropertyChange('index', key, 'includeColumns', current.includeColumns, desired.includeColumns));
    }

    // Definition changes require recreation
    const criticalProps = ['columns', 'definition', 'whereClause', 'isUnique', 'isPrimary', 'method', 'includeColumns', 'brinPagesPerRange'];
    if (changes.some(c => criticalProps.includes(c.property))) {
      for (const change of changes) {
        change.requiresRecreation = true;
      }
    }

    return changes;
  }

  diffConstraint(desired, current, key) {
    const changes = [];

    const props = [
      'definition',
      'isValidated',
      'tablespace',
      'deferrable',
      'initiallyDeferred',
      'deferred',
      'onUpdate',
      'onDelete',
      'matchType',
      'noInherit',
      'isInherited',
      'isLocal',
      'enforced',
      'comment',
      'indexTablespace',
      'exclusionExpression',
      'referencedTable',
      'index',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('constraint', key, prop, current[prop], desired[prop]));
      }
    }

    // Referenced columns for FK constraints
    const curRefCols = current.referencedColumns || [];
    const desRefCols = desired.referencedColumns || [];
    if (JSON.stringify(desRefCols) !== JSON.stringify(curRefCols) && desired.referencedColumns !== undefined) {
      changes.push(this.createPropertyChange('constraint', key, 'referencedColumns', curRefCols, desRefCols));
    }

    return changes;
  }

  diffView(desired, current, key) {
    const changes = [];

    const props = [
      'definition',
      'checkOption',
      'securityBarrier',
      'securityInvoker',
      'columns',
      'privileges',
      'owner',
      'comment',
      'isRecursive',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('view', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffMaterializedView(desired, current, key) {
    const changes = [];

    const props = [
      'definition',
      'isWithData',
      'isPopulated',
      'refreshMethod',
      'tablespace',
      'storageParameters',
      'columns',
      'privileges',
      'owner',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('materializedView', key, prop, current[prop], desired[prop]));
      }
    }

    if (changes.length > 0) {
      changes[0].changeType = 'ALTER_MATERIALZIED_VIEW';
      changes[0].requiresRecreation = true;
      this.warnings.push({
        code: 'MATERIALIZED_VIEW_DEFINITION_CHANGE',
        message: `Materialized view ${key} requires DROP and CREATE`,
        changeKey: key,
        severity: 'medium',
        reason: 'cannot_replace_materialized_view',
        suggestions: ['Ensure REFRESH is run after recreation'],
      });
    }

    return changes;
  }

  diffFunction(desired, current, key) {
    const changes = [];

    // Check for parameter type changes (requires drop+create)
    if (JSON.stringify(desired.argumentTypes) !== JSON.stringify(current.argumentTypes)) {
      changes.push(this.createPropertyChange('function', key, 'argumentTypes', current.argumentTypes, desired.argumentTypes));
    }

    const props = [
      'source',
      'language',
      'volatility',
      'isStrict',
      'security',
      'cost',
      'rows',
      'parallel',
      'isLeakproof',
      'returnType',
      'returnSet',
      'argumentNames',
      'argumentDefaults',
      'argumentModes',
      'precompiledBody',
      'configuration',
      'supportFunction',
      'owner',
      'comment',
      'privileges',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('function', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffAggregate(desired, current, key) {
    const changes = [];

    const props = [
      'sfunc',
      'stype',
      'finalfunc',
      'combinefunc',
      'initcond',
      'sspace',
      'finalfuncExtra',
      'finalfuncModify',
      'serialfunc',
      'deserialfunc',
      'sortop',
      'hypothetical',
      'owner',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('aggregate', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffTrigger(desired, current, key) {
    const changes = [];

    const props = [
      'function',
      'events',
      'timing',
      'enabled',
      'level',
      'whenCondition',
      'isConstraint',
      'isDeferrable',
      'isDeferred',
      'updateOfColumns',
      'oldTableName',
      'newTableName',
      'isForEachRow',
      'functionCall',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('trigger', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffPolicy(desired, current, key) {
    const changes = [];

    const props = [
      'command',
      'isPermissive',
      'roles',
      'using',
      'withCheck',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('policy', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffSequence(desired, current, key) {
    const changes = [];

    const props = [
      'startValue',
      'increment',
      'minValue',
      'maxValue',
      'cache',
      'cycle',
      'ownedBy',
      'owner',
      'dataType',
      'tablespace',
      'comment',
      'currentValue',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('sequence', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffType(desired, current, key) {
    const changes = [];

    // Handle ENUM type
    if (desired.kind === 'ENUM' || current.kind === 'ENUM') {
      const desiredValues = Array.isArray(desired?.enumValues) ? desired.enumValues : [];
      const currentValues = Array.isArray(current?.enumValues) ? current.enumValues : [];

      const desiredNormalized = desiredValues.map(v => typeof v === 'object' ? v.value : v).sort();
      const currentNormalized = currentValues.map(v => typeof v === 'object' ? v.value : v).sort();

      if (JSON.stringify(desiredNormalized) !== JSON.stringify(currentNormalized)) {
        const added = desiredNormalized.filter(dv => !currentNormalized.includes(dv));
        const removed = currentNormalized.filter(cv => !desiredNormalized.includes(cv));

        const change = this.createPropertyChange('type', key, 'enumValues', { added: [], removed }, { added, removed });
        change.existingEnumValues = currentNormalized;
        change.before = { ...change.before, existingEnumValues: currentNormalized };
        changes.push(change);

        if (removed.length > 0) {
          changes[changes.length - 1].changeType = 'REMOVE_ENUM_VALUES';
          changes[changes.length - 1].requiresRecreation = true;
        } else         if (added.length > 0) {
          changes[changes.length - 1].changeType = 'ADD_ENUM_VALUES';
          changes[changes.length - 1].addedValues = true;
        }
      }

      const props = ['owner', 'comment', 'privileges'];
      for (const prop of props) {
        if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
          changes.push(this.createPropertyChange('type', key, prop, current[prop], desired[prop]));
        }
      }
    }

    // Handle COMPOSITE type
    if (desired.kind === 'COMPOSITE' || current.kind === 'COMPOSITE') {
      const desiredAttrs = Array.isArray(desired?.attributes) ? desired.attributes : [];
      const currentAttrs = Array.isArray(current?.attributes) ? current.attributes : [];

      if (JSON.stringify(desiredAttrs) !== JSON.stringify(currentAttrs)) {
        changes.push(this.createPropertyChange('type', key, 'attributes', currentAttrs, desiredAttrs));
        changes[changes.length - 1].changeType = 'COMPOSITE_ATTRIBUTES_CHANGE';
        changes[changes.length - 1].requiresRecreation = true;
      }

      const props = ['owner', 'comment', 'privileges'];
      for (const prop of props) {
        if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
          changes.push(this.createPropertyChange('type', key, prop, current[prop], desired[prop]));
        }
      }
    }

    // Handle DOMAIN type
    if (desired.kind === 'DOMAIN' || current.kind === 'DOMAIN') {
      const props = ['baseType', 'baseTypeSchema', 'notNull', 'defaultValue', 'checkConstraint', 'collation', 'owner', 'comment', 'length', 'typmod', 'privileges'];
      for (const prop of props) {
        if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
          changes.push(this.createPropertyChange('type', key, prop, current[prop], desired[prop]));
        }
      }
      // Base type changes require recreation
      if (changes.some(c => c.property === 'baseType' || c.property === 'baseTypeSchema')) {
        for (const change of changes) {
          change.requiresRecreation = true;
        }
      }
    }

    // Handle RANGE type
    if (desired.kind === 'RANGE' || current.kind === 'RANGE') {
      const props = ['subtype', 'subtypeSchema', 'collation', 'subtypeOpclass', 'subtypeDiff', 'canonicalFunction', 'owner', 'comment', 'privileges'];
      for (const prop of props) {
        if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
          changes.push(this.createPropertyChange('type', key, prop, current[prop], desired[prop]));
        }
      }
      // Subtype changes require recreation
      if (changes.some(c => c.property === 'subtype' || c.property === 'subtypeSchema' || c.property === 'subtypeOpclass')) {
        for (const change of changes) {
          change.requiresRecreation = true;
        }
      }
    }

    return changes;
  }

  diffRule(desired, current, key) {
    const changes = [];

    const props = [
      'event',
      'isInstead',
      'isEnabled',
      'condition',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('rule', key, prop, current[prop], desired[prop]));
      }
    }

    if (desired.definition && current.definition && desired.definition !== current.definition) {
      changes.push(this.createPropertyChange('rule', key, 'definition', current.definition, desired.definition));
    }

    return changes;
  }

  diffEventTrigger(desired, current, key) {
    const changes = [];

    if (desired.event === 'login' && this.pgVersion < PG_VERSION_17) {
      this.warnings.push({
        code: 'LOGIN_EVENT_TRIGGER_UNSUPPORTED',
        message: `Login event trigger "${desired.name}" requires PostgreSQL 17+ (current: ${Math.floor(this.pgVersion / 10000)})`,
        objectKey: key,
      });
      return changes;
    }

    const props = [
      'event',
      'tags',
      'function',
      'enabled',
      'owner',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('eventTrigger', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffOperator(desired, current, key) {
    const changes = [];

    const props = [
      'leftType',
      'rightType',
      'proc',
      'commutator',
      'negator',
      'restrictFunction',
      'joinFunction',
      'canHash',
      'canMerge',
      'owner',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('operator', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffOperatorClass(desired, current, key, objectType) {
    const changes = [];

    const props = [
      'isDefault',
      'family',
      'inputType',
      'accessMethod',
      'storageType',
      'operators',
      'functions',
      'owner',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange(objectType, key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffTextSearch(desired, current, key, objectType) {
    const changes = [];

    const propsByType = {
      textSearchConfig: ['parser', 'tokenMappings', 'owner', 'comment'],
      textSearchDict: ['template', 'options', 'owner', 'comment'],
      textSearchParser: ['start', 'getToken', 'end', 'lextypes', 'headline', 'owner', 'comment'],
      textSearchTemplate: ['lexize', 'init', 'owner', 'comment'],
    };

    const props = propsByType[objectType] || [];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange(objectType, key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffReplication(desired, current, key, objectType) {
    const changes = [];

    const propsByType = {
      publication: ['tables', 'allTables', 'insert', 'update', 'delete', 'truncate', 'viaRoot', 'schemas', 'owner', 'comment'],
      subscription: ['conninfo', 'publications', 'enabled', 'slotName', 'syncCommit', 'binaryTransfer', 'streaming', 'twoPhase', 'disableOnError', 'origin', 'owner', 'comment'],
    };

    const props = propsByType[objectType] || [];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange(objectType, key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffStatistics(desired, current, key) {
    const changes = [];

    const props = [
      'columns',
      'kinds',
      'table',
      'definition',
      'owner',
      'statisticsTarget',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('statistics', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffCollation(desired, current, key) {
    const changes = [];

    const props = [
      'locale',
      'lcCollate',
      'lcCtype',
      'provider',
      'isDeterministic',
      'version',
      'encoding',
      'owner',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('collation', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffCast(desired, current, key) {
    const changes = [];

    const props = [
      'sourceType',
      'targetType',
      'function',
      'context',
      'method',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('cast', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffExtension(desired, current, key) {
    const changes = [];

    const props = [
      'version',
      'owner',
      'isRelocatable',
      'isAvailable',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('extension', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffForeignObject(desired, current, key, objectType) {
    const changes = [];

    const propsByType = {
      foreignServer: ['type', 'version', 'fdw', 'options', 'owner', 'privileges', 'comment'],
      foreignDataWrapper: ['handler', 'validator', 'options', 'owner', 'privileges', 'comment'],
      userMapping: ['user', 'server', 'options'],
    };

    const props = propsByType[objectType] || [];

    for (const prop of props) {
      if (prop === 'options') {
        const desiredOpts = desired.options || {};
        const currentOpts = current.options || {};
        const desiredOptsRedacted = Object.fromEntries(Object.entries(desiredOpts).map(([k, v]) => [k, k === 'password' ? '[REDACTED]' : v]));
        const currentOptsRedacted = Object.fromEntries(Object.entries(currentOpts).map(([k, v]) => [k, k === 'password' ? '[REDACTED]' : v]));
        if (JSON.stringify(desiredOptsRedacted) !== JSON.stringify(currentOptsRedacted)) {
          changes.push(this.createPropertyChange(objectType, key, 'options', currentOpts, desiredOpts));
        }
      } else if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange(objectType, key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffConversion(desired, current, key) {
    const changes = [];

    const props = [
      'sourceEncoding',
      'targetEncoding',
      'proc',
      'isDefault',
      'owner',
      'comment',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('conversion', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffDefaultPrivileges(desired, current, key) {
    const changes = [];

    const props = [
      'schema',
      'forRole',
      'privileges',
      'objectType',
      'grantees',
      'withGrantOption',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('defaultPrivileges', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffAccessMethod(desired, current, key) {
    const changes = [];

    const props = [
      'type',
      'handler',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('accessMethod', key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  diffForeignTable(desired, current, key) {
    const changes = [];

    const props = [
      'columns',
      'server',
      'options',
      'owner',
      'comment',
      'privileges',
    ];

    for (const prop of props) {
      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('foreignTable', key, prop, current[prop], desired[prop]));
      }
    }

    // Check column foreign options
    const desiredCols = desired.columns || [];
    const currentCols = current.columns || [];
    for (let i = 0; i < Math.min(desiredCols.length, currentCols.length); i++) {
      if (JSON.stringify(desiredCols[i].foreignOptions) !== JSON.stringify(currentCols[i].foreignOptions)) {
        changes.push(this.createPropertyChange('foreignTable', key, 'columnOptions', currentCols[i].foreignOptions, desiredCols[i].foreignOptions));
      }
    }

    return changes;
  }

  diffSchema(desired, current, key) {
    const changes = [];

    const props = ['owner', 'comment'];

    for (const prop of props) {
      if (desired[prop] !== current[prop] && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange('schema', key, prop, current[prop], desired[prop]));
      }
    }

    if (JSON.stringify(desired.privileges) !== JSON.stringify(current.privileges) && desired.privileges !== undefined) {
      changes.push(this.createPropertyChange('schema', key, 'privileges', current.privileges, desired.privileges));
    }

    return changes;
  }

  diffGeneric(desired, current, key, objectType) {
    const changes = [];

    const allKeys = new Set([...Object.keys(desired), ...Object.keys(current)]);

    for (const prop of allKeys) {
      if (prop === 'name' || prop === 'schema' || prop === 'objectType') continue;

      if (JSON.stringify(desired[prop]) !== JSON.stringify(current[prop]) && desired[prop] !== undefined) {
        changes.push(this.createPropertyChange(objectType, key, prop, current[prop], desired[prop]));
      }
    }

    return changes;
  }

  createPropertyChange(objectType, path, property, currentValue, desiredValue) {
    return {
      changeType: 'ALTER',
      objectType,
      path,
      property,
      currentValue,
      desiredValue,
      key: `${path}.${property}`,
      targetKeys: [path],
      requiresRecreation: false,
      changePlan: [],
      collateralDamage: [],
      pgVersionMinimum: this.getVersionMinimum(objectType, property, currentValue, desiredValue),
    };
  }

  getVersionMinimum(objectType, property, currentValue, desiredValue) {
    if (property === 'isGenerated' && desiredValue) return 12;
    if (property === 'parallelWorkers') return 9.6;
    if (objectType === 'policy') return 9.5;
    if (objectType === 'procedure') return 11;
    if (objectType === 'enumValues' && currentValue?.added?.length > 0) {
      return 8;
    }
    return null;
  }
}
