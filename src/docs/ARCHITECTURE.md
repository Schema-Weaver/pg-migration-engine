# SW Migration Engine - Architecture

This document provides a deep technical description of the internal architecture of the Schema Weaver Migration Engine.

## Overall Architecture

The engine follows a layered pipeline architecture where data flows through distinct processing stages:

```mermaid
graph TB
    subgraph "Input Layer"
        A[Desired Schema JSON] 
        B[PostgreSQL Connection]
    end
    
    subgraph "Introspection Layer"
        C[SchemaIntrospector]
        D[Catalog Queries 30+]
        E[Translator]
    end
    
    subgraph "Diff Layer"
        F[SchemaDiffer]
        G[ObjectMatcher]
        H[PropertyDiffer]
        I[DependencyResolver]
    end
    
    subgraph "Planning Layer"
        J[MigrationPlanner]
        K[SmartMigrator]
        L[StepSequencer]
        M[RiskEngine]
    end
    
    subgraph "DDL Layer"
        N[DdlGenerator]
        O[SafePatterns]
    end
    
    subgraph "Execution Layer"
        P[MigrationExecutor]
        Q[TransactionManager]
        R[LockManager]
        S[DriftDetector]
    end
    
    subgraph "Storage Layer"
        T[MigrationTable]
        U[migration_history]
    end
    
    A --> F
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    I --> J
    J --> K
    K --> L
    L --> M
    M --> N
    N --> O
    O --> P
    P --> Q
    P --> R
    P --> S
    P --> T
    T --> U
```

## Internal Component Diagram

```mermaid
graph LR
    subgraph "SwMigrationEngine"
        direction TB
        SW[SwMigrationEngine]
        
        subgraph "Components"
            INT[SchemaIntrospector]
            DIF[SchemaDiffer]
            PLN[MigrationPlanner]
            DDL[DdlGenerator]
            RSK[RiskEngine]
            EXE[MigrationExecutor]
            STO[MigrationTable]
            BEH[BehavioralExtractor]
        end
        
        SW --> INT
        SW --> DIF
        SW --> PLN
        SW --> DDL
        SW --> RSK
        SW --> EXE
        SW --> STO
        SW --> BEH
    end
```

## Data Flow

### Input Types
- **Desired Schema:** JSON representation of target schema state
- **Connection Pool:** `pg.Pool` instance for database access
- **Options:** Configuration for timeouts, risk thresholds, dry-run mode

### Output Types
- **SchemaSnapshot:** Complete introspected state (`types/schema.js`)
- **SchemaDiff:** Change set with dependency graph (`types/changes.js`)
- **MigrationPlan:** Ordered execution steps (`types/migration.js`)
- **MigrationResult:** Execution outcome with timing, errors, intents

### Flow Sequence

```mermaid
sequenceDiagram
    participant User
    participant Engine as SwMigrationEngine
    participant Intro as SchemaIntrospector
    participant Diff as SchemaDiffer
    participant Plan as MigrationPlanner
    participant Risk as RiskEngine
    participant Exec as MigrationExecutor
    participant DB as PostgreSQL
    
    User->>Engine: migrate(pool, desired)
    Engine->>Intro: introspect(pool)
    Intro->>DB: 30+ parallel queries
    DB-->>Intro: catalog data
    Intro->>Intro: translateSnapshot()
    Intro-->>Engine: SchemaSnapshot
    
    Engine->>Diff: diff(desired, current)
    Diff->>Diff: match objects
    Diff->>Diff: property diff
    Diff->>Diff: resolve dependencies
    Diff->>Diff: tag risks
    Diff-->>Engine: SchemaDiff
    
    Engine->>Plan: createPlan(diff)
    Plan->>Plan: generate steps
    Plan->>Plan: sequence by phase
    Plan-->>Engine: MigrationPlan
    
    Engine->>Risk: assess(changes)
    Risk-->>Engine: RiskAssessment
    
    Engine->>Exec: execute(plan)
    Exec->>DB: BEGIN
    Exec->>DB: Advisory Lock
    loop Phase by Phase
        Exec->>DB: SAVEPOINT
        Exec->>DB: DDL Statement
        Exec->>DB: RELEASE SAVEPOINT
    end
    Exec->>DB: COMMIT
    Exec-->>Engine: MigrationResult
    Engine-->>User: result
```

