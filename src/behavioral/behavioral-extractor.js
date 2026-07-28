/**
 * Schema Weaver Migration Engine - Behavioral DDL
 * https://schemaweaver.vivekmind.com/
 */

export class BehavioralExtractor {
  /**
   * Extract behavioral objects from a SchemaSnapshot
   * @param {Object} snapshot - SchemaSnapshot from introspector
   * @returns {Object} Extracted behavioral objects
   */
  extractFromSnapshot(snapshot) {
    const behavioral = {
      views: [],
      materializedViews: [],
      functions: [],
      procedures: [],
      triggers: [],
      policies: [],
      rules: [],
      eventTriggers: [],
    };

    if (!snapshot || typeof snapshot !== 'object') {
      return behavioral;
    }

    for (const [schemaName, schema] of Object.entries(snapshot.schemas || {})) {
      this.extractViews(schema, schemaName, behavioral);
      this.extractFunctions(schema, schemaName, behavioral);
      this.extractTriggers(schema, schemaName, behavioral);
      this.extractPolicies(schema, schemaName, behavioral);
      this.extractRules(schema, schemaName, behavioral);
    }

    for (const [name, et] of Object.entries(snapshot.eventTriggers || {})) {
      behavioral.eventTriggers.push({
        name: et.name || name,
        event: et.event,
        functionName: et.functionName,
        enabled: et.enabled,
        tags: et.tags,
        functionDependency: et.functionName,
      });
    }

    return behavioral;
  }

  extractViews(schema, schemaName, behavioral) {
    for (const view of schema.views || []) {
      const viewObj = {
        schema: schemaName,
        name: view.name,
        definition: view.definition,
        checkOption: view.checkOption,
        securityBarrier: view.securityBarrier,
        securityInvoker: view.securityInvoker,
        owner: view.owner,
        dependencies: this.extractDependenciesFromSQL(view.definition, schemaName),
      };
      behavioral.views.push(viewObj);
    }

    for (const mv of schema.materializedViews || []) {
      behavioral.materializedViews.push({
        schema: schemaName,
        name: mv.name,
        definition: mv.definition,
        isWithData: mv.isWithData,
        tablespace: mv.tablespace,
        dependencies: this.extractDependenciesFromSQL(mv.definition, schemaName),
      });
    }
  }

  extractFunctions(schema, schemaName, behavioral) {
    for (const fn of schema.functions || []) {
      behavioral.functions.push({
        schema: schemaName,
        name: fn.name,
        argumentTypes: fn.argumentTypes || [],
        returnType: fn.returnType,
        source: fn.source,
        language: fn.language,
        volatility: fn.volatility,
        isNullCall: fn.isNullCall,
        securityType: fn.securityType,
        parallelSafety: fn.parallelSafety,
        cost: fn.cost,
        rows: fn.rows,
        owner: fn.owner,
        typeDependencies: this.extractTypeDependencies(fn),
      });
    }

    for (const proc of schema.procedures || []) {
      behavioral.procedures.push({
        schema: schemaName,
        name: proc.name,
        argumentTypes: proc.argumentTypes || [],
        source: proc.source,
        language: proc.language,
        owner: proc.owner,
        typeDependencies: this.extractTypeDependencies(proc),
        isProcedure: true,
      });
    }
  }

  extractTriggers(schema, schemaName, behavioral) {
    for (const trigger of schema.triggers || []) {
      behavioral.triggers.push({
        schema: schemaName,
        name: trigger.name,
        tableName: trigger.tableName,
        timing: trigger.timing,
        events: trigger.events,
        functionName: trigger.functionName,
        functionArguments: trigger.functionArguments,
        whenCondition: trigger.whenCondition,
        orientation: trigger.orientation,
        enabled: trigger.enabled,
        isConstraint: trigger.isConstraint,
        functionDependency: trigger.functionName,
      });
    }
  }

  extractPolicies(schema, schemaName, behavioral) {
    for (const policy of schema.policies || []) {
      behavioral.policies.push({
        schema: schemaName,
        name: policy.name,
        tableName: policy.tableName,
        command: policy.command,
        roles: policy.roles,
        using: policy.using,
        withCheck: policy.withCheck,
        isPermissive: policy.isPermissive,
        functionDependencies: [
          ...this.extractFunctionRefs(policy.using),
          ...this.extractFunctionRefs(policy.withCheck),
        ],
      });
    }
  }

