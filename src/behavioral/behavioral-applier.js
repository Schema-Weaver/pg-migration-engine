/**
 * Schema Weaver Migration Engine - Behavioral DDL
 * https://schemaweaver.vivekmind.com/
 */

export class BehavioralApplier {
  /**
   * @param {import('pg').Pool} pool
   */
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get ordered changes for behavioral objects
   * @param {Array} changes
   * @returns {Array} Ordered behavioral changes
   */
  getOrder(changes) {
    const order = [
      'CREATE_FUNCTION',
      'REPLACE_FUNCTION',
      'RECREATE_FUNCTION',
      'CREATE_PROCEDURE',
      'REPLACE_PROCEDURE',
      'RECREATE_PROCEDURE',
      'CREATE_VIEW',
      'REPLACE_VIEW',
      'RECREATE_VIEW',
      'CREATE_MATERIALIZED_VIEW',
      'REPLACE_MATERIALIZED_VIEW',
      'RECREATE_MATERIALIZED_VIEW',
      'CREATE_TRIGGER',
      'RECREATE_TRIGGER',
      'ALTER_TRIGGER_ENABLE',
      'REPLACE_TRIGGER',
      'CREATE_POLICY',
      'REPLACE_POLICY',
      'RECREATE_POLICY',
      'CREATE_RULE',
      'REPLACE_RULE',
      'RECREATE_RULE',
      'CREATE_EVENT_TRIGGER',
      'RECREATE_EVENT_TRIGGER',
    ];

    return changes
      .filter(c => c.track === 2 || this.isBehavioral(c))
      .sort((a, b) => {
        const aIdx = order.indexOf(a.changeType);
        const bIdx = order.indexOf(b.changeType);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      });
  }

  /**
   * Check if object type is behavioral
   */
  isBehavioral(change) {
    const behavioralTypes = [
      'view', 'materializedView', 'function', 'procedure',
      'trigger', 'eventTrigger', 'policy', 'rule', 'aggregate'
    ];
    return behavioralTypes.includes(change.objectType);
  }

  /**
   * Generate SQL for a behavioral change
   * @param {Object} change
   * @returns {string}
   */
  generateSQL(change) {
    const changeType = change.changeType;
    const objectType = change.objectType;
    const obj = change.after || {};

    switch (true) {
      case changeType?.startsWith('CREATE') && objectType === 'view':
        return this.generateCreateView(change, obj);

      case changeType?.includes('REPLACE') && objectType === 'view':
        return `CREATE OR REPLACE VIEW ${change.objectKey} AS ${obj.definition || change.desiredValue};`;

      case changeType?.startsWith('CREATE') && objectType === 'materializedView':
        return this.generateCreateMatView(change, obj);

      case changeType?.startsWith('CREATE') && (objectType === 'function' || objectType === 'procedure'):
        return this.generateCreateFunction(change, obj);

      case changeType?.includes('REPLACE') && (objectType === 'function' || objectType === 'procedure'):
        return this.generateReplaceFunction(change, obj);

      case changeType?.startsWith('CREATE') && objectType === 'trigger':
        return this.generateCreateTrigger(change, obj);

      case changeType?.includes('RECREATE') && objectType === 'trigger':
        return this.generateRecreateTrigger(change, obj);

      case changeType === 'ALTER_TRIGGER_ENABLE':
        return this.generateAlterTriggerEnable(change, obj);

      case changeType?.startsWith('CREATE') && objectType === 'policy':
        return this.generateCreatePolicy(change, obj);

      case changeType?.includes('ALTER') && objectType === 'policy':
        return this.generateAlterPolicy(change, obj);

      case changeType?.startsWith('CREATE') && objectType === 'rule':
        return this.generateCreateRule(change, obj);

      case changeType?.startsWith('CREATE') && objectType === 'eventTrigger':
        return this.generateCreateEventTrigger(change, obj);

      default:
        return this.getBehavioralDefaultSQL(change);
    }
  }

  generateCreateView(change, view) {
    let sql = `CREATE VIEW ${change.objectKey}`;
    if (view.columns && view.columns.length > 0) {
      sql += ` (${view.columns.map(c => this.ident(c)).join(', ')})`;
    }
    sql += ` AS ${view.definition}`;
    if (view.checkOption) {
      sql += ` WITH ${view.checkOption} CHECK OPTION`;
    }
    return sql + ';';
  }

  generateCreateMatView(change, mv) {
    let sql = `CREATE MATERIALIZED VIEW ${change.objectKey}`;
    sql += ` AS ${mv.definition}`;
    if (mv.isWithData === false) {
      sql += ' WITH NO DATA';
    }
    return sql + ';';
  }

