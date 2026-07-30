# pg-migration-engine

[![npm version](https://img.shields.io/npm/v/pg-migration-engine.svg)](https://www.npmjs.com/package/pg-migration-engine)
[![license](https://img.shields.io/badge/license-BSL--1.1-red.svg)](https://github.com/Schema-Weaver/pg-migration-engine/blob/main/LICENSE)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-10%20%E2%80%93%2018-blue.svg)](https://www.postgresql.org/)

**PostgreSQL schema introspection, diff, DDL generation, and safe migration execution.**

---

## Why This Exists

No existing open-source tool covers PostgreSQL object types comprehensively:

| Tool | Coverage | Limitations |
|------|----------|-------------|
| pgAdmin | UI only | No programmatic API, no diff |
| Atlas | ~15 types | Missing views, functions, triggers, policies |
| Prisma | ~10 types | Ignores behavioral objects entirely |
| Django Migrations | ~12 types | ORM-specific, limited DDL control |

**This engine covers EVERYTHING** — 50+ object types with extensive property coverage.

---

## Supported Object Types (50+)

### Track 1: Structural Objects

| Type | Category | Coverage |
|------|----------|----------|
| Table | Core | Full |
| Column | Core | Full |
| Index | Core | Full |
| Constraint (PK/FK/UNIQUE/CHECK/EXCLUSION) | Core | Full |
| Sequence | Core | Full |
| Enum Type | Type System | Full |
| Composite Type | Type System | Full |
| Domain Type | Type System | Full |
| Range Type | Type System | Full |
| Multirange Type | Type System (PG14+) | Full |
| Schema | Container | Full |
| Extension | Package | Full |
| Statistics | Optimizer | Full |
| Partition | Table Property | Full |
| Collation | Locale | ~90% |
| Cast | Type System | Full |
| Operator | Advanced | Full |
| Operator Class | Advanced | Full |
| Operator Family | Advanced | Full |
| Access Method | Storage | Full |
| Foreign Table | FDW | Full |
| Default Privileges | ACL | Full |

### Track 2: Behavioral Objects

| Type | Category | Coverage |
|------|----------|----------|
| View | Query | Full |
| Materialized View | Query | Full |
| Function | Procedural | Full |
| Procedure | Procedural (PG11+) | Full |
| Aggregate | Procedural | Full |
| Trigger | Automation | Full |
| Event Trigger | Automation | Full |
| Policy | RLS | Full |
| Rule | Rewrite | Full |
| Text Search Config | FTS | Full |
| Text Search Dictionary | FTS | Full |
| Text Search Parser | FTS | Full |
| Text Search Template | FTS | Full |
| Conversion | Encoding | Full |
| Foreign Data Wrapper | FDW | Full |
| Foreign Server | FDW | Full |
| User Mapping | FDW | Full |

### Track 3: Cross-Database Objects

| Type | Category | Coverage |
|------|----------|----------|
| Database | Instance | Full |
| Tablespace | Storage | Full |
| Role | Auth | Full |
| Publication | Replication | Full |
| Subscription | Replication | Full |

**Overall: 190+ properties tracked across PG10–PG18**

---

## Architecture (8 Modules)

```
SQL ──► Introspector ──► Translator ──► Differ ──► DDL Generator ──► Planner ──► Executor
                                │                      │                         │
                                ▼                      ▼                         ▼
                           Risk Tagger          Safe Patterns              Storage
                       (assess change risk)                              (history)
                                                                          │
                                                                          ▼
                                                                    Behavioral
                                                                  (views/fns/triggers)
```

| Module | Purpose |
|--------|---------|
| **Introspector** | Queries `pg_catalog` for 50+ object types |
| **Translator** | Normalizes raw PG rows into canonical schema model |
| **Differ** | Detects CREATE/ALTER/DROP/RENAME with property-level diff |
| **Risk Tagger** | 5-level risk assessment per change |
| **DDL Generator** | Generates safe DDL with 6+ safe patterns |
| **Planner** | Dependency-ordered, phase-based plan (Track 1 → Track 2) |
| **Executor** | Advisory locks, savepoints, drift detection, progress |
| **Storage** | Migration history (PostgreSQL / Memory / File / GitHub backends) |

---

## Installation

```bash
npm install pg-migration-engine
```

---

## Quick Start

```javascript
import pg from 'pg';
import { SwMigrationEngine } from 'pg-migration-engine';

const pool = new pg.Pool({ 
  host: 'localhost', 
  port: 5432,
  database: 'mydb',
  user: 'postgres',
  password: 'pass'
});

const engine = new SwMigrationEngine();

// Introspect current database
const snapshot = await engine.introspect(pool);

// Diff against desired schema
const desired = /* your target schema */;
const diff = engine.diff(desired, snapshot);

// Generate DDL
const ddl = engine.generateDDL(diff);

// Plan migration respecting dependencies
const plan = engine.plan(diff);

// Execute with safety checks
if (!plan.blocked) {
  const result = await engine.execute(pool, plan);
  console.log('Migrated:', result.migrationId);
}

// Or one-shot migrate
const result = await engine.migrate(pool, desired);
```

---

## Schema Format

The `desired` schema can be provided in two formats:

### Object Format (Recommended)

```javascript
const desired = {
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
    'public.users_email_idx': {
      name: 'users_email_idx',
      schema: 'public',
      table: 'users',
      columns: [{ name: 'email' }],
    },
  },
};
```

### Array Format (Auto-converted)

```javascript
// Arrays are automatically converted to object format
const desired = {
  tables: [
    { name: 'users', columns: [{ name: 'id', type: 'serial' }] },
  ],
  types: [
    { name: 'status', kind: 'ENUM', enumValues: ['active', 'inactive'] },
  ],
  indexes: [
    { name: 'email_idx', table: 'users', columns: ['email'] }, // strings auto-converted
  ],
};
```

### Column Format

Columns accept both `dataType` and `type`:

```javascript
// Both work:
{ name: 'id', dataType: 'serial' }
{ name: 'id', type: 'serial' }

// Full example:
{ 
  name: 'created_at', 
  dataType: 'timestamp', 
  isNullable: false,
  defaultValue: 'now()'
}
```

### Index Columns

Index columns can be strings or objects:

```javascript
// All work:
columns: ['email', 'name']
columns: [{ name: 'email' }, { name: 'name' }]
columns: [{ expression: 'lower(email)' }]
```

### Normalization Helper

```javascript
import { normalizeSchema, validateSchemaFormat } from 'pg-migration-engine';

// Normalize array format to object format
const normalized = normalizeSchema(schema);

// Validate schema format
const { valid, errors } = validateSchemaFormat(schema);
if (!valid) {
  console.error('Schema errors:', errors);
}
```

---

## Key Features

### 50+ PostgreSQL Object Types
Most comprehensive coverage available. See [Supported Objects](https://github.com/Schema-Weaver/pg-migration-engine/wiki/Supported-Objects).

### PG 10–18 Support
Version-gated queries automatically adapt to your PostgreSQL version.

### Safe Migration Patterns (6+ patterns)

| Pattern | How It Works |
|---------|--------------|
| **NOT NULL** | 3-step: CHECK(NOT VALID) → validate → SET NOT NULL |
| **FK Constraint** | ADD NOT VALID → validate separately |
| **Index** | CREATE INDEX CONCURRENTLY for zero-downtime |
| **Enum ADD VALUE** | Pre-transaction for PG < 14 |
| **UNIQUE constraint** | CREATE UNIQUE INDEX CONCURRENTLY → ADD CONSTRAINT USING INDEX |
| **CHECK constraint** | ADD NOT VALID → validate separately |
| **Type change** | ALTER TYPE with USING clause for explicit conversion |

### 5-Level Risk Assessment

| Level | Examples | Default |
|-------|----------|---------|
| `none` | CREATE TABLE, ADD nullable column | ✅ Allow |
| `low` | ADD COLUMN with default, CREATE INDEX | ✅ Allow |
| `medium` | ALTER COLUMN type (widening) | ✅ Allow |
| `high` | DROP INDEX, ALTER type (narrowing) | ❌ Block |
| `critical` | DROP TABLE, DROP COLUMN | ❌ Block |

### RENAME Detection
Smart matching detects renames instead of DROP+CREATE, preserving data.

### Drift Detection
Fingerprint-based schema drift alerts when database changed outside migrations.

### Rollback Generation
Automatic reverse DDL for supported changes.

### Non-Transactional Aware
Handles `ALTER ENUM ADD VALUE`, `CREATE INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY` outside transactions.

---

## API Reference

| Method | Description |
|--------|-------------|
| `introspect(pool)` | Capture database schema as `SchemaSnapshot` |
| `diff(desired, current)` | Detect changes between schemas |
| `generateDDL(diff)` | Generate PostgreSQL DDL statements |
| `plan(diff)` | Create dependency-ordered migration plan |
| `execute(pool, plan)` | Apply migration transactionally |
| `migrate(pool, desired)` | One-shot: introspect → diff → plan → execute |
| `rollback(pool, migrationId)` | Revert migration (best-effort) |
| `createMigrationPlan(changes)` | Create plan from change array (alias) |
| `diffSchemas(desired, current)` | Alias for `diff()` |

Full API: [API Reference](https://github.com/Schema-Weaver/pg-migration-engine/wiki/API-Reference)

---

## Ecosystem

| Package | Purpose |
|---------|---------|
| **[sw-agent](https://www.npmjs.com/package/@vivekmind/sw-agent)** | PostgreSQL connection pool, security, audit |
| **[pg-ddl-parser](https://www.npmjs.com/package/pg-ddl-parser)** | DDL parsing (CREATE/ALTER/DROP → schema) |
| **pg-migration-engine** | Schema introspection, diff, migration |

```javascript
import { parsePostgresSQL } from 'pg-ddl-parser';
import { SwMigrationEngine } from 'pg-migration-engine';

// Parse DDL → desired schema
const desired = parsePostgresSQL(fs.readFileSync('schema.sql', 'utf8'));

// Migrate
const engine = new SwMigrationEngine();
await engine.migrate(pool, convertParsedToSnapshot(desired));
```

---

## Test Results

| Layer | Test | Assertions | Result |
|-------|------|------------|--------|
| 1 | Introspection Accuracy | 93 | ✅ 100% PASS |
| 2 | Diff Detection | — | ✅ PASS |
| 3 | E2E Pipeline | 12 | ✅ 100% PASS |
| 4 | Planner Order | — | ✅ Phase order verified |
| 5 | Execution | — | Partial — needs production |
| 6 | Recovery | — | Pending |

Tested against **PostgreSQL 18.1** with a 25-table, 4-schema, 1052-object database.

---

## Documentation

- [Architecture](https://github.com/Schema-Weaver/pg-migration-engine/wiki/Architecture) — 8-module deep dive
- [Supported Objects](https://github.com/Schema-Weaver/pg-migration-engine/wiki/Supported-Objects) — Full 50+ type coverage
- [Safe Patterns](https://github.com/Schema-Weaver/pg-migration-engine/wiki/Safe-Migration-Patterns) — 6+ safe workflows
- [Risk Assessment](https://github.com/Schema-Weaver/pg-migration-engine/wiki/Risk-Assessment) — 5 levels explained
- [PG Version Matrix](https://github.com/Schema-Weaver/pg-migration-engine/wiki/PG-Version-Matrix) — Feature support PG10-18

---

## PostgreSQL Version Support

| Version | Status | Key Features |
|---------|--------|--------------|
| PG 10 | ✅ | Generated columns |
| PG 11 | ✅ | Procedures, INCLUDE indexes |
| PG 12 | ✅ | GENERATED ALWAYS |
| PG 13 | ✅ | Incremental sort |
| PG 14 | ✅ | Multirange, security invoker |
| PG 15 | ✅ | NULLS NOT DISTINCT |
| PG 16 | ✅ | ANY_VALUE |
| PG 17 | ✅ | MERGE improvements |
| PG 18 | ✅ | Temporal tables, PERIOD, NOT ENFORCED constraints |

---

## License

Business Source License 1.1 (BSL) — see [LICENSE](./LICENSE)

- ✅ Free for development, testing, evaluation
- ✅ Free for non-production environments
- ❌ Production use requires commercial license

Contact: **vivek@vivekmind.com**

---

Built by [Schema Weaver](https://schemaweaver.vivekmind.com).