  extractRules(schema, schemaName, behavioral) {
    for (const rule of schema.rules || []) {
      behavioral.rules.push({
        schema: schemaName,
        name: rule.name,
        tableName: rule.tableName,
        events: rule.events,
        isInstead: rule.isInstead,
        commands: rule.commands,
        condition: rule.condition,
      });
    }
  }

  /**
   * Extract table/view/function dependencies from SQL
   */
  extractDependenciesFromSQL(sql, currentSchema) {
    if (!sql) return [];

    const deps = [];
    const normalizedSQL = sql.toLowerCase();

    const fromPattern = /(?:from|join)\s+(?:(\w+)\.)?(\w+)/gi;
    let match;
    while ((match = fromPattern.exec(normalizedSQL)) !== null) {
      const schema = match[1] || currentSchema;
      const name = match[2];
      const keywords = ['select', 'where', 'and', 'or', 'on', 'as', 'set', 'into', 'values', 'table', 'only', 'update', 'delete', 'insert'];
      if (!keywords.includes(name)) {
        deps.push({ schema, name, type: 'table_or_view' });
      }
    }

    return deps;
  }

  /**
   * Extract function references from an expression
   */
  extractFunctionRefs(expression) {
    if (!expression) return [];

    const refs = [];
    const fnPattern = /(\w+)\s*\(/gi;
    let match;
    while ((match = fnPattern.exec(expression)) !== null) {
      const fnName = match[1].toLowerCase();
      const keywords = ['coalesce', 'nullif', 'case', 'cast', 'exists', 'not', 'and', 'or', 'in', 'any', 'all', 'some', 'count', 'sum', 'avg', 'min', 'max', 'array', 'row', 'current_setting', 'concat', 'replace', 'substring'];
      if (!keywords.includes(fnName)) {
        refs.push(fnName);
      }
    }
    return refs;
  }

  /**
   * Extract type dependencies from a function
   */
  extractTypeDependencies(fn) {
    const deps = [];

    for (const argType of fn.argumentTypes || []) {
      if (!this.isBuiltInType(argType)) {
        deps.push(argType);
      }
    }

    if (fn.returnType && !this.isBuiltInType(fn.returnType)) {
      deps.push(fn.returnType);
    }

    return deps;
  }

  /**
   * Check if a type is built-in
   */
  isBuiltInType(typeName) {
    if (!typeName) return true;
    const builtins = [
      'integer', 'bigint', 'smallint', 'int', 'int2', 'int4', 'int8',
      'serial', 'bigserial', 'smallserial', 'serial2', 'serial4', 'serial8',
      'real', 'double precision', 'float', 'float4', 'float8', 'numeric', 'decimal', 'money',
      'character varying', 'varchar', 'character', 'char', 'text',
      'boolean', 'bool',
      'date', 'time', 'timestamp', 'timestamptz', 'timetz', 'interval',
      'uuid', 'json', 'jsonb', 'xml',
      'bytea', 'bit', 'bit varying', 'varbit',
      'point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle',
      'inet', 'cidr', 'macaddr', 'macaddr8',
      'tsvector', 'tsquery',
      'oid', 'regclass', 'regtype', 'regproc', 'regprocedure', 'regoper',
      'record', 'void', 'trigger', 'event_trigger',
      'any', 'anyelement', 'anyarray', 'anynonarray', 'anyenum', 'anyrange', 'anymultirange',
    ];
    const normalized = typeName.toLowerCase().replace(/\[\]$/, '').replace(/\s+/g, ' ');
    return builtins.includes(normalized) || normalized.startsWith('"pg_');
  }

  /**
   * Get execution order for behavioral objects
   */
  getExecutionOrder(behavioral) {
    const order = [];

    order.push(...(behavioral.functions || []).filter(f => !f.isProcedure));
    order.push(...(behavioral.procedures || []));
    order.push(...(behavioral.views || []));
    order.push(...(behavioral.materializedViews || []));
    order.push(...(behavioral.triggers || []));
    order.push(...(behavioral.policies || []));
    order.push(...(behavioral.rules || []));
    order.push(...(behavioral.eventTriggers || []));

    return order;
  }
}
