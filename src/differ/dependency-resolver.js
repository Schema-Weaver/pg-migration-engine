/**
 * Schema Weaver Migration Engine - Schema Differ
 * https://schemaweaver.vivekmind.com/
 */

export class DependencyResolver {
  constructor() {
    this.graph = new Map();
    this.edges = [];
    this.cycleDetected = false;
  }

  /**
   * Resolve order of all changes based on dependencies.
   */
  resolve(changes, desired, current) {
    // Build dependency graph
    this.buildGraph(changes, desired, current);

    // Topological sort (Kahn's algorithm)
    const sorted = this.topologicalSort(changes);

    // Assign phases
    return this.assignPhases(sorted);
  }

  /**
   * Build dependency graph from schema objects.
   */
  buildGraph(changes, desired, current) {
    this.graph.clear();
    this.edges = [];

    // Initialize all changes
    for (const change of changes) {
      this.graph.set(change.id, {
        id: change.id,
        change,
        dependencies: new Set(),
        dependents: new Set(),
      });
    }

    // Add dependencies based on object types
    for (const change of changes) {
      switch (change.objectType) {
        case 'column':
          this.addColumnDependencies(change, changes, desired, current);
          break;
        case 'constraint':
          this.addConstraintDependencies(change, changes, desired, current);
          break;
        case 'index':
          this.addIndexDependencies(change, changes, desired, current);
          break;
        case 'trigger':
          this.addTriggerDependencies(change, changes, desired, current);
          break;
        case 'policy':
          this.addPolicyDependencies(change, changes, desired, current);
          break;
        case 'view':
        case 'materializedView':
          this.addViewDependencies(change, changes, desired, current);
          break;
        case 'function':
          this.addFunctionDependencies(change, changes, desired, current);
          break;
        case 'type':
          this.addTypeDependencies(change, changes, desired, current);
          break;
        case 'sequence':
          this.addSequenceDependencies(change, changes, desired, current);
          break;
        case 'table':
          this.addTableDependencies(change, changes, desired, current);
          break;
      }
    }

    return this.graph;
  }

  addColumnDependencies(change, changes, desired, current) {
    // Column depends on its table
    const tableKey = this.getTableKey(change);
    const tableChange = changes.find(c => c.objectKey === tableKey && c.changeType === 'CREATE');
    if (tableChange) {
      this.addEdge(change.id, tableChange.id);
    }
  }

  addConstraintDependencies(change, changes, desired, current) {
    // Constraint depends on its table
    const tableKey = change.objectPath?.split('.').slice(0, 2).join('.');
    const tableChange = changes.find(c => c.objectKey === tableKey && c.changeType === 'CREATE');
    if (tableChange) {
      this.addEdge(change.id, tableChange.id);
    }

    // FK depends on referenced table
    if (change.changeType === 'ADD_FOREIGN_KEY' || change.constraintType === 'FOREIGN_KEY') {
      const refTable = change.referencedTable || change.after?.referencedTable;
      if (refTable) {
        const refTableChange = changes.find(c => c.objectKey === refTable);
        if (refTableChange) {
          this.addEdge(change.id, refTableChange.id);
        }
      }
    }
  }

  addIndexDependencies(change, changes, desired, current) {
    // Index depends on its table
    const tableKey = change.after?.table || change.before?.table;
    if (tableKey) {
      const tableChange = changes.find(c => c.objectKey === tableKey && c.changeType === 'CREATE');
      if (tableChange) {
        this.addEdge(change.id, tableChange.id);
      }
    }
  }

  addTriggerDependencies(change, changes, desired, current) {
    // Trigger depends on its table
    const tableKey = change.after?.table || change.before?.table;
    if (tableKey) {
      const tableChange = changes.find(c => c.objectKey === tableKey);
      if (tableChange) {
        this.addEdge(change.id, tableChange.id);
      }
    }

    // Trigger depends on its function
    const fnCall = change.after?.functionCall || change.before?.functionCall;
    if (fnCall) {
      const fnChange = changes.find(c => c.objectKey?.startsWith(fnCall));
      if (fnChange) {
        this.addEdge(change.id, fnChange.id);
      }
    }
  }

  addPolicyDependencies(change, changes, desired, current) {
    // Policy depends on its table
    const tableKey = change.after?.table || change.before?.table;
    if (tableKey) {
      const tableChange = changes.find(c => c.objectKey === tableKey);
      if (tableChange) {
        this.addEdge(change.id, tableChange.id);
      }
    }
  }

  addViewDependencies(change, changes, desired, current) {
    // View depends on tables/views/functions it references
    const definition = change.after?.definition || '';
    const deps = this.extractViewDependencies(definition);
    
    for (const dep of deps) {
      const depChange = changes.find(c => c.objectKey?.includes(dep));
      if (depChange) {
        this.addEdge(change.id, depChange.id);
      }
    }
  }

