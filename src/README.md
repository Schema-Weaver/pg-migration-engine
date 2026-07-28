# SW Migration Engine

The Schema Weaver Migration Engine (`sw-migration-engine`) is a comprehensive PostgreSQL schema management system that handles introspection, diff calculation, DDL generation, risk assessment, and safe migration execution for PostgreSQL 14 through 19.

## Design Philosophy

The engine is built on four core principles:

1. **Safety First** - Every operation is risk-assessed before execution. Dangerous operations can be blocked, transformed to safe patterns, or require explicit confirmation.

2. **Transactional Integrity** - Migrations execute within proper transaction boundaries with savepoints for partial rollback. Non-transactional operations (like `CREATE INDEX CONCURRENTLY`) are detected and handled explicitly.

3. **Version Awareness** - The engine adapts its behavior based on PostgreSQL version, enabling version-specific features while gracefully degrading where needed.

4. **Zero Trust Introspection** - The introspection layer performs complete schema discovery without assuming prior state, enabling accurate drift detection and reliable migrations.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SwMigrationEngine (Entry Point)                  │
├─────────────────────────────────────────────────────────────────────────┤
│  • Orchestrates the full migration lifecycle                            │
│  • Provides convenience methods: introspect, diff, plan, execute        │
│  • Manages connection scoping and risk guards                           │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Introspection  │     │     Differ      │     │     Planner     │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ SchemaIntrospec │     │ SchemaDiffer    │     │ MigrationPlanner│
│ tor             │     │ ObjectMatcher   │     │ SmartMigrator   │
│ • 30+ query     │     │ PropertyDiffer  │     │ StepSequencer   │
│   functions     │     │ DependencyResol │     │ BackfillPlanner │
│ • Translators   │     │ ver RiskTagger  │     │                 │
│ • Version       │     │ ChangeClassifie │     │                 │
│   detection     │     │ r               │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                           │                           │
         └───────────────────────────┼───────────────────────────┘
                                     ▼
         ┌─────────────────────────────────────────────────────────┐
         │                    DDL Generator                        │
         ├─────────────────────────────────────────────────────────┤
         │ DdlGenerator → create/alter/drop/rename generators     │
         │ Safe patterns for NOT NULL, type casts, FKs             │
         │ PG version-specific command support                      │
         └─────────────────────────────────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Risk Engine   │     │    Executor     │     │    Storage      │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ RiskEngine      │     │ MigrationExecu  │     │ MigrationTable  │
│ • Destructive   │     │ tor             │     │ RollbackGenerator│
│ • DataLoss      │     │ TransactionMan  │     │ InMemoryStorage │
│ • LockRisk      │     │ ager            │     │ Provider        │
│ • Compatibility │     │ LockManager     │     │                 │
│ Recommendations │     │ DriftDetector   │     │                 │
│                 │     │ RecoveryManager  │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Supported PostgreSQL Versions

| Version | Status | Key Features Supported |
|---------|--------|------------------------|
| PG14 | Full Support | GIN/BRIN indexes, identity columns, JSONB operators, FK actions |
| PG15 | Full Support | `NULLS NOT DISTINCT`, `security_invoker` views, MERGE command |
| PG16 | Full Support | `ALTER TYPE RENAME VALUE`, ICU collation rules |
| PG17 | Full Support | `SET EXPRESSION`, `MAINTAIN` privilege, login event triggers |
| PG18 | Full Support | Virtual generated columns, `NOT ENFORCED` constraints |
| PG19 | Planned | `MERGE PARTITIONS`, `SPLIT PARTITION`, unenforced constraints |

## Core Capabilities

### Schema Introspection
- Complete catalog discovery for 30+ PostgreSQL object types
- Parallel query execution for performance
- Automatic type translation from PG catalog format
- Schema filtering support

### Change Detection
- Property-level differencing with semantic comparison
- Rename detection using Levenshtein similarity
- Dependency graph construction
- Change classification (structural vs behavioral)

### DDL Generation
- Version-aware SQL generation
- Safe patterns for dangerous operations
- Proper quoting and escaping
- Comment and privilege handling

### Risk Assessment
- Multi-factor risk evaluation (destructive, data loss, lock, compatibility)
- Safe pattern suggestions
- Version compatibility checking
- Downtime estimation

### Execution
- Advisory lock-based coordination
- Transaction-safe with savepoints
- Non-transactional operation handling
- Drift detection
- Progress tracking

## Major Features

