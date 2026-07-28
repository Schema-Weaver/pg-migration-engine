# SW Migration Engine - Testing

This document provides comprehensive documentation of the test suite for the Schema Weaver Migration Engine.

## Testing Philosophy

The test suite is designed around these principles:

1. **Multi-Layer Validation** - Tests exist at unit, integration, and end-to-end levels
2. **Version Coverage** - Dedicated tests for PostgreSQL 14, 15, 16, and 17
3. **Real Database Testing** - Integration tests execute against actual PostgreSQL instances
4. **Audit-Style Tests** - Comprehensive coverage validation across all object types
5. **Regression Prevention** - Deep-dive tests for complex features like enums, indexes, triggers

## Test Architecture

```
sw-migration-engine_tests/
├── unit-tests/                    # Pure unit tests (no database)
│   ├── engine.test.js             # SwMigrationEngine core tests
│   ├── ddl-generators.test.js     # DDL generation for advanced objects
│   └── table-features.test.js     # DDL generation for tables/columns
│
├── audit/                          # Audit-style validation tests
│   ├── cross-layer-integration.test.js  # 7-layer integration flow
│   ├── executor-audit.test.js           # Executor component validation
│   ├── planner-audit.test.js            # Planner validation
│   ├── risk-audit.test.js               # Risk engine validation
│   └── storage-audit.test.js            # Storage layer validation
│
├── integration-deep-dives/          # Feature-specific deep-dives
│   ├── 16-index-deep-dive.test.js      # Index introspection
│   ├── 17-enum-deep-dive.test.js       # Enum type tests
│   ├── 18-composite-domain-deep-dive.test.js  # Type system
│   ├── 19-collation-partition-deep-dive.test.js
│   ├── 20-view-deep-dive.test.js
│   ├── 21-matview-deep-dive.test.js
│   ├── 22-function-deep-dive.test.js
│   ├── 23-aggregate-deep-dive.test.js
│   ├── 24-procedure-deep-dive.test.js
│   ├── 25-trigger-deep-dive.test.js
│   ├── 26-policy-deep-dive.test.js
│   ├── 27-rule-deep-dive.test.js
│   ├── live-tables.test.js
│   └── pipeline.test.js
│
├── legacy-integration-suite/        # Comprehensive integration tests
│   └── integration/
│       ├── 00-helper.js                 # Shared test utilities
│       ├── 01-schema-structural-*.js    # Layer 1: Structural introspection
│       ├── 02-schema-behavioral-*.js    # Layer 1: Behavioral introspection
│       ├── layer1-introspection-accuracy-test.js
│       ├── layer2-alter-operation-test.js
│       ├── layer2-simple-test.js
│       ├── layer3-e2e-migration-test.js
│       ├── 03-diff-alter-test.js        # ALTER operations
│       ├── 04-diff-rename-test.js       # RENAME detection
│       ├── 05-diff-drop-test.js         # DROP operations
│       ├── 06-ddl-generator-test.js     # DDL generation
│       ├── 07-planner-test.js           # Migration planning
│       ├── 08-executor-test.js          # Execution tests
│       ├── 09-storage-test.js           # Storage persistence
│       ├── 10-scale-test.js             # Scale test (2000+ tables)
│       ├── 11-full-pipeline-test.js     # E2E pipeline
│       ├── 12-cleanup.js                # Teardown
│       ├── 13-schema-deep-dive-test.js
│       ├── tip-test-*.js                # TIP-specific tests
│       └── layer3-fixtures/             # SQL fixtures
│
├── pg14-test/                       # PostgreSQL 14 tests
│   ├── run-all-tests.js
│   ├── test-helpers.js
│   ├── test-introspection.js
│   ├── test-diff.js
│   ├── test-ddl-generation.js
│   ├── test-full-pipeline.js
│   ├── test-pg14-features.js
│   ├── test-edge-cases.js
│   ├── test-comprehensive.js
│   ├── test-error-handling.js
│   ├── test-missing-features.js
│   ├── test-performance-baseline.js
│   ├── test-ddl-edge-cases.js
│   └── docs/
│
├── pg15-test/                       # PostgreSQL 15 tests
│   ├── run-all-tests.js
│   ├── test-helpers.js
│   ├── test-pg15-features.js
│   ├── test-pg15-execution.js
│   ├── test-pg15-comprehensive.js
│   └── ... (same structure as pg14)
│
├── pg16-test/                       # PostgreSQL 16 tests
│   ├── run-all-tests.js
│   ├── test-helpers.js
│   ├── test-introspection.js
│   ├── test-diff-ddl.js
│   ├── test-apply.js
│   ├── test-rollback.js
│   └── docs/
│
├── pg17-test/                       # PostgreSQL 17 tests
│   ├── run-all-tests.js
│   ├── test-helpers.js
│   ├── test-introspection.js
│   ├── test-diff-ddl.js
│   ├── test-execution.js
│   ├── verify-catalog.js
│   └── docs/
│
└── docs/                            # Test documentation
    ├── pg14-compatibility.md
    └── PG19_SUPPORT.md
```