## Complete Migration Lifecycle

### Phase 1: Introspection

The introspector queries the PostgreSQL system catalogs to produce a complete snapshot.

```mermaid
graph TD
    A[introspect] --> B[detectPgVersion]
    B --> C[resolveUserSchemas]
    C --> D[Parallel Queries]
    
    D --> E1[queryTables]
    D --> E2[queryColumns]
    D --> E3[queryIndexes]
    D --> E4[queryConstraints]
    D --> E5[queryFunctions]
    D --> E6[queryTriggers]
    D --> E7[queryViews]
    D --> E8[...28 more]
    
    E1 --> F[translateSnapshot]
    E2 --> F
    E3 --> F
    E4 --> F
    E5 --> F
    E6 --> F
    E7 --> F
    E8 --> F
    
    F --> G[SchemaSnapshot]
```

**Query Execution:**
- Uses `Promise.all()` for 30+ concurrent queries
- Each query filters by target schemas
- Error handling with fallback to empty arrays
- Version-specific queries enabled based on detected version

**Translation:**
- Raw catalog rows → normalized objects
- Type normalization (e.g., `character varying` → `varchar`)
- Default values parsed and preserved
- ACL strings parsed to privilege objects

### Phase 2: Diff

```mermaid
graph TD
    A[diff desired vs current] --> B[ObjectMatcher.match]
    
    B --> C{Object exists in}
    C -->|desired only| D[CREATE change]
    C -->|current only| E[DROP change]
    C -->|both| F[Potential Match]
    C -->|similar name| G[Rename Detection]
    
    G --> H{Levenshtein > 0.55?}
    H -->|Yes| I[RENAME change]
    H -->|No| J[Separate CREATE + DROP]
    
    F --> K[PropertyDiffer.diff]
    K --> L[ALTER changes]
    
    D --> M[DependencyResolver.resolve]
    E --> M
    I --> M
    L --> M
    
    M --> N[Topological Sort]
    N --> O[ChangeClassifier.classify]
    O --> P[RiskTagger.tag]
    P --> Q[SchemaDiff]
```

**Object Matching Algorithm:**
```
for each object in desired:
    if object exists in current (same key):
        mark as MATCH (needs property diff)
    else:
        mark as CREATE
        
for each object in current:
    if object not in desired:
        mark as potential DROP
        
for each potential DROP:
    for each potential CREATE:
        similarity = levenshtein_similarity(DROP.name, CREATE.name)
        if similarity > 0.55:
            mark as potential RENAME
            if user confirms:
                convert DROP+CREATE to RENAME
```

**Property Diffing:**
- Deep comparison of all properties
- Type-aware comparison (e.g., arrays, objects)
- Handles default value normalization
- Constraint clause decomposition

### Phase 3: Planning

```mermaid
graph TD
    A[createPlan] --> B[Generate DDL for each change]
    B --> C[correlateRenames]
    C --> D[Map changes to phases]
    D --> E[Create execution steps]
    
    E --> F[Pre-flight check step]
    E --> G[Advisory lock step]
    E --> H[Phase-grouped steps]
    E --> I[Snapshot step]
    E --> J[Verify step]
    
    H --> K[SmartMigrator.analyze]
    K --> L{Complex operation?}
    L -->|Yes| M[Multi-step safe workflow]
    L -->|No| N[Single step]
    
    M --> O[StepSequencer.sequence]
    N --> O
    
    O --> P[MigrationPlan]
```

**Phase Mapping Logic:**

