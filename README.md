# pg-migration-engine

[![npm version](https://img.shields.io/npm/v/pg-migration-engine.svg)](https://www.npmjs.com/package/pg-migration-engine)
[![license](https://img.shields.io/badge/license-BSL--1.1-red.svg)](https://github.com/Schema-Weaver/pg-migration-engine/blob/main/LICENSE)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-10%20%E2%80%93%2018-blue.svg)](https://www.postgresql.org/)

**PostgreSQL schema introspection, diff, DDL generation, and safe migration execution.**

[Why This Exists](#why-this-exists) • [Supported Objects](#supported-object-types-50) • [Architecture](#architecture) • [Installation](#installation) • [Quick Start](#quick-start) • [Schema Format](#schema-format) • [Key Features](#key-features) • [API Reference](#api-reference) • [Documentation](#documentation)

---

## Why This Exists

No existing open-source tool covers PostgreSQL object types comprehensively:

| Tool | Coverage | Limitations |
|------|----------|-------------|
| DataGrip / DBeaver / pgAdmin | GUI only | No programmatic API or CLI, manual UI workflow |
| Flyway / Liquibase | Manual SQL | No state-based diff engine — developers write all DDL by hand |
| Atlas | ~15 types | Missing PG behavioral objects (views, functions, triggers, policies) |
| Prisma / Drizzle | ~10 types | ORM-bound; ignores PG-native types, procedures, and behavioral objects |

**This engine covers EVERYTHING** — 50+ object types with extensive property coverage.

---

## Supported Object Types (50+)

Covers **50+ PostgreSQL object types** and **190+ properties** across PostgreSQL 10–18:

- **Structural Objects:** Tables, Columns, Indexes, Constraints, Sequences, Enums, Domains, Ranges, Partitions, Foreign Tables, ACLs, and more.
- **Behavioral Objects:** Views, Materialized Views, Functions, Procedures, Triggers, RLS Policies, Text Search (FTS), Rules, FDWs.
- **Cross-Database Objects:** Databases, Roles, Tablespaces, Publications, Subscriptions.

👉 *See full breakdown and property matrix in [Supported Objects Wiki](https://github.com/Schema-Weaver/pg-migration-engine/wiki/Supported-Objects).*

---

## Architecture

`SQL` ➔ **Introspector** ➔ **Translator** ➔ **Differ** ➔ **Risk Tagger** ➔ **DDL Generator** ➔ **Planner** ➔ **Executor** ➔ **Storage**

👉 *Explore the 8-module deep dive in [Architecture Wiki](https://github.com/Schema-Weaver/pg-migration-engine/wiki/Architecture).*

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

The engine accepts desired schemas in either **Object Format** (keyed by name) or **Array Format** (automatically normalized):

```javascript
import { normalizeSchema, validateSchemaFormat } from 'pg-migration-engine';

// Object Format (Recommended) or Array Format
const desired = {
  tables: {
    'public.users': {
      name: 'users',
      schema: 'public',
      columns: [
        { name: 'id', dataType: 'serial', isNullable: false }, // accepts 'dataType' or 'type'
        { name: 'email', dataType: 'varchar(255)', isNullable: false },
        { name: 'created_at', dataType: 'timestamp', isNullable: false, defaultValue: 'now()' },
      ],
      constraints: [
        { name: 'users_pkey', constraintType: 'PRIMARY_KEY', columns: ['id'] },
      ],
    },
  },
  types: {
    'public.status': { name: 'status', schema: 'public', kind: 'ENUM', enumValues: ['draft', 'active'] },
  },
  indexes: {
    'public.users_email_idx': { name: 'users_email_idx', table: 'users', columns: ['email'] }, // accepts strings or objects
  },
};

// Normalize array format & validate
const normalized = normalizeSchema(desired);
const { valid, errors } = validateSchemaFormat(desired);
```

---

## Key Features

- **50+ Object Types (PG 10–18):** Full introspection & state-based diffing across all PostgreSQL structural, behavioral, and cross-database objects.
- **Safe Migration Patterns:** Automated non-blocking DDL workflows for zero-downtime changes (`CONCURRENTLY` indexes, `NOT VALID` constraints, lock-free `NOT NULL`). See [Safe Patterns Wiki](https://github.com/Schema-Weaver/pg-migration-engine/wiki/Safe-Migration-Patterns).
- **5-Level Risk Assessment:** Categorizes change safety (`none` to `critical`); destructive operations (`DROP TABLE`, `DROP COLUMN`) blocked by default. See [Risk Assessment Wiki](https://github.com/Schema-Weaver/pg-migration-engine/wiki/Risk-Assessment).
- **RENAME Detection:** Smart entity matching detects renames instead of destructive `DROP` + `CREATE`, preserving data.
- **Drift Detection:** Fingerprint-based schema checksums alert when database state is altered out-of-band outside migrations.
- **Non-Transactional Aware:** Automatically isolates statements requiring outside-transaction execution (`ALTER ENUM ADD VALUE`, `CREATE INDEX CONCURRENTLY`).
- **Rollback Generation:** Generates automatic reverse DDL statements for safe migration rollbacks.

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
| **[pg-migration-engine](https://www.npmjs.com/package/pg-migration-engine)** | Schema introspection, diff, migration |

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