## Folder Structure

### `unit-tests/`

**Purpose:** Test individual components in isolation without database dependencies.

**Pattern:** Vitest `describe`/`it` blocks with mock data objects.

| File | Focus | Test Count |
|------|-------|------------|
| `engine.test.js` | SwMigrationEngine initialization, diffSchemas, assessRisk, createMigrationPlan | 4 tests |
| `ddl-generators.test.js` | Text search, operators, replication, events, statistics, collations, casts, foreign data, database objects, type system, column properties, safe patterns | 30+ tests |
| `table-features.test.js` | CREATE TABLE, ALTER TABLE, partitions, storage parameters, privileges, comments, constraints, indexes, sequences, views, matviews, enums, foreign tables | 55+ tests |

### `audit/`

**Purpose:** Audit-style validation that systematically covers all object types and code paths.

**Pattern:** Test ID system (STOR-001, RISK-001, etc.) for traceability.

| File | Focus | Test IDs | Test Count |
|------|-------|----------|------------|
| `storage-audit.test.js` | MigrationTable, LockManager, InMemoryStorageProvider, connection scoping, dynamic lock keys | STOR-001 to STOR-003 | 50+ |
| `risk-audit.test.js` | RiskTagger, 40 object types, risk level matrix, property-specific risk, cascade risk | RISK-001 to RISK-007 | 90+ |
| `planner-audit.test.js` | RENAME+ALTER correlation, DROP phases 27-32, phase ordering, concurrent index handling | PLN-001 to PLN-006 | 80+ |
| `executor-audit.test.js` | SQL splitter, savepoint naming, PG error codes, non-transactional detection, intent recording, lock heartbeat | EXEC-001 to EXEC-008 | 60+ |
| `cross-layer-integration.test.js` | Risk → Planner → Executor → Storage flow, dynamic lock keys, connectionId scoping | X-LAYER-001 to X-LAYER-007 | 30+ |

### `integration-deep-dives/`

**Purpose:** Deep validation of specific PostgreSQL object types with real database queries.

**Pattern:** `beforeAll` creates schema objects, tests verify introspection/diff/DDL.

| File | Object Type | Tests |
|------|-------------|-------|
| `16-index-deep-dive.test.js` | Indexes | Basic, unique, sort direction, nulls ordering, partial, composite, INCLUDE, count validation |
| `17-enum-deep-dive.test.js` | ENUM types | Basic, values, owner, comment, multiple enums, sort order |
| `18-composite-domain-deep-dive.test.js` | Composite, Domain, Range | Composites, attributes, comments; Domain check constraints, NOT NULL, defaults; Range subtypes |
| `19-collation-partition-deep-dive.test.js` | Collations, Partitions | Provider, locale, comment; Partition strategy, child tables |
| `20-view-deep-dive.test.js` | Views | security_barrier, check_option, owner/comment, columns, security_invoker |
| `21-matview-deep-dive.test.js` | Materialized Views | Storage parameters, owner/comment, tablespace, columns |
| `22-function-deep-dive.test.js` | Functions | Leakproof attribute, owner/comment, return type |
| `23-aggregate-deep-dive.test.js` | Aggregates | sfunc/stype, initcond, owner |
| `24-procedure-deep-dive.test.js` | Procedures | Owner, comment, arguments |
| `25-trigger-deep-dive.test.js` | Triggers | Deferrable options, UPDATE OF columns, transition tables |
| `26-policy-deep-dive.test.js` | RLS Policies | All properties, roles, restrictive policy, diff detection |
| `27-rule-deep-dive.test.js` | Rules | Properties, condition, comment, enabled state, diff detection |