| Change Type | Object Type | Phase |
|-------------|-------------|-------|
| CREATE | extension | 3 |
| CREATE | schema | 5 |
| CREATE | type, domain | 4 |
| CREATE | sequence | 5 |
| CREATE | table | 6 |
| CREATE | column | 7 |
| CREATE | index (blocking) | 9 |
| CREATE | index (concurrent) | 23 |
| CREATE | constraint (non-FK) | 10 |
| CREATE | constraint (FK) | 12 |
| CREATE | view | 14 |
| CREATE | materializedView | 15 |
| CREATE | function, procedure | 16 |
| CREATE | trigger | 17 |
| CREATE | policy | 18 |
| CREATE | rule | 19 |
| ALTER | column | 11 |
| ALTER | constraint | 12 |
| ALTER | sequence | 8 |
| DROP | behavioral objects | 27 |
| DROP | constraints | 28 |
| DROP | indexes | 29 |
| DROP | columns | 30 |
| DROP | sequences | 31 |
| DROP | structural objects | 32 |

### Phase 4: Execution

```mermaid
graph TD
    A[execute] --> B[preflightCheck]
    B --> C[acquireAdvisoryLock]
    C --> D[captureSnapshot before]
    D --> E[createMigrationRecord]
    
    E --> F[Group steps by phase]
    F --> G[Execute each phase]
    
    G --> H{Is non-transactional?}
    H -->|No| I[Execute in transaction]
    H -->|Yes| J[Execute outside transaction]
    
    I --> K[BEGIN]
    K --> L[SET timeouts]
    L --> M[For each step]
    M --> N[SAVEPOINT]
    N --> O[Execute SQL]
    O --> P{Success?}
    P -->|Yes| Q[RELEASE SAVEPOINT]
    P -->|No| R{Recoverable?}
    R -->|Yes| S[SKIP + warning]
    R -->|No| T{Continue on error?}
    T -->|No| U[ROLLBACK + throw]
    T -->|Yes| V[Continue to next step]
    
    J --> W[Execute SQL directly]
    W --> X{Success?}
    X -->|No| Y[Record error]
    
    Q --> Z[COMMIT/ROLLBACK if dry-run]
    S --> Z
    V --> Z
    
    Z --> AA[captureSnapshot after]
    AA --> AB[postflightVerify]
    AB --> AC[completeMigrationRecord]
    AC --> AD[releaseAdvisoryLock]
    AD --> AE[MigrationResult]
```

## Planner Internals

### SmartMigrator Analysis

The SmartMigrator detects operations that require multi-step safe patterns:

```javascript
analyze(change) {
  // NOT NULL addition on non-empty table
  if (change.property === 'isNullable' && change.after === false) {
    return [
      { sql: 'ADD CONSTRAINT chk CHECK (col IS NOT NULL) NOT VALID' },
      { sql: 'VALIDATE CONSTRAINT chk' },
      { sql: 'ALTER COLUMN SET NOT NULL' },
      { sql: 'DROP CONSTRAINT chk' }
    ];
  }
  
  // Type cast with potential data loss
  if (change.property === 'dataType' && isUnsafeCast(change.before, change.after)) {
    return [
      { sql: 'ADD COLUMN col_new target_type' },
      { sql: 'UPDATE table SET col_new = CAST(col AS target)' },
      { sql: 'DROP COLUMN col' },
      { sql: 'RENAME COLUMN col_new TO col' }
    ];
  }
  
  // ... more patterns
}
```

### Dependency Resolution (Topological Sort)

```mermaid
graph LR
    A[Build adjacency list] --> B[Count in-degrees]
    B --> C[Queue zero-in-degree nodes]
    C --> D[Process by priority]
    D --> E[Reduce in-degree of dependents]
    E --> F{More zero-in-degree?}
    F -->|Yes| D
    F -->|No| G{Remaining nodes?}
    G -->|Yes| H[Cycle detected - error]
    G -->|No| I[Return sorted list]
```

