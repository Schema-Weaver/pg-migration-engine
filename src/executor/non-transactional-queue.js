/**
 * Schema Weaver Migration Engine - Non-Transactional Step Queue
 * https://schemaweaver.vivekmind.com/
 *
 * Queues non-transactional DDL steps (CREATE INDEX CONCURRENTLY, VACUUM,
 * CREATE DATABASE, ...) during the transactional phase loop and executes
 * them ONLY after all transactional phases have committed.
 *
 * Why: a non-tx step (e.g. a CIC index) executed before a later transactional
 * phase fails would be orphaned by the rollback of the object it references.
 * Deferring them to after COMMIT guarantees they only run against a fully
 * committed schema, and a failed migration never leaves orphaned objects.
 *
 * Execution order preserves the plan's phase numbering (dependency order).
 */

export class NonTransactionalQueue {
  constructor() {
    this._items = [];
  }

  /**
   * Add a step to the queue. Steps are executed in insertion (phase) order.
   * @param {Object} step - Migration step with { id, phase, sql, ... }
   * @returns {this}
   */
  enqueue(step) {
    if (!step || step.id == null) {
      throw new Error('NonTransactionalQueue.enqueue: step with an id is required');
    }
    this._items.push(step);
    return this;
  }

  /**
   * Number of queued steps.
   * @returns {number}
   */
  get size() {
    return this._items.length;
  }

  /**
   * True when nothing is queued.
   * @returns {boolean}
   */
  get isEmpty() {
    return this._items.length === 0;
  }

  /**
   * Snapshot of the queued steps (copy; mutation is safe).
   * @returns {Array<Object>}
   */
  get steps() {
    return [...this._items];
  }

  /**
   * Distinct phase numbers in ascending order (dependency order).
   * @returns {Array<number>}
   */
  get phases() {
    return [...new Set(this._items.map(s => s.phase))].sort((a, b) => a - b);
  }

  /**
   * Remove all queued steps (e.g. executor cleanup between runs).
   */
  clear() {
    this._items = [];
  }

  /**
   * Best-effort rollback SQL for the queued steps (undoSql/rollbackSql).
   * NOTE: CIC drops etc. are included here; the caller decides whether to
   * run them outside a transaction.
   * @returns {Array<{stepId: string, sql: string}>}
   */
  generateRollbackSQL() {
    return this._items
      .filter(s => s.undoSql || s.rollbackSql)
      .map(s => ({ stepId: s.id, sql: s.undoSql || s.rollbackSql }));
  }

  /**
   * Execute all queued steps in order, delegating each to the supplied
   * callback (the executor's per-step execution logic).
   * @param {(step: Object) => Promise<Object>} executeStep
   * @returns {Promise<Array<Object>>} Per-step results from the callback
   */
  async executeAll(executeStep) {
    const results = [];
    for (const step of this._items) {
      results.push(await executeStep(step));
    }
    return results;
  }
}
