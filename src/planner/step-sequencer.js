/**
 * Schema Weaver Migration Engine - Migration Planner
 * https://schemaweaver.vivekmind.com/
 */
export class StepSequencer {
  /**
   * @param {import('../types/changes.js').SchemaChange[]} changes
   * @param {import('../types/migration.js').MigrationStep[]} steps
   * @returns {import('../types/migration.js').MigrationStep[]}
   */
  sequence(changes, steps) {
    const sequenced = [];
    const stepMap = new Map(steps.map(s => [s.id, s]));

    const sorted = this.topologicalSort(steps);
    let idCounter = 1;

    for (const step of sorted) {
      sequenced.push({
        ...step,
        id: `step_${String(idCounter).padStart(3, '0')}`,
      });
      idCounter++;
    }

    return sequenced;
  }

  /**
   * @param {import('../types/migration.js').MigrationStep[]} steps
   * @returns {import('../types/migration.js').MigrationStep[]}
   */
  topologicalSort(steps) {
    const stepMap = new Map(steps.map(s => [s.id, s]));
    const inDegree = new Map(steps.map(s => [s.id, 0]));
    const adj = new Map(steps.map(s => [s.id, []]));

    for (const step of steps) {
      for (const depId of step.dependencies || []) {
        if (adj.has(depId)) {
          adj.get(depId).push(step.id);
          inDegree.set(step.id, (inDegree.get(step.id) || 0) + 1);
        }
      }
    }

    // Use indexed queue for O(1) operations instead of shift()
    const queue = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    queue.sort();

    const sorted = [];
    let queueHead = 0;
    
    while (queueHead < queue.length) {
      const current = queue[queueHead++];
      sorted.push(stepMap.get(current));

      const newZeroDegree = [];
      for (const neighbor of adj.get(current) || []) {
        inDegree.set(neighbor, inDegree.get(neighbor) - 1);
        if (inDegree.get(neighbor) === 0) newZeroDegree.push(neighbor);
      }

      newZeroDegree.sort();
      
      // Append new zero-degree nodes to queue (O(1))
      for (const id of newZeroDegree) {
        queue.push(id);
      }
    }

    return sorted;
  }
}