**Priority Order for Same-Level Objects:**
1. Schema
2. Extension
3. Type
4. Table
5. Column
6. Constraint
7. Index
8. Sequence
9. Function
10. View
11. Trigger
12. Policy
13. Rule

## Differ Internals

### Rename Detection

Uses Levenshtein distance for fuzzy matching:

```javascript
function similarity(a, b) {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - (dist / maxLen);
}

// Confidence thresholds:
// HIGH:    > 0.80  (auto-confirm with same type family + parent)
// MEDIUM:  0.55-0.80 (require user confirmation)
// LOW:     0.35-0.55 (treat as separate CREATE + DROP)
```

**Match Scoring:**
```
score = levenshtein_similarity(old, new)
score += 0.25 if same_type_family
score += 0.15 if same_parent
score += 0.25 if is_prefix_or_suffix_rename
score += 0.10 if common_words_overlap
```

### Property Differ

Handles deep comparison with type awareness:

```javascript
diff(matchedObjects) {
  const changes = [];
  for (const match of matchedObjects) {
    const before = match.current;
    const after = match.desired;
    
    for (const [key, propDef] of objectProperties) {
      const oldValue = before[key];
      const newValue = after[key];
      
      if (!isEqual(oldValue, newValue)) {
        changes.push({
          objectType: match.objectType,
          objectKey: match.key,
          property: key,
          currentValue: oldValue,
          desiredValue: newValue,
          changeType: 'ALTER',
        });
      }
    }
  }
  return changes;
}
```

## Introspection Pipeline

### Query Execution Strategy

```mermaid
graph TD
    A[resolveUserSchemas] --> B[Parallel Query Bundle 1: DB-level]
    A --> C[Parallel Query Bundle 2: Schema-level]
    
    B --> D1[roles]
    B --> D2[tablespaces]
    B --> D3[accessMethods]
    B --> D4[databases]
    B --> D5[casts]
    B --> D6[eventTriggers]
    B --> D7[publications]
    B --> D8[subscriptions]
    B --> D9[FDW/servers/user mappings]
    
    C --> E1[tables]
    C --> E2[columns]
    C --> E3[indexes]
    C --> E4[constraints]
    C --> E5[functions]
    C --> E6[triggers]
    C --> E7[views + matviews]
    C --> E8[sequences]
    C --> E9[policies]
    C --> E10[types enums/composites/domains/ranges]
    C --> E11[...and more]
```

### Translation Pipeline

Raw PostgreSQL catalog rows are translated through a series of normalizers:

```mermaid
graph LR
    A[pg_catalog rows] --> B[Column name mapping]
    B --> C[Type normalization]
    C --> D[Default value parsing]
    D --> E[ACL parsing]
    E --> F[Comment attachment]
    F --> G[Privilege expansion]
    G --> H[SchemaSnapshot object]
```

## DDL Generation Pipeline

### Statement Generation Flow

```mermaid
graph TD
    A[generate changes] --> B{Change type?}
    B -->|CREATE| C[create-generator]
    B -->|ALTER| D[alter-generator]
    B -->|DROP| E[drop-generator]
    B -->|RENAME| F[rename-generator]
    B -->|COMMENT| G[comment-generator]
    B -->|GRANT| H[grant-generator]
    
    C --> I{Safe mode?}
    D --> I
    I -->|Yes| J[generateSafePatterns]
    I -->|No| K[generateDirect]
    
    J --> L[Output SQL]
    K --> L
    
    L --> M[Add comments]
    M --> N[Return joined SQL]
```

### Safe Patterns

