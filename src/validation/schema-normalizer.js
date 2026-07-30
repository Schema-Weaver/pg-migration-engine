export function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    throw new Error('Schema must be a non-null object');
  }

  const normalized = { ...schema };

  // Normalize tables array to object
  if (Array.isArray(normalized.tables)) {
    const tablesObj = {};
    for (const table of normalized.tables) {
      if (!table.name) {
        throw new Error('Each table must have a "name" property');
      }
      const schemaName = table.schema || 'public';
      const key = `${schemaName}.${table.name}`;
      tablesObj[key] = {
        ...table,
        schema: schemaName,
        name: table.name,
        columns: (table.columns || []).map(normalizeColumn),
      };
    }
    normalized.tables = tablesObj;
  } else if (normalized.tables && typeof normalized.tables === 'object') {
    // Normalize columns in object format too
    for (const [key, table] of Object.entries(normalized.tables)) {
      if (table.columns) {
        normalized.tables[key] = {
          ...table,
          columns: table.columns.map(normalizeColumn),
        };
      }
    }
  }

  // Normalize types array to object
  if (Array.isArray(normalized.types)) {
    const typesObj = {};
    for (const type of normalized.types) {
      if (!type.name) {
        throw new Error('Each type must have a "name" property');
      }
      const schemaName = type.schema || 'public';
      const key = `${schemaName}.${type.name}`;
      typesObj[key] = {
        ...type,
        schema: schemaName,
        name: type.name,
      };
      // Validate enum values
      if (type.kind === 'ENUM' || type.enumValues) {
        if (!type.enumValues || !Array.isArray(type.enumValues)) {
          throw new Error(
            `ENUM type "${type.name}" must have "enumValues" array. ` +
            `Example: { name: "status", kind: "ENUM", enumValues: ["active", "inactive"] }`
          );
        }
      }
    }
    normalized.types = typesObj;
  }

  // Normalize views array to object
  if (Array.isArray(normalized.views)) {
    const viewsObj = {};
    for (const view of normalized.views) {
      if (!view.name) {
        throw new Error('Each view must have a "name" property');
      }
      const schemaName = view.schema || 'public';
      const key = `${schemaName}.${view.name}`;
      viewsObj[key] = {
        ...view,
        schema: schemaName,
        name: view.name,
      };
    }
    normalized.views = viewsObj;
  }

  // Normalize functions array to object
  if (Array.isArray(normalized.functions)) {
    const functionsObj = {};
    for (const fn of normalized.functions) {
      if (!fn.name) {
        throw new Error('Each function must have a "name" property');
      }
      const schemaName = fn.schema || 'public';
      const args = (fn.argumentTypes || []).join(',');
      const key = `${schemaName}.${fn.name}(${args})`;
      functionsObj[key] = {
        ...fn,
        schema: schemaName,
        name: fn.name,
      };
    }
    normalized.functions = functionsObj;
  }

  // Normalize sequences array to object
  if (Array.isArray(normalized.sequences)) {
    const sequencesObj = {};
    for (const seq of normalized.sequences) {
      if (!seq.name) {
        throw new Error('Each sequence must have a "name" property');
      }
      const schemaName = seq.schema || 'public';
      const key = `${schemaName}.${seq.name}`;
      sequencesObj[key] = {
        ...seq,
        schema: schemaName,
        name: seq.name,
      };
    }
    normalized.sequences = sequencesObj;
  }

  // Normalize indexes array to object
  if (Array.isArray(normalized.indexes)) {
    const indexesObj = {};
    for (const idx of normalized.indexes) {
      if (!idx.name) {
        throw new Error('Each index must have a "name" property');
      }
      const schemaName = idx.schema || 'public';
      const key = `${schemaName}.${idx.name}`;
      indexesObj[key] = normalizeIndex({
        ...idx,
        schema: schemaName,
        name: idx.name,
      });
    }
    normalized.indexes = indexesObj;
  } else if (normalized.indexes && typeof normalized.indexes === 'object') {
    for (const [key, idx] of Object.entries(normalized.indexes)) {
      normalized.indexes[key] = normalizeIndex(idx);
    }
  }

  // Normalize triggers array
  if (Array.isArray(normalized.triggers)) {
    const triggersObj = {};
    for (const trig of normalized.triggers) {
      if (!trig.name) {
        throw new Error('Each trigger must have a "name" property');
      }
      const schemaName = trig.schema || 'public';
      const key = `${schemaName}.${trig.name}`;
      triggersObj[key] = {
        ...trig,
        schema: schemaName,
        name: trig.name,
      };
    }
    normalized.triggers = triggersObj;
  }

  // Normalize constraints array
  if (Array.isArray(normalized.constraints)) {
    const constraintsObj = {};
    for (const con of normalized.constraints) {
      if (!con.name) {
        throw new Error('Each constraint must have a "name" property');
      }
      const key = con.name;
      constraintsObj[key] = con;
    }
    normalized.constraints = constraintsObj;
  }

  return normalized;
}

