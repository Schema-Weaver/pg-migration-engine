/**
 * Schema Weaver Migration Engine - Type Definitions
 * https://schemaweaver.vivekmind.com/
 */

/**
 * @typedef {Object} PlanOptions
 * @property {string} [name]
 * @property {string} [description]
 * @property {string} sourceChecksum
 * @property {string} targetChecksum
 * @property {boolean} [safeMode]
 * @property {number} [batchSize]
 * @property {number} [sleepMs]
 */

/**
 * @typedef {Object} MigrationOptions
 * @property {string} [name]
 * @property {boolean} [dryRun]
 * @property {boolean} [force]
 * @property {boolean} [safeMode]
 * @property {number} [statementTimeoutMs]
 * @property {number} [batchSize]
 * @property {number} [sleepMs]
 * @property {function(string, string):void} [onProgress]
 */

/**
 * @typedef {Object} DdlOptions
 * @property {number} [pgVersion]
 * @property {boolean} [safeMode]
 * @property {boolean} [includeComments]
 * @property {boolean} [includeGrants]
 */

/**
 * @typedef {Object} DriftResult
 * @property {boolean} hasDrift
 * @property {import('./changes.js').SchemaChange[]} changes
 * @property {string} [resolution]
 */

/**
 * @typedef {Object} RecoveryResult
 * @property {string} action
 * @property {string} message
 */

/**
 * @typedef {Object} MigrationRecord
 * @property {string} id
 * @property {string} name
 * @property {string} checksum
 * @property {'PENDING'|'RUNNING'|'COMPLETED'|'FAILED'|'STALE'} status
 * @property {MigrationPlan} plan
 * @property {MigrationResult} [result]
 * @property {string} [snapshotBefore]
 * @property {string} [snapshotAfter]
 * @property {string} [appliedAt]
 * @property {string} [appliedBy]
 * @property {number} [durationMs]
 * @property {string} createdAt
 */

/**
 * @typedef {Object} EngineConfig
 * @property {import('./connection.js').PoolConfig} connection
 * @property {StorageProvider} [storage]
 * @property {boolean} [safeMode]
 * @property {number} [defaultBatchSize]
 * @property {number} [defaultSleepMs]
 * @property {number} [statementTimeoutMs]
 */

/**
 * @typedef {Object} BackfillOptions
 * @property {string} table
 * @property {string} fromColumn
 * @property {string} toColumn
 * @property {string} transform
 * @property {number} batchSize
 * @property {number} rateLimitMs
 * @property {string} pkColumn
 */

/**
 * @typedef {Object} StorageProvider
 * @property {function(string, import('./schema.js').SchemaModel):Promise<void>} saveSnapshot
 * @property {function(string):Promise<import('./schema.js').SchemaModel>} loadSnapshot
 * @property {function():Promise<Array<{checksum:string,timestamp:string}>>} listSnapshots
 * @property {function(MigrationRecord):Promise<void>} saveMigration
 * @property {function(string):Promise<MigrationRecord|null>} getMigration
 * @property {function():Promise<MigrationRecord|null>} getLatestMigration
 * @property {function():Promise<MigrationRecord[]>} getMigrationHistory
 * @property {function(string,string):Promise<void>} saveMigrationFile
 * @property {function(string):Promise<string>} loadMigrationFile
 * @property {function():Promise<string[]>} listMigrationFiles
 */

export {};