  generateCreateFunction(change, fn) {
    const keyword = change.objectType === 'procedure' ? 'PROCEDURE' : 'FUNCTION';
    const args = (fn.argumentTypes || []).join(', ');

    let sql = `CREATE ${keyword} ${change.objectKey}(${args})`;

    if (keyword === 'FUNCTION') {
      sql += ` RETURNS ${fn.returnType || 'void'}`;
    }

    sql += ` LANGUAGE ${fn.language || 'plpgsql'}`;

    if (fn.volatility && fn.volatility !== 'VOLATILE') {
      sql += ` ${fn.volatility}`;
    }
    if (fn.securityType === 'DEFINER') {
      sql += ' SECURITY DEFINER';
    }
    if (fn.isNullCall === false) {
      sql += ' RETURNS NULL ON NULL INPUT';
    }
    if (fn.parallelSafety) {
      sql += ` PARALLEL ${fn.parallelSafety}`;
    }
    if (fn.cost) {
      sql += ` COST ${fn.cost}`;
    }

    sql += ` AS $$${fn.source || ''}$$;`;
    return sql;
  }

  generateReplaceFunction(change, fn) {
    const keyword = change.objectType === 'procedure' ? 'PROCEDURE' : 'FUNCTION';
    const args = (fn.argumentTypes || change.before?.argumentTypes || []).join(', ');

    let sql = `CREATE OR REPLACE ${keyword} ${change.objectKey}(${args})`;

    if (keyword === 'FUNCTION') {
      sql += ` RETURNS ${fn.returnType || change.before?.returnType || 'void'}`;
    }

    sql += ` LANGUAGE ${fn.language || 'plpgsql'}`;
    sql += ` AS $$${fn.source || change.desiredValue || ''}$$;`;

    return sql;
  }

  generateCreateTrigger(change, trig) {
    let sql = `CREATE TRIGGER ${this.ident(trig.name)}`;
    sql += ` ${trig.timing}`;
    sql += ` ${(trig.events || ['INSERT']).join(' OR ')}`;
    sql += ` ON ${trig.schema ? this.ident(trig.schema) + '.' : ''}${this.ident(trig.tableName)}`;

    if (trig.isConstraint) {
      sql += ' FOR EACH ROW';
      if (trig.constraint) {
        sql += ` FROM ${trig.constraint}`;
      }
      if (trig.isDeferrable) {
        sql += ` DEFERRABLE INITIALLY ${trig.deferred ? 'DEFERRED' : 'IMMEDIATE'}`;
      }
    } else {
      sql += ` FOR EACH ${trig.orientation || 'ROW'}`;
    }

    if (trig.whenCondition) {
      sql += ` WHEN (${trig.whenCondition})`;
    }

    sql += ` EXECUTE FUNCTION ${trig.functionName}`;
    if (trig.functionArguments) {
      sql += `(${trig.functionArguments})`;
    }

    return sql + ';';
  }

  generateRecreateTrigger(change, trig) {
    const lines = [];
    const trigName = trig.name || change.name;
    const tableName = trig.tableName || change.after?.tableName;

    lines.push(`DROP TRIGGER IF EXISTS ${this.ident(trigName)} ON ${this.ident(tableName)};`);
    lines.push(this.generateCreateTrigger({ ...change, changeType: 'CREATE_TRIGGER' }, trig));

    return lines.join('\n');
  }

  generateAlterTriggerEnable(change, trig) {
    const trigName = trig.name || change.name;
    const tableName = trig.tableName || change.after?.tableName;
    const action = change.desiredValue === 'DISABLED' || change.desiredValue === false
      ? 'DISABLE'
      : 'ENABLE';

    return `ALTER TABLE ${this.ident(tableName)} ${action} TRIGGER ${this.ident(trigName)};`;
  }

  generateCreatePolicy(change, policy) {
    let sql = `CREATE POLICY ${this.ident(policy.name)} ON ${change.objectKey.split('.').slice(0, -1).join('.')}`;

    if (policy.isPermissive) {
      sql += ' AS PERMISSIVE';
    } else {
      sql += ' AS RESTRICTIVE';
    }

    if (policy.command) {
      sql += ` FOR ${policy.command}`;
    }

    if (policy.roles && policy.roles.length > 0) {
      sql += ' TO ' + policy.roles.map(r => r === 'PUBLIC' ? 'PUBLIC' : this.ident(r)).join(', ');
    } else {
      sql += ' TO PUBLIC';
    }

    if (policy.using) {
      sql += ` USING (${policy.using})`;
    }
    if (policy.withCheck) {
      sql += ` WITH CHECK (${policy.withCheck})`;
    }

    return sql + ';';
  }