```javascript
// SET NOT NULL (safe 3-step pattern)
function setNotNull(change) {
  const col = change.columnName;
  const tbl = change.tableName;
  const checkName = `sw_nn_check_${col}`;
  
  return [
    { sql: `ALTER TABLE ${tbl} ADD CONSTRAINT ${checkName} CHECK (${col} IS NOT NULL) NOT VALID` },
    { sql: `ALTER TABLE ${tbl} VALIDATE CONSTRAINT ${checkName}` },
    { sql: `ALTER TABLE ${tbl} ALTER COLUMN ${col} SET NOT NULL` },
    { sql: `ALTER TABLE ${tbl} DROP CONSTRAINT ${checkName}` },
  ];
}

// Foreign Key (safe pattern)
function addForeignKey(change) {
  return [
    { sql: `ALTER TABLE ${tbl} ADD CONSTRAINT ${fk} FOREIGN KEY ... NOT VALID` },
    { sql: `ALTER TABLE ${tbl} VALIDATE CONSTRAINT ${fk}` },
  ];
}

// Type Cast (safe pattern for impossible casts)
function unsafeTypeCast(change) {
  return [
    { sql: `ALTER TABLE ${tbl} ADD COLUMN ${col}_new ${newType}` },
    { sql: `UPDATE ${tbl} SET ${col}_new = CAST(${col} AS ${newType})` },
    { sql: `ALTER TABLE ${tbl} DROP COLUMN ${col}` },
    { sql: `ALTER TABLE ${tbl} RENAME COLUMN ${col}_new TO ${col}` },
  ];
}
```

## Transaction Model

### Transaction Boundaries

```mermaid
graph TD
    A[Phase Start] --> B{Non-transactional steps?}
    B -->|No| C[Use existing transaction]
    B -->|Yes| D[Non-TX execution]
    
    C --> E[BEGIN]
    E --> F[SET lock_timeout]
    F --> G[SET statement_timeout]
    
    G --> H[For each step]
    H --> I[SAVEPOINT sp_step_id]
    I --> J[Execute SQL]
    J --> K{Error?}
    K -->|No| L[RELEASE SAVEPOINT]
    K -->|Yes| M[ROLLBACK TO SAVEPOINT]
    
    M --> N{Recoverable error?}
    N -->|Yes| O[Skip step with warning]
    N -->|No| P{Continue on error?}
    P -->|No| Q[ROLLBACK all]
    P -->|Yes| O
    
    L --> R{More steps?}
    O --> R
    R -->|Yes| H
    R -->|No| S{Dry run?}
    S -->|Yes| T[ROLLBACK]
    S -->|No| U[COMMIT]
    
    D --> V[Execute outside transaction]
    V --> W[Cannot rollback]
```

### Savepoint Naming

Savepoint names are sanitized to be valid PostgreSQL identifiers:

```javascript
function sanitizeSavepointName(stepId) {
  return stepId
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[0-9]/, '_$&')
    .toLowerCase();
}
```

## Locking Model

### Advisory Lock Strategy

```mermaid
graph TD
    A[computeLockKey] --> B[SHA-256 hash of connectionId]
    B --> C[Convert to bigint]
    C --> D[Use as advisory lock key]
    
    D --> E[pg_try_advisory_xact_lock key]
    E --> F{Lock acquired?}
    F -->|Yes| G[Proceed with migration]
    F -->|No| HThrow MigrationConflictError]
    
    G --> I[Start heartbeat timer]
    I --> J[Periodic lock check]
    J --> K{Lock still held?}
    K -->|Yes| J
    K -->|No| L[Warning: lock lost]
```

### Lock Key Computation

```javascript
computeLockKey(connectionId) {
  const hash = crypto
    .createHash('sha256')
    .update(connectionId.toString())
    .digest('hex');
  // Convert first 8 bytes to bigint for pg_advisory_lock
  return BigInt('0x' + hash.slice(0, 16));
}
```

## Drift Detection

### Pre/Post Snapshot Comparison