### `legacy-integration-suite/`

**Purpose:** Comprehensive layer-based testing of the complete migration pipeline.

**Layers:**
- **Layer 1:** Introspection accuracy (catalog queries → SchemaSnapshot)
- **Layer 2:** Diff and DDL generation (SchemaSnapshot → SchemaDiff → SQL)
- **Layer 3:** End-to-end migration (execute → verify)

| File | Layer | Purpose |
|------|-------|---------|
| `00-helper.js` | Support | Shared utilities: assertResult, introspect, diff, plan, execute, toArray, objectExists |
| `01-schema-structural-test.js` | 1 | Structural introspection validation |
| `01-schema-structural-setup.sql` | 1 | SQL fixture for structural objects |
| `02-schema-behavioral-test.js` | 1 | Behavioral introspection validation |
| `02-schema-behavioral-setup.sql` | 1 | SQL fixture for behavioral objects |
| `layer1-introspection-accuracy-test.js` | 1 | Detailed introspection accuracy |
| `03-diff-alter-test.js` | 2 | ALTER change detection |
| `04-diff-rename-test.js` | 2 | RENAME detection and confidence |
| `05-diff-drop-test.js` | 2 | DROP change detection |
| `06-ddl-generator-test.js` | 2 | DDL statement generation |
| `07-planner-test.js` | 2 | Migration plan creation |
| `layer2-alter-operation-test.js` | 2 | ALTER statement execution |
| `layer3-e2e-migration-test.js` | 3 | Full migration pipeline |
| `tip-test-*.js` | 3 | TIP-specific scenario tests |
| `08-executor-test.js` | 3 | Execution and transaction handling |
| `09-storage-test.js` | 3 | Migration history persistence |
| `10-scale-test.js` | 3 | Scale test with 2000+ tables |
| `11-full-pipeline-test.js` | 3 | Complete E2E validation |

### `pg14-test/`, `pg15-test/`, `pg16-test/`, `pg17-test/`

**Purpose:** PostgreSQL version-specific compatibility testing.

**Structure:** Each folder has:
- `run-all-tests.js` - Test runner for that version
- `test-helpers.js` - Version-specific utilities
- `setup-test-db.sql` - SQL fixture
- `test-pg*-features.js` - Version-specific features
- `docs/` - Test reports and gap analysis

## Categories of Tests

### 1. Unit Tests

Pure JavaScript tests with no database dependencies. Test:
- DDL generation logic
- Type definitions
- Utility functions
- Diff algorithms (with mock data)
- Risk calculation

### 2. Audit Tests

Systematic coverage validation. Test:
- All code paths in RiskTagger
- All phase mappings in Planner
- All error codes in Executor
- All status transitions in Storage

### 3. Integration Tests

Tests against real PostgreSQL. Test:
- Query results match expected structure
- DDL statements execute successfully
- Introspection captures all properties
- Diff produces correct changes

### 4. End-to-End Tests

Full pipeline validation. Test:
- `introspect → diff → plan → execute → verify`
- Drift detection
- Recovery scenarios
- Multi-phase migrations

### 5. Regression Tests

Bug-specific tests. Located in:
- Deep-dive files for complex features
- TIP test files for specific scenarios

### 6. Performance Tests

- `test-performance-baseline.js` - Timing assertions
- `10-scale-test.js` - 2000+ table scenario

### 7. Compatibility Tests

- Version-specific test suites
- Features that differ between PG versions
- Backward compatibility validation

## PostgreSQL Version Compatibility Testing

### Test Matrix

| Test Suite | PG14 | PG15 | PG16 | PG17 | PG18 | PG19 |
|------------|------|------|------|------|------|------|
| Unit Tests | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Audit Tests | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Introspection | Full | Full | Full | Full | Partial | Planned |
| DDL Generation | Full | Full | Full | Full | Partial | Planned |
| Execution | Full | Full | Full | Full | Partial | Planned |

### Version-Specific Features Tested

**PostgreSQL 14:**
- Identity columns
- GIN/BRIN indexes
- JSONB operators
- FK actions
- Extension management
- Enum ADD VALUE (non-transactional)