  generateAlterPolicy(change, policy) {
    const parts = change.objectKey.split('.');
    const policyName = parts.pop();
    const tableName = parts.join('.');
    const lines = [];

    if (change.property === 'roles' && change.desiredValue) {
      const roles = change.desiredValue.map(r => r === 'PUBLIC' ? 'PUBLIC' : this.ident(r)).join(', ');
      lines.push(`ALTER POLICY ${this.ident(policyName)} ON ${tableName} TO ${roles};`);
    }
    if (change.property === 'using' && change.desiredValue !== undefined) {
      lines.push(`ALTER POLICY ${this.ident(policyName)} ON ${tableName} USING (${change.desiredValue || 'true'});`);
    }
    if (change.property === 'withCheck' && change.desiredValue) {
      lines.push(`ALTER POLICY ${this.ident(policyName)} ON ${tableName} WITH CHECK (${change.desiredValue});`);
    }

    return lines.length > 0 ? lines.join('\n') : `-- No ALTER_POLICY SQL for ${change.objectKey}`;
  }

  generateCreateRule(change, rule) {
    let sql = `CREATE RULE ${this.ident(rule.name)} AS`;
    sql += rule.isInstead ? ' ON INSTEAD' : ' ON';
    sql += ` ${rule.events?.join(' OR ') || 'INSERT'}`;
    sql += ` TO ${change.objectKey.split('.').slice(0, -1).join('.')}`;

    if (rule.condition) {
      sql += ` WHERE (${rule.condition})`;
    }

    if (rule.commands && rule.commands.length > 0) {
      sql += ' DO ';
      if (rule.commands.length > 1) {
        sql += `(${rule.commands.map(c => c.endsWith(';') ? c : c + ';').join(' ')})`;
      } else {
        sql += rule.commands[0];
      }
    } else {
      sql += ' DO INSTEAD NOTHING';
    }

    return sql + ';';
  }

  generateCreateEventTrigger(change, et) {
    let sql = `CREATE EVENT TRIGGER ${this.ident(et.name)}`;
    sql += ` ON ${et.event}`;

    if (et.tags && et.tags.length > 0) {
      sql += ` WHEN TAG IN (${et.tags.map(t => `'${t}'`).join(', ')})`;
    }

    sql += ` EXECUTE FUNCTION ${et.functionName}`;
    if (et.functionArguments) {
      sql += `(${et.functionArguments})`;
    }

    return sql + ';';
  }

  getBehavioralDefaultSQL(change) {
    if (change.changeType === 'DROP' || change.changeType?.startsWith('REMOVE')) {
      return this.generateDrop(change);
    }
    return `-- Unsupported behavioral change: ${change.changeType} ${change.objectType}`;
  }

  generateDrop(change) {
    const type = change.objectType;
    const path = change.objectKey;

    switch (type) {
      case 'view':
        return `DROP VIEW IF EXISTS ${path} CASCADE;`;
      case 'materializedView':
        return `DROP MATERIALIZED VIEW IF EXISTS ${path} CASCADE;`;
      case 'function':
        const fnArgs = change.before?.argumentTypes ? `(${change.before.argumentTypes.join(', ')})` : '';
        return `DROP FUNCTION IF EXISTS ${path}${fnArgs} CASCADE;`;
      case 'procedure':
        const procArgs = change.before?.argumentTypes ? `(${change.before.argumentTypes.join(', ')})` : '';
        return `DROP PROCEDURE IF EXISTS ${path}${procArgs} CASCADE;`;
      case 'trigger':
        const tableName = change.before?.tableName;
        return `DROP TRIGGER IF EXISTS ${this.ident(change.name)} ON ${tableName};`;
      case 'policy':
        const polTable = change.before?.table;
        return `DROP POLICY IF EXISTS ${this.ident(change.name)} ON ${polTable};`;
      case 'rule':
        const ruleTable = change.before?.tableName;
        return `DROP RULE IF EXISTS ${this.ident(change.name)} ON ${ruleTable};`;
      case 'eventTrigger':
        return `DROP EVENT TRIGGER IF EXISTS ${this.ident(change.name)};`;
      default:
        return `-- Unsupported DROP for ${type}`;
    }
  }

  ident(name) {
    if (!name) return "''";
    if (typeof name !== 'string') name = String(name);
    return `"${name.replace(/"/g, '""')}"`;
  }
}