```mermaid
graph TD
    A[Before Migration] --> B[Capture checksums]
    B --> C[SELECT oid, schema, name, kind, md5...]
    
    D[After Migration] --> E[Capture checksums]
    E --> F[Same query]
    
    G[Drift Detection] --> H[Compare checksums]
    H --> I{Checksums match?}
    I -->|Yes| J[No drift]
    I -->|No| K[Report drift objects]
    
    K --> L[Filter out migration changes]
    L --> M{Unexpected changes?}
    M -->|Yes| NThrow DriftDetectedError]
    M -->|No| J
```

### Drift Check Query

```sql
SELECT
  c.oid,
  n.nspname as schema,
  c.relname as name,
  c.relkind as kind,
  md5(n.nspname || '.' || c.relname || '.' || c.relkind) as checksum
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY n.nspname, c.relname
```

## Rollback Generation

### Strategy

```mermaid
graph TD
    A[executedSteps] --> B[Reverse order]
    B --> C[For each step]
    C --> D{Transaction boundary?}
    
    D -->|Transactional| E[Generate inverse SQL]
    E --> F[ALTER TABLE DROP vs CREATE]
    F --> G[Add to rollback steps]
    
    D -->|Non-TX| H[Mark as manual rollback]
    H --> I[Generate recovery SQL if available]
    
    G --> J{More steps?}
    I --> J
    J -->|Yes| C
    J -->|No| K[Return rollback list]
```

### Rollback SQL Patterns

| Forward Operation | Rollback Operation |
|-------------------|-------------------|
| CREATE TABLE | DROP TABLE |
| ADD COLUMN | DROP COLUMN |
| DROP COLUMN | Cannot rollback |
| ADD CONSTRAINT | DROP CONSTRAINT |
| CREATE INDEX | DROP INDEX |
| SET NOT NULL | DROP NOT NULL |
| ALTER TYPE | Re-ALTER TYPE (if reversible) |
| CREATE INDEX CONCURRENTLY | DROP INDEX |

## Storage Subsystem

### Migration Table Schema

```sql
CREATE TABLE migration_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID,
  version VARCHAR(30) NOT NULL,          -- YYYYMMDDHHMMSS format
  name VARCHAR(255) NOT NULL,
  checksum VARCHAR(64) NOT NULL,        -- SHA-256 of steps
  up_sql TEXT NOT NULL,
  down_sql TEXT,
  status VARCHAR(20) NOT NULL,           -- pending|running|completed|failed|partially_applied|rolled_back
  applied_by UUID,
  applied_at TIMESTAMPTZ,
  execution_time_ms INTEGER,
  error_message TEXT,
  
  -- Engine-specific columns
  schema_diff JSONB,
  sql_statements JSONB,
  execution_results JSONB,
  snapshot_before JSONB,
  snapshot_after JSONB,
  risk_summary JSONB,
  rollback_sql JSONB,
  warnings JSONB,
  
  change_count INTEGER,
  create_count INTEGER,
  alter_count INTEGER,
  drop_count INTEGER,
  rename_count INTEGER,
  
  pg_version VARCHAR(20),
  engine_version VARCHAR(20),
  direction VARCHAR(10) DEFAULT 'up',
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by UUID,
  tags TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Status Transitions

```mermaid
stateDiagram-v2
    [*] --> pending: createRecord
    pending --> running: execute starts
    running --> completed: success
    running --> failed: error
    running --> partially_applied: continueOnError + some failed
    completed --> rolled_back: rollback()
    failed --> rolled_back: manual recovery
```

## Risk Engine

### Risk Categories

```mermaid
graph TD
    A[RiskAssessment] --> B[Destructive Changes]
    A --> C[Data Loss Risk]
    A --> D[Lock Hazard]
    A --> E[Compatibility Risk]
    
    B --> B1[DROP TABLE]
    B --> B2[TRUNCATE]
    B --> B3[DROP COLUMN]
    
    C --> C1[Type narrowing cast]
    C --> C2[NOT NULL addition]
    C --> C3[Constraint addition]
    
    D --> D1[ALTER TABLE on large table]
    D --> D2[CREATE INDEX without CONCURRENTLY]
    D --> D3[ADD FK on large table]
    
    E --> E1[PG15+ feature on PG14]
    E --> E2[Extension not available]
    E --> E3[Privilege not granted]