  addFunctionDependencies(change, changes, desired, current) {
    // Function depends on types it uses (argument types, return type)
    const types = new Set();

    // Extract from argument types
    const args = change.after?.argumentTypes || [];
    args.forEach(arg => {
      const t = this.extractTypeName(arg);

      if (
        t &&
        !['integer', 'bigint', 'text', 'boolean', 'uuid', 'timestamp', 'date'].includes(
          t.toLowerCase()
        )
      )
        types.add(t);
    });

    // Extract from return type
    const retType = change.after?.returnType;
    if (retType) {
      const t = this.extractTypeName(retType);
      if (t && !this.isBuiltInType(t)) {
        types.add(t);
      }
    }

    // Add dependencies
    for (const typeName of types) {
      const typeChange = changes.find(
        c => c.objectType === 'type' && c.objectKey?.includes(typeName)
      );
      if (typeChange) {
        this.addEdge(change.id, typeChange.id);
      }
    }
  }

  addTypeDependencies(change, changes, desired, current) {
    // Domain depends on base type
    if (change.after?.kind === 'DOMAIN' && change.after?.baseType) {
      const baseTypeChange = changes.find(
        c =>
          c.objectType === 'type' &&
          c.objectKey?.includes(change.after.baseType)
      );
      if (baseTypeChange) {
        this.addEdge(change.id, baseTypeChange.id);
      }
    }

    // Range depends on subtype
    if (change.after?.kind === 'RANGE' && change.after?.subtype) {
      const subTypeChange = changes.find(
        c =>
          c.objectType === 'type' &&
          c.objectKey?.includes(change.after.subtype)
      );
      if (subTypeChange) {
        this.addEdge(change.id, subTypeChange.id);
      }
    }
  }

  addSequenceDependencies(change, changes, desired, current) {
    // Sequence may be owned by a column
    const ownedBy = change.after?.ownedBy || change.before?.ownedBy;
    if (ownedBy) {
      const colChange = changes.find(c => c.objectKey === ownedBy);
      if (colChange) {
        this.addEdge(change.id, colChange.id);
      }
    }
  }

  addTableDependencies(change, changes, desired, current) {
    // Table depends on schema
    if (change.changeType === 'CREATE_TABLE') {
      const schemaChange = changes.find(
        c =>
          c.objectType === 'schema' &&
          c.objectKey === change.schema
      );
      if (schemaChange) {
        this.addEdge(change.id, schemaChange.id);
      }
    }

    // Table depends on extensions that provide types it uses
    // (e.g., PostGIS extension provides geometry types)
  }

  addEdge(fromId, toId) {
    if (!this.graph.has(fromId) || !this.graph.has(toId)) return;

    const from = this.graph.get(fromId);
    const to = this.graph.get(toId);

    to.dependents.add(fromId);
    from.dependencies.add(toId);

    this.edges.push({ from: fromId, to: toId, type: 'dependency' });
  }

  /**
   * Topological sort (Kahn's algorithm).
   */
  topologicalSort(changes) {
    const result = [];
    const inDegree = new Map();
    const nodes = new Map();

    // Initialize
    for (const [id, node] of this.graph) {
      inDegree.set(id, node.dependencies.size);
      nodes.set(id, { ...node });
    }

    // Queue for nodes with no dependencies
    const queue = [];

    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    // Sort queue by object type priority
    this.sortQueueByPriority(queue, changes);

    // Process
    while (queue.length > 0) {
      const currentId = queue.shift();
      const node = this.graph.get(currentId);

      if (!node) continue;

      result.push(node.change);

      // Update dependents
      for (const dependentId of node.dependents) {
        const newDegree = inDegree.get(dependentId) - 1;
        inDegree.set(dependentId, newDegree);

        if (newDegree === 0) {
          // Insert at correct position based on priority
          this.insertByPriority(queue, dependentId, changes);
        }
      }
    }

    // Check for cycles
    if (result.length !== changes.length) {
      this.cycleDetected = true;
      // Add remaining changes with cycle warning
      for (const change of changes) {
        if (!result.includes(change)) {
          change.cycleWarning = true;
          result.push(change);
        }
      }
    }

    return result;
  }

  sortQueueByPriority(queue, changes) {
    const priority = this.getObjectTypePriority();
    const changeMap = new Map(changes.map(c => [c.id, c]));

    queue.sort((a, b) => {
      const changeA = changeMap.get(a);
      const changeB = changeMap.get(b);

      const pA = priority[changeA?.objectType] || 99;
      const pB = priority[changeB?.objectType] || 99;

      if (pA !== pB) return pA - pB;
      return (a || '').localeCompare(b || '');
    });
  }

