/**
 * Schema Weaver Migration Engine - Migration Planner
 * https://schemaweaver.vivekmind.com/
 */
export class BackfillPlanner {
  /**
   * @param {import('../types/execution.js').BackfillOptions} options
   * @returns {import('../types/migration.js').MigrationStep[]}
   */
  createBackfillPlan(options) {
    const { table, fromColumn, toColumn, transform, batchSize = 5000, rateLimitMs = 50, pkColumn = 'id', planId = '1' } = options;
    const steps = [];

    steps.push({
      id: `backfill_${planId}_1`,
      type: 'data_migration',
      phase: 5,
      description: `Create sync trigger for ${table}`,
      sql: `-- Sync trigger: keep ${fromColumn} and ${toColumn} in sync during backfill`,
      isTransactional: true,
      riskLevel: 'low',
      dependencies: [],
    });

    steps.push({
      id: `backfill_${planId}_2`,
      type: 'data_migration',
      phase: 5,
      description: `Batched backfill: ${table}.${fromColumn} -> ${toColumn}`,
      sql: `-- Batched backfill: UPDATE ${table} SET ${toColumn} = ${transform} WHERE ${pkColumn} BETWEEN ? AND ? AND ${toColumn} IS NULL;`,
      isTransactional: true,
      riskLevel: 'medium',
      dependencies: [`backfill_${planId}_1`],
      estimatedRows: 100000,
      metadata: { batchSize, rateLimitMs },
    });

    return steps;
  }
}