export function normalizeColumn(col) {
  if (!col || typeof col !== 'object') {
    throw new Error('Column must be a non-null object');
  }
  const dataType = col.dataType || col.type;
  if (!dataType) {
    throw new Error(
      `Column "${col.name || '?'}" must have either "dataType" or "type" property. ` +
      `Example: { name: "created_at", dataType: "timestamp" } or { name: "id", type: "serial" }`
    );
  }
  return {
    ...col,
    dataType,
    type: dataType,
  };
}

export function normalizeIndex(idx) {
  if (!idx || typeof idx !== 'object') {
    throw new Error('Index must be a non-null object');
  }
  if (!idx.columns) {
    return idx;
  }
  const normalizedColumns = idx.columns.map(c => {
    if (typeof c === 'string') {
      return { name: c };
    }
    if (c.expression) {
      return c;
    }
    if (!c.name) {
      throw new Error(
        'Index column must have "name" or "expression" property. ' +
        'Example: { columns: ["email"] } or { columns: [{ name: "email" }] }'
      );
    }
    return c;
  });
  return {
    ...idx,
    columns: normalizedColumns,
  };
}

export function validateSchemaFormat(schema) {
  const errors = [];

  if (!schema) {
    errors.push('Schema is null or undefined');
    return { valid: false, errors };
  }

  if (typeof schema !== 'object' || Array.isArray(schema)) {
    errors.push(`Schema must be an object, got ${Array.isArray(schema) ? 'array' : typeof schema}`);
    return { valid: false, errors };
  }

  // Validate tables
  if (schema.tables) {
    if (Array.isArray(schema.tables)) {
      schema.tables.forEach((t, i) => {
        if (!t.name) errors.push(`tables[${i}]: missing "name" property`);
        if (!t.columns && !t.isPartition) errors.push(`tables[${i}] "${t.name || '?'}": missing "columns" array`);
        if (t.columns) {
          t.columns.forEach((c, ci) => {
            if (!c.dataType && !c.type) {
              errors.push(`tables[${i}].columns[${ci}] "${c.name || '?'}": missing "dataType" or "type"`);
            }
          });
        }
      });
    } else if (typeof schema.tables === 'object') {
      Object.entries(schema.tables).forEach(([key, t]) => {
        if (!t.name) errors.push(`tables["${key}"]: missing "name" property`);
        if (!t.columns && !t.isPartition) errors.push(`tables["${key}"]: missing "columns" array`);
        if (t.columns) {
          t.columns.forEach((c, ci) => {
            if (!c.dataType && !c.type) {
              errors.push(`tables["${key}"].columns[${ci}] "${c.name || '?'}": missing "dataType" or "type"`);
            }
          });
        }
      });
    }
  }

  // Validate types (enums)
  if (schema.types) {
    if (Array.isArray(schema.types)) {
      schema.types.forEach((t, i) => {
        if (!t.name) errors.push(`types[${i}]: missing "name" property`);
        if (t.kind === 'ENUM' || t.enumValues !== undefined) {
          if (!t.enumValues) {
            errors.push(`types[${i}] "${t.name || '?'}": ENUM type missing "enumValues" array`);
          } else if (!Array.isArray(t.enumValues)) {
            errors.push(`types[${i}] "${t.name || '?'}": "enumValues" must be an array`);
          } else if (t.enumValues.length === 0) {
            errors.push(`types[${i}] "${t.name || '?'}": ENUM type has empty "enumValues" array`);
          }
        }
      });
    } else if (typeof schema.types === 'object') {
      Object.entries(schema.types).forEach(([key, t]) => {
        if (!t.name) errors.push(`types["${key}"]: missing "name" property`);
        if (t.kind === 'ENUM' || t.enumValues !== undefined) {
          if (!t.enumValues) {
            errors.push(`types["${key}"]: ENUM type missing "enumValues" array`);
          } else if (!Array.isArray(t.enumValues)) {
            errors.push(`types["${key}"]: "enumValues" must be an array`);
          } else if (t.enumValues.length === 0) {
            errors.push(`types["${key}"]: ENUM type has empty "enumValues" array`);
          }
        }
      });
    }
  }

  // Validate indexes
  if (schema.indexes) {
    if (Array.isArray(schema.indexes)) {
      schema.indexes.forEach((idx, i) => {
        if (!idx.name) errors.push(`indexes[${i}]: missing "name" property`);
        if (!idx.table && !idx.tableName) errors.push(`indexes[${i}] "${idx.name || '?'}": missing "table" property`);
        if (idx.columns) {
          if (!Array.isArray(idx.columns)) {
            errors.push(`indexes[${i}] "${idx.name || '?'}": "columns" must be an array`);
          } else if (idx.columns.length === 0) {
            errors.push(`indexes[${i}] "${idx.name || '?'}": "columns" array is empty`);
          }
        }
      });
    }
  }

  // Validate foreign key ordering hints
  if (schema.tables) {
    const tableNames = new Set();
    const tables = Array.isArray(schema.tables) ? schema.tables : Object.values(schema.tables);
    tables.forEach(t => {
      if (t.name) {
        const schemaName = t.schema || 'public';
        tableNames.add(`${schemaName}.${t.name}`);
      }
    });
    
    // Check for FK references
    tables.forEach(t => {
      if (t.constraints) {
        t.constraints.forEach(con => {
          if (con.constraintType === 'FOREIGN_KEY' || con.type === 'FOREIGN_KEY') {
            const refTable = con.referencedTable || con.refTable;
            if (refTable && !tableNames.has(refTable) && !tableNames.has(`public.${refTable}`)) {
              errors.push(`Table "${t.name}" has FK to "${refTable}" but that table is not defined in schema`);
            }
          }
        });
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function generateSchemaExample() {
  return {
    tables: {
      'public.users': {
        name: 'users',
        schema: 'public',
        columns: [
          { name: 'id', dataType: 'serial', isNullable: false },
          { name: 'email', dataType: 'varchar(255)', isNullable: false },
          { name: 'created_at', dataType: 'timestamp', isNullable: false },
        ],
        constraints: [
          { name: 'users_pkey', constraintType: 'PRIMARY_KEY', columns: ['id'] },
          { name: 'users_email_unique', constraintType: 'UNIQUE', columns: ['email'] },
        ],
      },
      'public.posts': {
        name: 'posts',
        schema: 'public',
        columns: [
          { name: 'id', dataType: 'serial', isNullable: false },
          { name: 'user_id', dataType: 'integer', isNullable: false },
          { name: 'title', dataType: 'text', isNullable: false },
        ],
        constraints: [
          { name: 'posts_pkey', constraintType: 'PRIMARY_KEY', columns: ['id'] },
          { name: 'posts_user_id_fkey', constraintType: 'FOREIGN_KEY', columns: ['user_id'], referencedTable: 'public.users', referencedColumns: ['id'] },
        ],
      },
    },
    types: {
      'public.status': {
        name: 'status',
        schema: 'public',
        kind: 'ENUM',
        enumValues: ['draft', 'published', 'archived'],
      },
    },
    indexes: {
      'public.posts_user_id_idx': {
        name: 'posts_user_id_idx',
        schema: 'public',
        table: 'posts',
        columns: [{ name: 'user_id' }],
      },
    },
  };
}