### 1. Smart Migration Planner
Analyzes complex operations and decomposes them into safe multi-step workflows:
- Type cast transformations without data loss
- FK dependency chain handling
- NOT NULL constraint addition without table locks

### 2. Behavioral Object Support
Full support for view, function, trigger, policy, and rule migrations with proper dependency ordering.

### 3. Safe Patterns
Automatic transformation of dangerous operations:
- `SET NOT NULL` → CHECK constraint → validate → SET NOT NULL → drop CHECK
- Type change with USING clause derivation
- FK addition with NOT VALID pattern

### 4. Destructive Change Warning System
Automatic detection and blocking of data-loss operations before execution:
- Classifies 37+ object types by destructiveness level (data_loss, data_risk, object_destruction, safe)
- Queries live database for affected row counts and sample values
- Generates `pg_cast`-backed type compatibility matrix per PG version
- Optional ephemeral schema clone dry-run to catch DDL failures before production
- See `sw-migration-engine_tests/destructive-change-warnings/` for implementation.

### 5. Drift Detection
Compares pre/post migration snapshots to detect concurrent modifications.

## Migration Lifecycle

```
1.  Introspect    → Pull current schema from database
2.  Diff          → Compare desired vs current schemas
3.  Classify      → Sort changes by type and track
4.  Resolve       → Topological sort by dependencies
5.  Assess Risk   → Tag each change with risk level
6.  Plan          → Generate ordered execution steps
7.  Warn          → Classify destructive changes, count affected rows, sample values
8.  Clone Dry-Run → (optional) Apply DDL on ephemeral schema with real data
9.  Execute       → Run within transaction with locks
10. Verify        → Post-flight drift detection
11. Record        → Store migration history with warning metadata
```

## Execution Pipeline

| Phase | Number | Operations |
|-------|--------|------------|
| Pre-flight | 0 | Validation, version check |
| Advisory Lock | 0 | Acquire exclusive migration lock |
| Extensions | 3 | CREATE/DROP EXTENSION |
| Types | 4 | ENUM, COMPOSITE, DOMAIN, RANGE |
| Schemas | 5 | CREATE SCHEMA |
| Tables | 6 | CREATE TABLE (structure only) |
| Columns | 7 | ADD COLUMN |
| Sequences | 8 | CREATE/ALTER SEQUENCE |
| Indexes | 9 | CREATE INDEX (blocking) |
| Constraints | 10-12 | Non-FK, then FK constraints |
| Data Migration | 11 | Backfill operations |
| Views | 14 | CREATE/REPLACE VIEW |
| Materialized Views | 15 | CREATE MATERIALIZED VIEW |
| Functions | 16 | CREATE/REPLACE FUNCTION |
| Triggers | 17 | CREATE TRIGGER |
| Policies | 18 | CREATE POLICY |
| Rules | 19 | CREATE RULE |
| Concurrent Indexes | 23 | CREATE INDEX CONCURRENTLY |
| Snapshot | 26 | Capture post-migration state |
| Verification | 26 | Drift detection |

## Public APIs

### SwMigrationEngine

```javascript
import { SwMigrationEngine } from 'sw-migration-engine';

const engine = new SwMigrationEngine({
  connectionId: 'uuid-of-connection',
  allowRiskBelow: 'critical',  // Block if risk >= this level
  lockTimeout: '5s',
  statementTimeout: '30s',
});

engine.setPool(pgPool);

// Full pipeline
const result = await engine.migrate(pool, desiredSchema);

// Or step-by-step
const current = await engine.introspect(pool);
const diff = engine.diff(desired, current);
const plan = engine.plan(diff);
const result = await engine.execute(pool, plan);

// History
const history = await engine.getHistory(pool);
const last = await engine.getLastMigration(pool);

// Rollback
const rollbackResult = await engine.rollback(pool, migrationId);
```

### Individual Components

```javascript
import {
  SchemaIntrospector,
  SchemaDiffer,
  DdlGenerator,
  RiskEngine,
  MigrationPlanner,
  MigrationExecutor,
  TransactionManager,
  MigrationTable,
  RollbackGenerator,
} from 'sw-migration-engine';
```

### Error Types

```javascript
import {
  MigrationError,
  IntrospectionError,
  DiffError,
  DDLGenerationError,
  ExecutionError,
  PreCheckFailedError,
  PostCheckFailedError,
  MigrationConflictError,
  VersionIncompatibilityError,
  RollbackError,
  DriftDetectedError,
  LockAcquisitionError,
  TimeoutError,
  ValidationError,
  StorageError,
  PlanBlockedError,
  RecoveryError,
} from 'sw-migration-engine';
```

