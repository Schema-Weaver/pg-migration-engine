/**
 * Schema Weaver Migration Engine - Type Definitions
 * https://schemaweaver.vivekmind.com/
 */

/**
 * @typedef {'none'|'low'|'medium'|'high'|'critical'} RiskLevel
 */

/**
 * @typedef {Object} RiskInfo
 * @property {RiskLevel} level
 * @property {string[]} categories - e.g., ['data_loss', 'lock_hazard']
 * @property {string[]} warnings
 * @property {boolean} safePatternAvailable
 * @property {boolean} requiresDowntime
 * @property {string|null} estimatedDuration
 */

/**
 * @typedef {Object} ChangeWarning
 * @property {string} code
 * @property {string} message
 * @property {string} [changeKey]
 * @property {'info'|'warning'|'high'|'critical'} severity
 * @property {string} [reason]
 * @property {string[]} [suggestions]
 */

/**
 * @typedef {Object} SchemaChange
 * @property {string} id - Unique change ID
 * @property {ChangeType} changeType - Type of change
 * @property {string} objectType - Object type (table, column, index, etc.)
 * @property {string} objectKey - Fully qualified key (e.g., "public.users.email")
 * @property {string} [schema] - Schema name
 * @property {string} [name] - Object name
 * @property {string} [property] - Property being changed (for ALTERs)
 * @property {*} [before] - Current value
 * @property {*} [after] - Desired value
 * @property {*} [currentValue] - Current property value (property-level diff)
 * @property {*} [desiredValue] - Desired property value (property-level diff)
 * @property {number} track - 1 = structural, 2 = behavioral
 * @property {number} phase - Execution phase (1-25)
 * @property {string} ddlStrategy - How to generate DDL (CREATE, ALTER, DROP, etc.)
 * @property {string[]} dependencies - ObjectKeys this change depends on
 * @property {string[]} dependents - ObjectKeys that depend on this change
 * @property {RiskInfo} risk - Risk assessment
 * @property {boolean} [isNonTransactional] - Cannot run in transaction
 * @property {boolean} [requiresRecreation] - Object must be dropped and recreated
 * @property {boolean} [safePatternAvailable] - Has a non-blocking alternative
 * @property {number|null} [pgVersionMinimum] - Minimum PG version (e.g., 14 means PG 14+)
 * @property {boolean} [dataLossRisk] - This change may lose data
 * @property {string[]} [collateralDamage] - Other objects affected
 * @property {boolean} [isRename] - Is a rename change
 * @property {string} [renameFrom] - Original name if rename
 * @property {string} [renameTo] - New name if rename
 * @property {number} [confidence] - Rename detection confidence (0-1)
 * @property {boolean} [confirmed] - Rename confirmed by user
 * @property {string} [sql] - Generated SQL (filled by DDL generator)
 * @property {Record<string,*>} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} ObjectMatch
 * @property {string} objectType
 * @property {string} key
 * @property {*} [object] - The object definition
 * @property {*} [desired] - Desired snapshot object
 * @property {*} [current] - Current snapshot object
 * @property {number} [similarity] - Match similarity score
 */

/**
 * @typedef {Object} RenameMatch
 * @property {string} objectType
 * @property {string} key
 * @property {string} oldName
 * @property {string} newName
 * @property {number} confidence - 0-1
 * @property {boolean} confirmed - Was rename confirmed by user?
 * @property {*} [object]
 */

/**
 * @typedef {Object} MatchedObjects
 * @property {ObjectMatch[]} creates - Objects only in desired
 * @property {ObjectMatch[]} drops - Objects only in current
 * @property {ObjectMatch[]} matches - Objects in both (property diff needed)
 * @property {RenameMatch[]} renames - Detected renames (unconfirmed)
 */

/**
 * @typedef {Object} DependencyNode
 * @property {string} key
 * @property {string} objectType
 * @property {string[]} dependencies
 * @property {string[]} dependents
 */

/**
 * @typedef {Object} DependencyGraph
 * @property {Map<string, DependencyNode>} nodes
 * @property {string[][]} cycles - Detected cycles
 */

/**
 * @typedef {Object} ChangeSummary
 * @property {number} totalChanges
 * @property {number} creates
 * @property {number} drops
 * @property {number} alters
 * @property {number} renames
 * @property {number} recreates
 * @property {number} replaces
 * @property {Object} byTrack
 * @property {Object} byPhase
 * @property {Object} byObjectType
 * @property {Object} riskSummary
 * @property {boolean} requiresDowntime
 * @property {string} estimatedDuration
 */

/**
 * @typedef {Object} SchemaDiff
 * @property {ChangeSummary} summary
 * @property {SchemaChange[]} changes
 * @property {ChangeWarning[]} warnings
 * @property {DependencyGraph} dependencyGraph
 * @property {Object} metadata
 * @property {number} metadata.diffDuration
 * @property {number} metadata.pgVersion
 * @property {string} [metadata.desiredChecksum]
 * @property {string} [metadata.currentChecksum]
 */

export {};