```

### Risk Level Determination

```javascript
function computeOverallRisk(findings) {
  const severities = findings.map(f => f.severity);
  
  if (severities.some(s => s === 'critical')) return 'critical';
  if (severities.some(s => s === 'high')) return 'high';
  if (severities.some(s => s === 'medium')) return 'medium';
  if (severities.some(s => s === 'low')) return 'low';
  return 'none';
}
```

## Behavioral Migration Architecture

### Execution Order

```mermaid
graph LR
    A[Functions] --> B[Procedures]
    B --> C[Views]
    C --> D[Materialized Views]
    D --> E[Triggers]
    E --> F[Policies]
    F --> G[Rules]
    G --> H[Event Triggers]
```

### Dependency Extraction

```mermaid
graph TD
    A[View/Function Definition] --> B[SQL Parser]
    B --> C[Extract FROM/JOIN tables]
    B --> D[Extract function calls]
    B --> E[Extract type references]
    
    C --> F[Table Dependencies]
    D --> G[Function Dependencies]
    E --> H[Type Dependencies]
    
    F --> I[Dependency Graph]
    G --> I
    H --> I
```

## PostgreSQL Compatibility Layer

### Version Detection

```javascript
async function detectPgVersion(pool) {
  const result = await pool.query("SELECT current_setting('server_version_num')");
  return parseInt(result.rows[0].current_setting);  // e.g., 160001 for PG16.1
}

function majorVersion(version) {
  return Math.floor(version / 10000);  // e.g., 16
}
```

### Feature Detection

```javascript
function supportsPg15Features(pgVersion) {
  return pgVersion >= 150000;
}

function supportsPg16Features(pgVersion) {
  return pgVersion >= 160000;
}

// NULLS NOT DISTINCT (PG15+)
if (constraint.nullsNotDistinct && pgVersion >= 150000) {
  sql += ' NULLS NOT DISTINCT';
}

// ALTER TYPE RENAME VALUE (PG16+)
if (change.property === 'enumValueRename' && pgVersion < 160000) {
  throw new VersionIncompatibilityError('ALTER TYPE RENAME VALUE requires PG16+');
}
```

## Internal Data Structures

### SchemaSnapshot

```typescript
interface SchemaSnapshot {
  version: { numeric: number; major: number; string: string };
  database: DatabaseInfo;
  schemas: { [schemaName: string]: SchemaInfo };
  tables: { [key: string]: TableInfo };
  columns: { [key: string]: ColumnInfo[] };
  constraints: { [key: string]: ConstraintInfo };
  indexes: { [key: string]: IndexInfo };
  functions: { [key: string]: FunctionInfo };
  triggers: { [key: string]: TriggerInfo };
  views: { [key: string]: ViewInfo };
  materializedViews: { [key: string]: MaterializedViewInfo };
  sequences: { [key: string]: SequenceInfo };
  policies: { [key: string]: PolicyInfo };
  rules: { [key: string]: RuleInfo };
  // ... 20+ more object type collections
  checksum: string;
  introspectedAt: string;
}
```

### SchemaChange

```typescript
interface SchemaChange {
  id: string;                    // change_xxxxxxxx
  type: string;                  // addTable, alterColumn, dropIndex, etc.
  changeType: 'CREATE' | 'ALTER' | 'DROP' | 'RENAME';
  objectType: string;            // table, column, index, constraint, etc.
  objectKey: string;             // schema.tablename.columnname
  schema?: string;
  name?: string;
  property?: string;             // For ALTER: the property being changed
  before?: any;                  // Current value
  after?: any;                   // Desired value
  currentValue?: any;
  desiredValue?: any;
  track: 1 | 2;                  // 1=structural, 2=behavioral
  phase: number;                 // 1-32
  ddlStrategy: string;
  dependencies: string[];
  dependents: string[];
  risk: RiskInfo;
  isNonTransactional?: boolean;
  pgVersionMinimum?: number;
  sql?: string;
}
```

### MigrationStep

```typescript
interface MigrationStep {
  id: string;                    // step_001, step_002, ...
  type: StepType;
  phase: number;
  description: string;
  sql: string;
  isTransactional: boolean;
  riskLevel: RiskLevel;
  dependencies: string[];
  changeId?: string;
  preCheck?: string;
  preCheckExpectEmpty?: boolean;
  recoverySql?: string;
}
```

## Design Patterns Used

### 1. Strategy Pattern
The DDL generator uses different strategies for CREATE, ALTER, DROP, RENAME operations.

### 2. Template Method Pattern
`MigrationExecutor.execute()` defines the skeleton algorithm, with hooks for customization.

### 3. Chain of Responsibility
Risk checkers chain their assessments: `checkDestructive → checkDataLoss → checkLockRisk → checkCompatibility`.

### 4. Observer Pattern
`ProgressTracker` allows subscribers to receive execution events.

### 5. Builder Pattern
`MigrationPlan` is built incrementally by the `MigrationPlanner`.

### 6. Facade Pattern
`SwMigrationEngine` provides a simplified interface to the complex subsystem.

## Extension Points

### Custom Risk Category

```javascript
import { RiskEngine } from './risk-engine.js';