## Folder Structure

```
sw-migration-engine/
├── index.js                 # Entry point, SwMigrationEngine class
├── constants.js             # Status codes, risk levels, phase mappings
├── errors.js                # Error type hierarchy
│
├── types/                   # JSDoc type definitions
│   ├── schema.js            # SchemaSnapshot, TableInfo, ColumnInfo, etc.
│   ├── changes.js           # SchemaChange, SchemaDiff, RiskInfo
│   ├── migration.js         # MigrationPlan, MigrationStep, MigrationResult
│   ├── execution.js         # ExecutionOptions, DriftResult
│   └── risk.js              # RiskCategory, RiskFinding, RiskAssessment
│
├── introspection/           # Schema discovery subsystem
│   ├── index.js             # Barrel export
│   ├── introspector.js      # SchemaIntrospector class
│   ├── translator.js        # Catalog to SchemaSnapshot translation
│   ├── version-detector.js  # PostgreSQL version detection
│   ├── queries/             # SQL queries for each object type
│   │   ├── tables.js, indexes.js, constraints.js, ...
│   │   └── pg18-19.js       # PG18+ specific queries
│   └── translator/          # Per-object-type translators
│       ├── tables.js, constraints.js, functions.js, ...
│
├── differ/                  # Schema comparison subsystem
│   ├── index.js             # Barrel export
│   ├── schema-differ.js     # SchemaDiffer orchestrator
│   ├── object-matcher.js    # Object matching with rename detection
│   ├── property-differ.js   # Property-level comparison
│   ├── dependency-resolver.js # Topological sort
│   ├── change-classifier.js # Track 1 vs Track 2 classification
│   ├── risk-tagger.js       # Risk level assignment
│   └── utils/
│       ├── levenshtein.js   # String similarity
│       ├── type-compatibility.js # Cast analysis
│       └── path-builder.js # Object key construction
│
├── planner/                 # Migration planning subsystem
│   ├── index.js             # Barrel export
│   ├── migration-planner.js # MigrationPlanner class
│   ├── smart-migrator.js    # Complex operation decomposition
│   ├── backfill-planner.js  # Data backfill planning
│   ├── step-sequencer.js    # Step ordering
│   ├── type-registry.js     # Type information
│   └── dry-run.js           # Validation-only execution
│
├── ddl-generator/           # SQL generation subsystem
│   ├── index.js             # DdlGenerator barrel
│   ├── statement-factory.js # DdlGenerator class
│   ├── create-generator.js  # CREATE statements (1400+ lines)
│   ├── alter-generator.js   # ALTER statements (1300+ lines)
│   ├── drop-generator.js    # DROP statements
│   ├── rename-generator.js  # ALTER ... RENAME
│   ├── comment-generator.js # COMMENT ON
│   ├── grant-generator.js   # GRANT/REVOKE
│   ├── safe-patterns.js     # Safe operation patterns
│   ├── pg-version.js        # Version feature detection
│   └── pg19-commands.js     # PG19-specific syntax
│
├── risk/                    # Risk assessment subsystem
│   ├── index.js             # Barrel export
│   ├── risk-engine.js       # RiskEngine class
│   ├── destructive-checker.js # DROP TABLE, TRUNCATE risks
│   ├── data-loss-checker.js  # Type cast, column drop risks
│   ├── lock-analyzer.js      # Lock contention risks
│   ├── compatibility-checker.js # Version compatibility
│   └── recommendations.js    # Safe alternative suggestions
│
├── executor/                # Execution subsystem
│   ├── index.js             # Barrel export
│   ├── migration-executor.js # MigrationExecutor class (1273 lines)
│   ├── transaction-manager.js # Transaction handling
│   ├── lock-manager.js      # Advisory lock management
│   ├── drift-detector.js    # Pre/post comparison
│   ├── recovery-manager.js  # Failure handling
│   ├── snapshot-manager.js  # State capture
│   ├── progress-tracker.js  # Event emission
│   └── sql-splitter.js      # Statement parsing (dollar-quote aware)
│
├── storage/                 # Persistence subsystem
│   ├── index.js             # Barrel export
│   ├── migration-table.js   # MigrationTable (migration_history)
│   ├── rollback-generator.js # Rollback SQL generation
│   └── memory-storage.js    # In-memory provider for testing
│
├── behavioral/              # Behavioral object handling
│   ├── index.js             # Barrel export
│   ├── behavioral-extractor.js # Extract from snapshot
│   ├── behavioral-applier.js   # Apply behavioral changes
│   ├── behavioral-puller.js    # Pull from database
│   └── phase-sorter.js     # Execution ordering
│
└── docs/                    # Internal documentation
```