**PostgreSQL 15:**
- `NULLS NOT DISTINCT` for UNIQUE
- `security_invoker` views
- MERGE command
- `ALTER TYPE ADD VALUE` in transaction

**PostgreSQL 16:**
- `ALTER TYPE RENAME VALUE`
- ICU collation rules
- `NULLS NOT DISTINCT` for indexes

**PostgreSQL 17:**
- `ALTER TABLE SET EXPRESSION`
- `SET ACCESS METHOD DEFAULT`
- `SET STATISTICS DEFAULT`
- `GRANT MAINTAIN` privilege
- Login event triggers
- Builtin collations
- IDENTITY on partitioned tables

### Running Version-Specific Tests

```bash
# PostgreSQL 14 (port 5434)
cd backend/services/sw-migration-engine_tests/pg14-test
node run-all-tests.js

# PostgreSQL 15 (port 5435)
cd backend/services/sw-migration-engine_tests/pg15-test
node run-all-tests.js

# PostgreSQL 16 (port 5436)
cd backend/services/sw-migration-engine_tests/pg16-test
node run-all-tests.js

# PostgreSQL 17 (port 5437)
cd backend/services/sw-migration-engine_tests/pg17-test
node run-all-tests.js
```

### L7 Production Resilience Tests

Layer 7 tests focus on production-critical scenarios:

```bash
# L7-01: Transaction Boundary Testing
cd backend/services/sw-migration-engine_tests/L7-01-transaction-boundaries
npm test

# L7-02: Concurrent Migration Locking
cd backend/services/sw-migration-engine_tests/L7-02-concurrent-locking/tests
node test-advisory-lock-acquire-release.js
node test-lock-on-crash-recovery.js
node test-lock-timeout.js
```

## Introspection Tests

### Coverage by Object Type

| Object Type | Tests | Coverage |
|-------------|-------|----------|
| Tables | `test-introspection.js`, deep-dives | Full |
| Columns | `test-introspection.js`, `table-features.test.js` | Full |
| Indexes | `16-index-deep-dive.test.js` | Full |
| Constraints | `test-introspection.js`, deep-dives | Full |
| ENUM Types | `17-enum-deep-dive.test.js` | Full |
| Composite Types | `18-composite-domain-deep-dive.test.js` | Full |
| Domain Types | `18-composite-domain-deep-dive.test.js` | Full |
| Range Types | `18-composite-domain-deep-dive.test.js` | Full |
| Views | `20-view-deep-dive.test.js` | Full |
| Materialized Views | `21-matview-deep-dive.test.js` | Full |
| Functions | `22-function-deep-dive.test.js` | Full |
| Aggregates | `23-aggregate-deep-dive.test.js` | Full |
| Procedures | `24-procedure-deep-dive.test.js` | Full |
| Triggers | `25-trigger-deep-dive.test.js` | Full |
| Policies | `26-policy-deep-dive.test.js` | Full |
| Rules | `27-rule-deep-dive.test.js` | Full |
| Collations | `19-collation-partition-deep-dive.test.js` | Full |
| Partitions | `19-collation-partition-deep-dive.test.js` | Full |

## Translator Tests

Located in: `unit-tests/ddl-generators.test.js`

Test translation from SchemaSnapshot properties to DDL:
- Type normalization
- Default value formatting
- Constraint clause generation
- Privilege string parsing

## Differ Tests

### Located In
- `03-diff-alter-test.js` - ALTER detection
- `04-diff-rename-test.js` - RENAME detection
- `05-diff-drop-test.js` - DROP detection
- `risk-audit.test.js` - Risk tagging
- `planner-audit.test.js` - Dependency resolution

### Test Scenarios
- Simple property changes
- Nested object changes
- Rename detection with confidence levels
- Dependency graph construction
- Cycle detection

## Planner Tests

### Located In
- `07-planner-test.js`
- `planner-audit.test.js`

### Test Scenarios
- Phase assignment
- Dependency ordering
- Smart migration decomposition
- Step sequencing
- RENAME correlation with ALTER

## Smart Migration Tests

### Located In
- `planner-audit.test.js` (PLN-005)
- `unit-tests/ddl-generators.test.js` (safe patterns)

### Test Scenarios
- NOT NULL addition pattern
- FK addition pattern
- Type cast pattern
- Unique constraint via concurrent index

## DDL Generator Tests