class ExtendedRiskEngine extends RiskEngine {
  assess(changes, pgVersion) {
    const findings = super.assess(changes, pgVersion);
    
    // Add custom risk check
    for (const change of changes) {
      if (this.isCustomRisk(change)) {
        findings.push({
          category: 'custom_category',
          severity: 'medium',
          changeId: change.id,
          message: 'Custom risk detected',
          recommendation: 'Review manually',
        });
      }
    }
    
    return computeOverallRisk(findings);
  }
}
```

### Custom Safe Pattern

Add to `safe-patterns.js`:

```javascript
export function generateSafePatterns(change) {
  // ... existing patterns ...
  
  if (change.objectType === 'table' && change.changeType === 'ALTER' && change.property === 'accessMethod') {
    return [
      { sql: `-- Safe tablespace migration...` },
      // Multi-step safe workflow
    ];
  }
  
  return null;
}
```

### Custom Introspection Query

Add to `introspection/queries/`:

```javascript
export async function queryCustomObjects(pool, version) {
  const result = await pool.query(`
    SELECT ...
    FROM pg_catalog.pg_custom
    WHERE ...
  `);
  return result.rows;
}
```

## Important Implementation Notes

### 1. ES Modules
All imports must include `.js` extension:
```javascript
import { foo } from './bar.js';  // Correct
import { foo } from './bar';     // Error in Node.js ESM
```

### 2. Error Handling
All errors extend `MigrationError` and include `toJSON()` for serialization.

### 3. Connection Scoping
`connectionId` is required for multi-database environments. It flows through all components.

### 4. Non-Transactional Detection
`isNonTransactionalSQL()` checks for:
- `CREATE/DROP/REINDEX INDEX CONCURRENTLY`
- `ALTER TYPE ADD VALUE` (pre-PG15)
- `VACUUM`
- `CLUSTER`

### 5. Statement Splitting
`splitSqlStatements()` handles:
- Dollar-quoted strings (`$$body$$`)
- Single-quoted strings with escapes
- Comments (`--` and `/* */`)
- Statement delimiters (`;`)

### 6. Naming Conventions
- Change IDs: `change_xxxxxxxx` (8-char UUID)
- Step IDs: `step_001`, `step_002`, ...
- Savepoints: `sp_step_001`, `sp_step_001_stmt_0`