## Subsystem Responsibilities

### Introspection (`introspection/`)
Discovers the complete schema state from a PostgreSQL database. Executes 30+ catalog queries in parallel, translates raw results to normalized `SchemaSnapshot` objects, and handles version-specific catalog differences.

**Key Classes:** `SchemaIntrospector`, `translateSnapshot`, 35+ query functions

### Differ (`differ/`)
Compares two schema snapshots to produce a change set. Handles object matching with Levenshtein-based rename detection, property-level comparison, dependency graph construction, and risk tagging.

**Key Classes:** `SchemaDiffer`, `ObjectMatcher`, `PropertyDiffer`, `DependencyResolver`

### Planner (`planner/`)
Transforms a change set into an ordered execution plan. Groups changes by phase, resolves dependencies, handles complex operations through the smart migrator, and generates rollback information.

**Key Classes:** `MigrationPlanner`, `SmartMigrator`, `StepSequencer`

### DDL Generator (`ddl-generator/`)
Produces valid PostgreSQL DDL statements from change objects. Supports 30+ object types with version-specific syntax handling.

**Key Classes:** `DdlGenerator`, `generateCreateSql`, `generateAlterSql`, `generateDropSql`

### Risk Engine (`risk/`)
Evaluates each change for potential hazards. Provides overall risk assessment and actionable recommendations.

**Key Classes:** `RiskEngine`, `checkDestructive`, `checkDataLoss`, `checkLockRisk`

### Executor (`executor/`)
Applies migration plans to the database. Handles transaction management, advisory locking, error classification, and drift detection.

**Key Classes:** `MigrationExecutor`, `TransactionManager`, `LockManager`, `DriftDetector`

### Storage (`storage/`)
Persists migration history and provides rollback capability.

**Key Classes:** `MigrationTable`, `RollbackGenerator`

### Behavioral (`behavioral/`)
Handles non-structural PostgreSQL objects: views, functions, triggers, policies, rules. Ensures proper dependency ordering.

**Key Classes:** `BehavioralExtractor`, `BehavioralApplier`

## PostgreSQL Object Support

### Structural Objects
| Object | CREATE | ALTER | DROP | Dependencies |
|--------|--------|-------|------|--------------|
| Schema | ✅ | - | ✅ | - |
| Table | ✅ | ✅ | ✅ | Schema, Type |
| Column | ✅ | ✅ | ✅ | Table, Type |
| Index | ✅ | ✅ | ✅ | Table |
| Constraint | ✅ | ✅ | ✅ | Table, Columns |
| Sequence | ✅ | ✅ | ✅ | Schema |
| Tablespace | ✅ | ✅ | ✅ | - |

### Type Objects
| Object | CREATE | ALTER | DROP | Dependencies |
|--------|--------|-------|------|--------------|
| ENUM | ✅ | ADD VALUE | ✅ | Schema |
| COMPOSITE | ✅ | ADD/DROP/ALTER attribute | ✅ | Schema, Types |
| DOMAIN | ✅ | ✅ | ✅ | Schema, Base Type |
| RANGE | ✅ | ✅ | ✅ | Schema, Subtype |
| MULTIRANGE | ✅ | - | ✅ | Schema, Range |

### Behavioral Objects
| Object | CREATE | ALTER | DROP | Dependencies |
|--------|--------|-------|------|--------------|
| View | ✅ | OR REPLACE | ✅ | Tables, Views, Functions |
| Materialized View | ✅ | ✅ | ✅ | Tables, Views |
| Function | ✅ | REPLACE | ✅ | Schema, Types |
| Procedure | ✅ | REPLACE | ✅ | Schema, Types |
| Trigger | ✅ | ENABLE/DISABLE | ✅ | Table, Function |
| Event Trigger | ✅ | ENABLE/DISABLE | ✅ | Function |
| Policy | ✅ | ✅ | ✅ | Table |
| Rule | ✅ | ✅ | ✅ | Table |