### Located In
- `unit-tests/ddl-generators.test.js`
- `unit-tests/table-features.test.js`
- `06-ddl-generator-test.js`

### Test Categories

#### CREATE Statements
- Table with all options
- Index with all methods
- Constraint types
- View with check options
- Function with all attributes
- Type creation (ENUM, COMPOSITE, DOMAIN, RANGE)

#### ALTER Statements
- Column properties (type, nullable, default, identity)
- Table properties (tablespace, unlogged, RLS)
- Constraint validation
- Index rebuilding
- Sequence options

#### DROP Statements
- All object types with IF EXISTS
- CASCADE handling
- CONCURRENTLY for indexes

## Risk Engine Tests

### Located In
- `risk-audit.test.js`
- `unit-tests/engine.test.js`

### Test Categories

| Risk Category | Test Count | Coverage |
|---------------|------------|----------|
| destructive | 15+ | Full |
| data_loss | 20+ | Full |
| lock_risk | 15+ | Full |
| compatibility | 10+ | Full |
| performance_impact | 10+ | Full |
| reversibility | 10+ | Full |

### Risk Level Matrix

| Object Type | CREATE | ALTER | DROP |
|-------------|--------|-------|------|
| Table | none | medium | critical |
| Column | low | medium | high |
| Index | low | low | medium |
| Constraint | low | medium | medium |
| Type | low | high | critical |
| View | low | low | low |
| Function | low | low | low |
| Trigger | low | low | low |

## Executor Tests

### Located In
- `08-executor-test.js`
- `executor-audit.test.js`

### Test Scenarios

#### Transaction Management
- Single statement execution
- Multi-statement with savepoints
- Partial rollback
- Dry-run with ROLLBACK

#### Error Handling
- PostgreSQL error code classification
- Retry on transient errors
- Continue on error mode

#### Non-Transactional Operations
- CREATE INDEX CONCURRENTLY
- ALTER TYPE ADD VALUE (pre-PG15)
- VACUUM
- CLUSTER

#### Lock Management
- Advisory lock acquisition
- Lock heartbeat
- Lock conflict detection

## Rollback Tests

### Located In
- `pg16-test/test-rollback.js`
- `unit-tests/ddl-generators.test.js`

### Test Scenarios
- Transactional rollback
- Non-transactional operations (manual recovery required)
- Partial rollback after mid-migration failure

## Drift Detection Tests

### Located In
- `executor-audit.test.js` (EXEC-006)
- `layer3-e2e-migration-test.js`

### Test Scenarios
- Pre/post snapshot comparison
- Checksum mismatch detection
- Excluding migration changes from drift

## Transaction Tests

### Located In
- `08-executor-test.js`
- `executor-audit.test.js`

### Test Scenarios
- Savepoint creation and release
- ROLLBACK TO SAVEPOINT
- Statement timeout handling
- Lock timeout handling

## Storage Tests

### Located In
- `09-storage-test.js`
- `storage-audit.test.js`

### Test Scenarios
- Table creation and schema migration
- Record lifecycle (create → complete/fail)
- History retrieval
- Rollback SQL storage
- Connection scoping

## Integration Tests

### Located In
- `legacy-integration-suite/integration/`
- `integration-deep-dives/`

### Key Integration Scenarios

1. **Full Pipeline** (`11-full-pipeline-test.js`)
   - Introspect empty database
   - Apply desired schema
   - Verify result

2. **Incremental Migration** (`layer3-e2e-migration-test.js`)
   - Start with existing schema
   - Apply changes
   - Verify only changes applied

3. **Multi-Phase** (`07-planner-test.js`)
   - Changes spanning multiple phases
   - Dependency ordering verification

## Regression Tests

### Located In
- `integration-deep-dives/` - Feature-specific
- `tip-test-*.js` - Bug-specific scenarios

### Known Regression Tests
- Index introspection with INCLUDE columns
- Enum value ordering
- Trigger deferrable options
- Policy restrictive clause

## Performance Tests

### Located In
- `test-performance-baseline.js`
- `10-scale-test.js`

### Metrics Captured
- Introspection time
- Diff calculation time
- DDL generation time
- Execution time per phase

### Scale Test
- 2000+ tables in single schema
- Tests introspection at scale
- Tests diff performance with large schemas

## Compatibility Tests

