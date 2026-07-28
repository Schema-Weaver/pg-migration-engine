/**
 * Schema Weaver Migration Engine - Schema Differ
 * https://schemaweaver.vivekmind.com/
 */

import { isDDLTransactionalInPG } from '../ddl-generator/pg-version.js';

export class ChangeClassifier {
  /**
   * Classify all changes.
   */
  classify(changes) {
    for (const change of changes) {
      change.track = this.getTrack(change);
      change.ddlStrategy = this.getDDLStrategy(change);
      change.isTransactional = this.isTransactional(change);
    }
  }

  /**
   * Determine which track a change belongs to.
   * Track 1: Structural (tables, columns, indexes, constraints)
   * Track 2: Behavioral (views, functions, triggers, policies)
   */
  getTrack(change) {
    const track1Objects = [
      'table', 'column', 'index', 'constraint', 'sequence',
      'extension', 'schema', 'type', 'statistics', 'collation',
      'operator', 'operatorClass', 'operatorFamily', 'cast',
      'foreignTable', 'accessMethod', 'defaultPrivileges',
    ];

    const track2Objects = [
      'view', 'materializedView', 'function', 'procedure',
      'trigger', 'eventTrigger', 'policy', 'rule',
      'aggregate', 'textSearchConfig', 'textSearchDict',
      'conversion', 'textSearchParser', 'textSearchTemplate',
      'foreignDataWrapper', 'foreignServer', 'userMapping',
      'publication', 'subscription', 'language',
    ];

    if (track1Objects.includes(change.objectType)) return 1;
    if (track2Objects.includes(change.objectType)) return 2;

    return 1;
  }

  /**
   * Determine the DDL strategy for this change.
   */
  getDDLStrategy(change) {
    const objType = change.objectType;
    const changeType = change.changeType;

    // ADD_ENUM_VALUES is an ALTER operation, not a CREATE
    if (changeType === 'ADD_ENUM_VALUES') {
      return this.getAlterStrategy(change);
    }

    // CREATE operations
    if (changeType === 'CREATE' || changeType.includes('ADD')) {
      return this.getCreateStrategy(change);
    }

    // ALTER operations
    if (changeType === 'ALTER' || changeType.includes('CHANGE') || changeType.includes('REPLACE')) {
      return this.getAlterStrategy(change);
    }

    // DROP operations
    if (changeType === 'DROP' || changeType.includes('REMOVE') || changeType.includes('RECREATE')) {
      return this.getDropStrategy(change);
    }

    // RENAME operations
    if (changeType === 'RENAME') {
      return this.getRenameStrategy(change);
    }

    return 'ALTER';
  }

  getCreateStrategy(change) {
    switch (change.objectType) {
      case 'view':
        return 'CREATE_OR_REPLACE';
      case 'function':
      case 'procedure':
        return 'CREATE_OR_REPLACE';
      case 'trigger':
        return 'CREATE_TRIGGER';
      case 'policy':
        return 'CREATE_POLICY';
      case 'index':
        return change.isConcurrent ? 'CREATE_INDEX_CONCURRENTLY' : 'CREATE_INDEX';
      default:
        return 'CREATE';
    }
  }

  getAlterStrategy(change) {
    switch (change.objectType) {
      case 'view':
        if (change.property === 'definition') return 'CREATE_OR_REPLACE';
        return 'ALTER_VIEW';
      case 'materializedView':
        return 'DROP_AND_CREATE';
      case 'function':
      case 'procedure':
        if (change.property === 'argumentTypes') return 'DROP_AND_CREATE';
        if (change.property === 'source') return 'CREATE_OR_REPLACE';
        return 'ALTER_FUNCTION';
      case 'trigger':
        if (change.property === 'enabled') return 'ALTER_TRIGGER_ENABLE';
        return 'DROP_AND_CREATE';
      case 'policy':
        if (change.property === 'command') return 'DROP_AND_CREATE';
        if (change.property === 'isPermissive') return 'DROP_AND_CREATE';
        return 'ALTER_POLICY';
      case 'index':
        if (change.property === 'tablespace') return 'ALTER_INDEX_SET_TABLESPACE';
        return 'DROP_AND_CREATE';
      case 'constraint':
        if (change.property === 'isValidated') return 'VALIDATE_CONSTRAINT';
        return 'DROP_AND_CREATE';
      case 'type':
        if (change.changeType === 'ADD_ENUM_VALUES') return 'ALTER_TYPE_ADD_VALUE';
        if (change.property === 'enumValues' && change.addedValues) return 'ALTER_TYPE_ADD_VALUE';
        return 'DROP_AND_CREATE';
      default:
        return 'ALTER';
    }
  }

  getDropStrategy(change) {
    switch (change.objectType) {
      case 'index':
        return change.before?.isConcurrent ? 'DROP_INDEX_CONCURRENTLY' : 'DROP_INDEX';
      case 'constraint':
        return 'DROP_CONSTRAINT';
      default:
        return 'DROP';
    }
  }

  getRenameStrategy(change) {
    switch (change.objectType) {
      case 'table':
        return 'ALTER_TABLE_RENAME';
      case 'column':
        return 'ALTER_TABLE_RENAME_COLUMN';
      case 'index':
        return 'ALTER_INDEX_RENAME';
      case 'constraint':
        return 'ALTER_TABLE_RENAME_CONSTRAINT';
      case 'type':
        return 'ALTER_TYPE_RENAME';
      case 'sequence':
        return 'ALTER_SEQUENCE_RENAME';
      case 'view':
        return 'ALTER_VIEW_RENAME';
      case 'function':
        return 'DROP_AND_CREATE';
      case 'trigger':
        return 'DROP_AND_CREATE';
      case 'policy':
        return 'DROP_AND_CREATE';
      default:
        return 'ALTER';
    }
  }

  /**
   * Determine if the change can run in a transaction.
   */
  isTransactional(change) {
    if (change.isNonTransactional === true) return false;
    if (change.isNonTransactional === false) return true;

    // DDL strategies that cannot run in transactions
    const nonTransactionalStrategies = [
      'CREATE_INDEX_CONCURRENTLY',
      'DROP_INDEX_CONCURRENTLY',
      'REINDEX_CONCURRENTLY',
      'VACUUM_FULL',
      'CLUSTER',
      'CREATE_DATABASE',
      'DROP_DATABASE',
      'DETACH_PARTITION_CONCURRENTLY',
    ];

    if (nonTransactionalStrategies.includes(change.ddlStrategy)) {
      return false;
    }

    // CONCURRENTLY flag
    if (change.isConcurrent || change.before?.isConcurrent) {
      return false;
    }

    // ALTER TYPE ADD VALUE — version-dependent (PG12+ allows in TX)
    if (change.ddlStrategy === 'ALTER_TYPE_ADD_VALUE') {
      const pgVersion = change.pgVersionNum || 140000;
      return isDDLTransactionalInPG('ALTER_TYPE_ADD_VALUE', pgVersion);
    }

    return true;
  }
}
