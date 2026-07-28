/**
 * Schema Weaver Migration Engine - Migration Planner
 * https://schemaweaver.vivekmind.com/
 */
import { TypeRegistry } from './type-registry.js';

const PHASES = {
  ADD_COLUMN: 7,
  DATA_MIGRATION: 11,
  DROP_COLUMN: 30,
};

const BATCH_SIZE = 10000;

export class SmartMigrator {
  /**
   * @param {Object} [options]
   * @param {import('pg').Pool} [options.pool] - Database pool for actual row counts
   */
  constructor(options = {}) {
    this.typeRegistry = new TypeRegistry();
    this.pool = options.pool || null;
  }

  /**
   * Set the database pool for data volume queries
   * @param {import('pg').Pool} pool
   */
  setPool(pool) {
    this.pool = pool;
  }

  /**
   * Estimate the number of rows in a table
   * @param {string} table
   * @returns {Promise<number>}
   */
  async estimateRowCount(table) {
    if (!this.pool) return 10000;
    try {
      const result = await this.pool.query(`
        SELECT reltuples::bigint AS estimated
        FROM pg_class
        WHERE oid = $1::regclass::oid
      `, [table]);
      const count = parseInt(result.rows[0]?.estimated, 10);
      return Number.isFinite(count) && count > 0 ? count : 1000;
    } catch {
      try {
        const result = await this.pool.query(`SELECT COUNT(*) AS cnt FROM ${table}`);
        return parseInt(result.rows[0]?.cnt, 10) || 1000;
      } catch {
        return 10000;
      }
    }
  }

  /**
   * @param {import('../types/changes.js').SchemaChange} change
   * @returns {import('../types/migration.js').MigrationStep[] | null}
   */
  analyze(change) {
    const isAlterColumn = change.changeType === 'ALTER' && 
                          change.objectType === 'column' && 
                          change.changedProperties?.includes('dataType');
    
    if (!isAlterColumn) return null;

    const fromType = change.before?.dataType;
    const toType = change.after?.dataType;
    if (!fromType || !toType) return null;

    if (this.typeRegistry.isImpossibleCast(fromType, toType)) {
      return this.createMultiStepPlan(change, fromType, toType);
    }

    return null;
  }

  /**
   * Analyze all changes, applying data volume awareness where available
   * @param {import('../types/changes.js').SchemaChange[]} changes
   * @returns {Promise<import('../types/migration.js').MigrationStep[][]>}
   */
  async analyzeAll(changes) {
    const results = [];
    for (const change of changes) {
      const steps = this.analyze(change);
      if (steps) {
        const table = change.objectKey?.split('.').slice(0, -1).join('.');
        if (table && this.pool) {
          const rowCount = await this.estimateRowCount(table);
          for (const step of steps) {
            if (step.estimatedRows !== undefined) {
              step.estimatedRows = rowCount;
              step.estimatedBatches = Math.ceil(rowCount / BATCH_SIZE);
            }
          }
        }
        results.push(steps);
      }
    }
    return results;
  }

  /**
   * @param {import('../types/changes.js').SchemaChange} change
   * @param {string} fromType
   * @param {string} toType
   * @returns {import('../types/migration.js').MigrationStep[]}
   */
  createMultiStepPlan(change, fromType, toType) {
    const table = change.objectKey?.split('.').slice(0, -1).join('.') || 'unknown_table';
    const col = change.after?.name || change.name || 'unknown_column';
    const tempCol = `${col}_new`;
    const stepBase = `smart_${change.id || 'cast'}`;
    const dataLossRisk = this.typeRegistry.getDataLossRisk(fromType, toType);

    return [
      {
        id: `${stepBase}_1`,
        type: 'structural',
        phase: PHASES.ADD_COLUMN,
        description: `Add new column ${tempCol} with type ${toType}`,
        sql: `ALTER TABLE ${table} ADD COLUMN ${tempCol} ${toType};`,
        isTransactional: true,
        riskLevel: 'low',
        dependencies: [],
      },
      {
        id: `${stepBase}_2`,
        type: 'data_migration',
        phase: PHASES.DATA_MIGRATION,
        description: `Backfill data from ${col} to ${tempCol}`,
        sql: `-- Batched backfill (batch size ${BATCH_SIZE}): UPDATE ${table} SET ${tempCol} = ${col}::${toType} WHERE ${tempCol} IS NULL;`,
        isTransactional: false,
        riskLevel: dataLossRisk === 'critical' ? 'high' : 'medium',
        dependencies: [`${stepBase}_1`],
        estimatedRows: 10000,
        dataLossRisk,
      },
      {
        id: `${stepBase}_3`,
        type: 'structural',
        phase: PHASES.DROP_COLUMN,
        description: `Drop old column ${col} and rename ${tempCol} to ${col}`,
        sql: `ALTER TABLE ${table} DROP COLUMN ${col} CASCADE; ALTER TABLE ${table} RENAME COLUMN ${tempCol} TO ${col};`,
        isTransactional: true,
        riskLevel: dataLossRisk === 'critical' ? 'critical' : 'high',
        dependencies: [`${stepBase}_2`],
        dataLossRisk,
      },
    ];
  }
}