### Located In
- `pg14-test/` through `pg17-test/`
- `docs/pg14-compatibility-notes.md`

### Version-Specific Checks
- Feature availability detection
- Graceful degradation
- Error messages for unsupported features

## End-to-End Migration Tests

### Located In
- `layer3-e2e-migration-test.js`
- `tip-test-full.js`
- `test-full-pipeline.js`

### Scenarios
1. Empty database → Full schema
2. Existing schema → Modified schema
3. Drift scenario → Reconcile
4. High-risk operation → Blocked
5. Dry-run → Verification without changes

## Real Database Validation

### Test Database Setup

Each PG version test suite includes `setup-test-db.sql` that creates:
- Schemas and tables
- Columns with various types
- Constraints (PK, FK, UNIQUE, CHECK)
- Indexes (btree, hash, gin, brin)
- Views and materialized views
- Functions and triggers
- Policies and rules
- Custom types (ENUM, COMPOSITE, DOMAIN)

### Validation Queries

Tests use `objectExists()` helper to verify:
- Object was created
- Object was dropped
- Properties match expected values

## Current Test Coverage

### Coverage by Subsystem

| Subsystem | Unit | Audit | Integration | E2E | Overall |
|-----------|------|-------|-------------|-----|---------|
| Introspection | Low | Medium | High | High | **Good** |
| Differ | Medium | High | High | High | **Excellent** |
| Planner | Low | High | Medium | Medium | **Good** |
| DDL Generator | High | Medium | High | High | **Excellent** |
| Risk Engine | Low | High | Medium | Medium | **Good** |
| Executor | Low | High | High | High | **Good** |
| Storage | Low | High | Medium | Low | **Good** |
| Behavioral | Medium | Low | Medium | Medium | **Moderate** |

### Coverage by Object Type

| Object Type | Introspection | Diff | DDL | Execution | Confidence |
|-------------|---------------|------|-----|-----------|------------|
| Table | ✅ | ✅ | ✅ | ✅ | High |
| Column | ✅ | ✅ | ✅ | ✅ | High |
| Index | ✅ | ✅ | ✅ | ✅ | High |
| Constraint | ✅ | ✅ | ✅ | ✅ | High |
| ENUM | ✅ | ✅ | ✅ | ✅ | High |
| Composite | ✅ | ✅ | ✅ | ⚠️ | Medium |
| Domain | ✅ | ✅ | ✅ | ⚠️ | Medium |
| Range | ✅ | ✅ | ✅ | ⚠️ | Medium |
| View | ✅ | ✅ | ✅ | ✅ | High |
| Materialized View | ✅ | ✅ | ✅ | ⚠️ | Medium |
| Function | ✅ | ✅ | ✅ | ✅ | High |
| Procedure | ✅ | ✅ | ✅ | ✅ | High |
| Trigger | ✅ | ✅ | ✅ | ✅ | High |
| Policy | ✅ | ✅ | ✅ | ✅ | High |
| Rule | ✅ | ✅ | ✅ | ✅ | High |
| Aggregate | ✅ | ✅ | ✅ | ⚠️ | Medium |
| Operator | ✅ | ✅ | ✅ | ⚠️ | Medium |
| Collation | ✅ | ⚠️ | ✅ | ⚠️ | Low |
| Publication | ✅ | ⚠️ | ✅ | ⚠️ | Low |
| Subscription | ✅ | ⚠️ | ✅ | ⚠️ | Low |

Legend: ✅ Tested, ⚠️ Partial coverage

### Estimated Test Counts

| Category | Files | Tests | Assertions |
|----------|-------|-------|------------|
| Unit Tests | 3 | 120+ | 500+ |
| Audit Tests | 5 | 310+ | 1000+ |
| Integration Deep Dives | 13 | 75+ | 300+ |
| Legacy Integration | 26+ | 500+ | 2000+ |
| PG14 Tests | 12 | 200+ | 800+ |
| PG15 Tests | 14 | 200+ | 800+ |
| PG16 Tests | 6 | 100+ | 400+ |
| PG17 Tests | 6 | 100+ | 400+ |
| **Total** | **85+** | **1,600+** | **6,200+** |

## Missing Test Categories

### Identified Gaps