  insertByPriority(queue, id, changes) {
    const priority = this.getObjectTypePriority();
    const changeMap = new Map(changes.map(c => [c.id, c]));
    const change = changeMap.get(id);
    const p = priority[change?.objectType] || 99;

    let inserted = false;
    for (let i = 0; i < queue.length; i++) {
      const qChange = changeMap.get(queue[i]);
      const qP = priority[qChange?.objectType] || 99;

      if (p < qP || (p === qP && (id || '').localeCompare(queue[i] || '') < 0)) {
        queue.splice(i, 0, id);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      queue.push(id);
    }
  }

  getObjectTypePriority() {
    return {
      schema: 1,
      extension: 2,
      type: 3,
      sequence: 4,
      table: 5,
      column: 6,
      index: 7,
      constraint: 8,
      view: 9,
      materializedView: 10,
      function: 11,
      procedure: 12,
      trigger: 13,
      policy: 14,
      rule: 15,
      eventTrigger: 16,
      cast: 17,
      collation: 18,
      statistics: 19,
      publication: 20,
      subscription: 21,
      operator: 22,
      operatorClass: 23,
      operatorFamily: 24,
    };
  }

  /**
   * Assign migration phases.
   */
  assignPhases(changes) {
    for (const change of changes) {
      change.phase = this.computePhase(change);
    }

    return changes;
  }

  computePhase(change) {
    // Phase definitions:
    // 1-2: Pre-flight
    // 3: Extensions
    // 4: Types
    // 5: Schemas
    // 6: Tables (CREATE)
    // 7: Columns (ADD)
    // 8: Sequences
    // 9: Indexes (CREATE)
    // 10: Non-FK constraints
    // 11: Data migration
    // 12: FK constraints (ADD)
    // 13: Validate constraints
    // 14: Views
    // 15: Materialized views
    // 16: Functions
    // 17: Triggers
    // 18: Policies
    // 19: Rules
    // 20: Other behavioral
    // 21: Grants
    // 22: Comments
    // 23: Indexes CONCURRENTLY
    // 24: Cleanup
    // 25: Post-flight

    const type = change.objectType;
    const changeType = change.changeType;

    if (type === 'extension') return 3;
    if ((type === 'type' || type === 'domain') && changeType === 'CREATE') return 4;
    if (type === 'schema') return 5;
    if (type === 'sequence') return 5;
    if (type === 'table' && changeType === 'CREATE') return 6;
    if (type === 'index' && changeType === 'CREATE' && !change.isConcurrent) return 9;
    if (type === 'constraint' && change.constraintType !== 'FOREIGN_KEY') return 10;
    if (change.property === 'dataType' && change.castRequired) return 11;
    if (type === 'constraint' && change.constraintType === 'FOREIGN_KEY') return 12;
    if (change.property === 'isValidated' && change.changeType.includes('VALIDATE')) return 13;
    if (type === 'view') return 14;
    if (type === 'materializedView') return 15;
    if (type === 'function' || type === 'procedure') return 16;
    if (type === 'trigger') return 17;
    if (type === 'policy') return 18;
    if (type === 'rule') return 19;
    if (['eventTrigger', 'cast', 'operator', 'textSearchConfig', 'textSearchDict'].includes(type)) return 20;
    if (type === 'grant' || change.property === 'privileges') return 21;
    if (change.property === 'comment') return 22;
    if (type === 'index' && change.isConcurrent) return 23;
    if (change.property === 'notNull' && change.desiredValue === true && change.safePatternApplied) return 24;
    if (type === 'table' && changeType === 'DROP') return 24; // Drops last

    return 10; // Default
  }

  /**
   * Helper methods.
   */

  getTableKey(change) {
    return change.objectKey?.split('.').slice(0, 2).join('.');
  }

  extractViewDependencies(definition) {
    if (!definition) return [];
    const deps = [];

    // Extract table names from FROM/JOIN
    const fromMatch = definition.match(/(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi);
    if (fromMatch) {
      for (const m of fromMatch) {
        const tableName = m.split(/\s+/)[1];
        if (tableName && !this.isBuiltInTable(tableName)) {
          deps.push(tableName);
        }
      }
    }

    return deps;
  }

  extractTypeName(type) {
    if (!type) return null;
    return type.replace(/\[\]$/, '').replace(/\(.*\)$/, '').trim();
  }

  isBuiltInType(type) {
    const builtins = [
      'integer', 'bigint', 'smallint', 'serial', 'bigserial',
      'text', 'character varying', 'varchar', 'boolean', 'bool',
      'date', 'timestamp', 'timestamptz', 'time', 'timetz',
      'uuid', 'json', 'jsonb', 'bytea', 'real', 'double precision',
      'numeric', 'decimal', 'money',
    ];
    return builtins.includes(type.toLowerCase().trim());
  }

  isBuiltInTable(name) {
    const builtins = ['pg_catalog', 'information_schema'];
    return builtins.some(b => name.startsWith(b));
  }

  /**
   * Get the dependency graph.
   */
  getGraph() {
    return {
      nodes: Array.from(this.graph.keys()),
      edges: this.edges,
    };
  }
}