### Advanced Objects
| Object | CREATE | ALTER | DROP |
|--------|--------|-------|------|
| Aggregate | ✅ | - | ✅ |
| Operator | ✅ | - | ✅ |
| Operator Class | ✅ | - | ✅ |
| Operator Family | ✅ | ADD/DROP operator | ✅ |
| Collation | ✅ | ✅ | ✅ |
| Conversion | ✅ | - | ✅ |
| Cast | ✅ | - | ✅ |
| Text Search Config | ✅ | ALTER MAPPING | ✅ |
| Text Search Dict | ✅ | ✅ | ✅ |
| Text Search Parser | ✅ | - | ✅ |
| Text Search Template | ✅ | ✅ | ✅ |
| Statistics | ✅ | ✅ | ✅ |
| Foreign Data Wrapper | ✅ | ✅ | ✅ |
| Foreign Server | ✅ | ✅ | ✅ |
| User Mapping | ✅ | ✅ | ✅ |
| Foreign Table | ✅ | ✅ | ✅ |
| Publication | ✅ | ADD/DROP TABLE | ✅ |
| Subscription | ✅ | ✅ | ✅ |
| Event Trigger | ✅ | ENABLE/DISABLE | ✅ |
| Default Privileges | ALTER | - | - |
| Language | ✅ | - | ✅ |
| Access Method | ✅ | - | ✅ |
| Role | ✅ | ✅ | ✅ |
| Database | ✅ | ✅ | - |

## PostgreSQL Version Compatibility

### Version Detection
The introspector queries `current_setting('server_version_num')` and exposes major version (14, 15, 16, 17, 18, 19).

### Version-Specific Features

**PostgreSQL 15:**
- `NULLS NOT DISTINCT` for UNIQUE constraints
- `security_invoker` view option
- `ALTER TYPE ADD VALUE` can run in transaction

**PostgreSQL 16:**
- `ALTER TYPE RENAME VALUE`
- ICU collation with rules
- `NULLS NOT DISTINCT` for UNIQUE indexes

**PostgreSQL 17:**
- `ALTER TABLE SET EXPRESSION` for generated columns
- `SET ACCESS METHOD DEFAULT`
- `GRANT MAINTAIN` privilege
- Login event triggers
- Builtin collations

**PostgreSQL 18:**
- Virtual generated columns (`GENERATED ALWAYS AS ... STORED|VIRTUAL`)
- Constraint `NOT ENFORCED` option

**PostgreSQL 19 (Planned):**
- `ALTER TABLE MERGE PARTITIONS`
- `ALTER TABLE SPLIT PARTITION`
- Unenforced constraints for partitioned tables

## Extension Points

### Storage Provider
Implement the `StorageProvider` interface for custom persistence:

```javascript
class CustomStorageProvider {
  async saveSnapshot(connectionId, snapshot) { }
  async loadSnapshot(connectionId) { }
  async saveMigration(record) { }
  async getMigration(id) { }
  async getLatestMigration() { }
  async getMigrationHistory() { }
}
```

### Progress Listener
Subscribe to execution events:

```javascript
engine.onProgress((event) => {
  // event.type: 'phase_start', 'step_completed', 'phase_complete', etc.
  console.log(event);
});
```

### Risk Category
Add custom risk checks by extending the risk engine.

## Development Guidelines

### Adding New Object Type Support

1. **Introspection:** Add query in `introspection/queries/`, translator in `introspection/translator/`
2. **Types:** Add type definitions in `types/schema.js`
3. **Differ:** Handle in `property-differ.js` if needed
4. **DDL:** Add generator functions in `ddl-generator/create-generator.js`, etc.
5. **Risk:** Add risk checks in `risk/`
6. **Planner:** Add phase mapping in `migration-planner.js`

### Testing Requirements
- Unit tests for new DDL generators
- Integration tests with real PostgreSQL
- Version-specific tests for PG14, PG15, PG16, PG17+

### Code Style
- ES Modules with `.js` extensions
- JSDoc type annotations
- No TypeScript compilation required

## Testing

See `TESTING.md` for comprehensive test suite documentation.

### Quick Start
```bash
cd backend
npm test                                    # Run all tests
npx vitest run services/sw-migration-engine_tests/unit-tests/  # Unit tests only
node services/sw-migration-engine_tests/pg16-test/run-all-tests.js  # PG16 tests
```

### Test Categories
- **Unit Tests:** DDL generation, type definitions, utilities
- **Audit Tests:** Risk engine, planner, executor, cross-layer
- **Integration Deep Dives:** Per-object-type validation
- **Legacy Integration Suite:** Full pipeline tests
- **Version-Specific:** PG14, PG15, PG16, PG17 compatibility

## See Also

- `ARCHITECTURE.md` - Deep technical documentation
- `TESTING.md` - Test suite documentation
- `docs/PG19_SUPPORT.md` - PostgreSQL 19 feature planning