1. **Schema Compiler Tests** - The 20-layer CompiledSchema pipeline has no dedicated tests
2. **SQL Parser Tests** - Limited testing of `pgsql-ast-parser` integration
3. **Atlas Integration Tests** - Limited coverage of `sw-differ.js` Atlas integration
4. **Smart Migration Full Scenarios** - Need more real-world complex migration scenarios
5. **Concurrent Operation Tests** - Lock contention simulation
6. **Large Schema Performance** - Scale tests limited to 2000 tables
7. **Cross-Connection Isolation** - Multi-tenant scenarios
8. **Error Recovery Paths** - More failure scenario coverage

### Recommendations

1. Add dedicated schema compiler test suite
2. Add SQL parser unit tests
3. Add Atlas integration tests with real diff scenarios
4. Add concurrent migration tests
5. Add stress tests for large schemas (10,000+ objects)
6. Add multi-connection isolation tests

## Running the Test Suite

### Prerequisites

```bash
# Setup PostgreSQL instances (example using Docker)
docker run -d --name pg14 -p 5434:5432 -e POSTGRES_PASSWORD=postgres postgres:14
docker run -d --name pg15 -p 5435:5432 -e POSTGRES_PASSWORD=postgres postgres:15
docker run -d --name pg16 -p 5436:5432 -e POSTGRES_PASSWORD=postgres postgres:16
docker run -d --name pg17 -p 5437:5432 -e POSTGRES_PASSWORD=postgres postgres:17
```

### Unit Tests

```bash
cd backend
npx vitest run services/sw-migration-engine_tests/unit-tests/
```

### Audit Tests

```bash
cd backend
npx vitest run services/sw-migration-engine_tests/audit/
```

### Integration Deep Dives

```bash
cd backend
npx vitest run services/sw-migration-engine_tests/integration-deep-dives/
```

### Legacy Integration Suite

```bash
cd backend/services/sw-migration-engine_tests/legacy-integration-suite/integration
node run-all-tests.js
```

### Version-Specific Tests

```bash
# PG14
cd backend/services/sw-migration-engine_tests/pg14-test
node run-all-tests.js

# PG15
cd backend/services/sw-migration-engine_tests/pg15-test
node run-all-tests.js

# PG16
cd backend/services/sw-migration-engine_tests/pg16-test
node run-all-tests.js

# PG17
cd backend/services/sw-migration-engine_tests/pg17-test
node run-all-tests.js
```

### All Tests

```bash
cd backend
npm test
```

## Recommended Structure for Adding New Tests

### For New Object Types

```
1. unit-tests/
   - Add DDL generator tests for the new object type

2. integration-deep-dives/
   - Create XX-object-deep-dive.test.js
   - Test introspection, diff, DDL generation, execution

3. pg14-test/ through pg17-test/
   - Add version-specific feature tests if applicable

4. audit/
   - Update risk-audit.test.js with risk mappings
   - Update planner-audit.test.js with phase mappings
```

### For New Features

```
1. unit-tests/
   - Test the feature logic in isolation

2. integration-deep-dives/
   - Add integration test for the feature

3. legacy-integration-suite/integration/
   - Add test file named after the feature
   - Update run-all-tests.js to include it
```

### For Bug Fixes

```
1. Create regression test in appropriate location:
   - integration-deep-dives/ for object-specific bugs
   - tip-test-* for TIP scenarios
   - Unit test for logic bugs

2. Document the bug in test comments with:
   - Original issue reference
   - Root cause
   - How test verifies fix
```

## Test Utilities Reference

### Helper Functions (`00-helper.js`, `test-helpers.js`)

```javascript
// Assertions
assertResult(actual, expected, message)
startSection(name)
endSection()

// Database operations
introspect(pool, options)
diff(desired, current)
plan(diff, options)
execute(pool, plan, options)

// Object finding
findTable(snapshot, schema, name)
findColumn(snapshot, schema, table, column)
findIndex(snapshot, schema, name)
findConstraint(snapshot, schema, table, name)

// Utilities
toArray(collection)
findBy(collection, key, value)
filterBy(collection, key, value)
objectExists(pool, type, schema, name)
getDbVersionNum(pool)
```

### Mock Utilities (`unit-tests/`)

```javascript
mockPool(queryResult)
mockPoolWithDefaults(defaults)
mockClient()
createMockSnapshot(overrides)
createMockChange(overrides)
```
