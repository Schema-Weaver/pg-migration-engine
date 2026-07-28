/**
 * Schema Weaver Migration Engine - Type Definitions
 * https://schemaweaver.vivekmind.com/
 */

/**
 * @typedef {Object} SchemaInfo
 * @property {string} name
 * @property {string} owner
 */

/**
 * @typedef {Object} DatabaseInfo
 * @property {string} name
 * @property {string} owner
 * @property {string} encoding
 * @property {string} collate
 * @property {string} ctype
 * @property {boolean} [isTemplate]
 * @property {boolean} [allowConn]
 */

/**
 * @typedef {Object} TableInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} owner
 * @property {boolean} isTemporary
 * @property {boolean} isUnlogged
 * @property {boolean} isPartitioned
 * @property {boolean} isPartition
 * @property {boolean} isForeignTable
 * @property {'RANGE'|'LIST'|'HASH'} [partitionStrategy]
 * @property {string[]} [partitionColumns]
 * @property {string} [partitionParent]
 * @property {string} [partitionBound]
 * @property {string} [partitionKeyDef]
 * @property {string[]} [inheritsFrom]
 * @property {string} [ofType]
 * @property {string} [tablespace]
 * @property {Record<string, string|number>} [storageParameters]
 * @property {'DEFAULT'|'NOTHING'|'FULL'|'INDEX'} [replicaIdentity]
 * @property {boolean} [hasOids]
 * @property {string} [comment]
 * @property {Object[]} [privileges]
 * @property {boolean} rlsEnabled
 * @property {boolean} rlsForced
 * @property {ColumnInfo[]} columns
 * @property {string[]} constraints
 * @property {string[]} indexes
 * @property {string[]} triggers
 * @property {string[]} policies
 * @property {string} [foreignServer]
 * @property {Object} [foreignOptions]
 */

/**
 * @typedef {Object} ColumnInfo
 * @property {string} name
 * @property {string} dataType
 * @property {number} ordinalPosition
 * @property {boolean} isNullable
 * @property {string} [defaultValue]
 * @property {boolean} isGenerated
 * @property {string} [generatedExpression]
 * @property {'STORED'|'VIRTUAL'} [generatedStorage]
 * @property {boolean} isIdentity
 * @property {'ALWAYS'|'BY_DEFAULT'} [identityMode]
 * @property {SequenceOptions} [identityOptions]
 * @property {string} [collation]
 * @property {'PLAIN'|'EXTERNAL'|'EXTENDED'|'MAIN'|'DEFAULT'} [storage]
 * @property {number} [statistics]
 * @property {string} [compression]
 * @property {string} [comment]
 * @property {Object} [foreignOptions]
 */

/**
 * @typedef {Object} ConstraintInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} table
 * @property {'PRIMARY_KEY'|'UNIQUE'|'FOREIGN_KEY'|'CHECK'|'EXCLUSION'|'NOT_NULL'} type
 * @property {boolean} deferrable
 * @property {boolean} initiallyDeferred
 * @property {boolean} isValidated
 * @property {boolean} enforced
 * @property {boolean} noInherit
 * @property {string} definition
 * @property {string[]} [columns]
 * @property {string} [referencedTable]
 * @property {string[]} [referencedColumns]
 * @property {'FULL'|'PARTIAL'|'SIMPLE'} [matchType]
 * @property {string} [onDelete]
 * @property {string} [onUpdate]
 * @property {string} [periodColumn]
 * @property {string} [withoutOverlaps]
 * @property {boolean} [nullsNotDistinct]
 * @property {string} [checkExpression]
 * @property {Array<{column:string,operator:string}>} [excludeElements]
 * @property {string} [excludeMethod]
 * @property {string} [index]
 */

/**
 * @typedef {Object} IndexInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} table
 * @property {boolean} isUnique
 * @property {boolean} isPrimary
 * @property {boolean} isConcurrent
 * @property {string} method
 * @property {IndexColumnInfo[]} columns
 * @property {string[]} [includeColumns]
 * @property {string} [whereClause]
 * @property {Record<string, string|number>} [storageParameters]
 * @property {string} [tablespace]
 * @property {boolean} [nullsNotDistinct]
 * @property {boolean} [isPartitioned]
 * @property {string} [comment]
 */

/**
 * @typedef {Object} IndexColumnInfo
 * @property {string} expression
 * @property {string} [collation]
 * @property {string} [opclass]
 * @property {'ASC'|'DESC'} [direction]
 * @property {'FIRST'|'LAST'} [nullsOrder]
 */

/**
 * @typedef {Object} FunctionInfo
 * @property {string} schema
 * @property {string} name
 * @property {string[]} argumentTypes
 * @property {string} returnType
 * @property {string} language
 * @property {string} source
 * @property {'IMMUTABLE'|'STABLE'|'VOLATILE'} volatility
 * @property {boolean} isStrict
 * @property {'INVOKER'|'DEFINER'} security
 * @property {'SAFE'|'UNSAFE'|'RESTRICTED'} parallel
 * @property {boolean} isLeakproof
 * @property {number} cost
 * @property {number} rows
 * @property {'FUNCTION'|'PROCEDURE'|'AGGREGATE'|'WINDOW'} kind
 * @property {string} [comment]
 */

/**
 * @typedef {Object} ProcedureInfo
 * @property {string} schema
 * @property {string} name
 * @property {string[]} argumentTypes
 * @property {string} language
 * @property {string} source
 * @property {'INVOKER'|'DEFINER'} security
 * @property {'SAFE'|'UNSAFE'|'RESTRICTED'} parallel
 */

/**
 * @typedef {Object} AggregateInfo
 * @property {string} schema
 * @property {string} name
 * @property {string[]} argumentTypes
 * @property {string} returnType
 * @property {string} language
 * @property {string} source
 */

/**
 * @typedef {Object} ViewInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} definition
 * @property {string} owner
 * @property {'LOCAL'|'CASCADED'} [checkOption]
 * @property {boolean} isRecursive
 * @property {ColumnInfo[]} [columns]
 * @property {string} [comment]
 */

/**
 * @typedef {Object} MaterializedViewInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} definition
 * @property {string} owner
 * @property {string} [tablespace]
 * @property {Record<string, string|number>} [storageParameters]
 * @property {boolean} withData
 * @property {string} [comment]
 */

/**
 * @typedef {Object} TypeInfo
 * @property {string} schema
 * @property {string} name
 * @property {'ENUM'|'COMPOSITE'|'DOMAIN'|'RANGE'|'BASE'|'SHELL'|'MULTIRANGE'} kind
 * @property {string} [rangeType]
 * @property {string[]} [enumValues]
 * @property {Array<{name:string,type:string}>} [attributes]
 * @property {string} [baseType]
 * @property {boolean} [notNull]
 * @property {string} [defaultValue]
 * @property {string} [checkConstraint]
 * @property {string} [subtype]
 * @property {string} [inputFunction]
 * @property {string} [outputFunction]
 * @property {string} owner
 * @property {string} [comment]
 */

/**
 * @typedef {Object} SequenceInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} dataType
 * @property {number} [startValue]
 * @property {number} [increment]
 * @property {number} [minValue]
 * @property {number} [maxValue]
 * @property {number} [cache]
 * @property {boolean} cycle
 * @property {string} [ownedBy]
 * @property {string} owner
 */

/**
 * @typedef {Object} TriggerInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} table
 * @property {'BEFORE'|'AFTER'|'INSTEAD OF'} timing
 * @property {Array<'INSERT'|'UPDATE'|'DELETE'|'TRUNCATE'>} events
 * @property {boolean} isForEachRow
 * @property {string} [whenCondition]
 * @property {string} functionCall
 * @property {'ENABLED'|'DISABLED'|'REPLICA'|'ALWAYS'} enabled
 * @property {string} [comment]
 */

/**
 * @typedef {Object} EventTriggerInfo
 * @property {string} name
 * @property {string} event
 * @property {string} function
 * @property {'ENABLED'|'DISABLED'|'REPLICA'|'ALWAYS'} enabled
 * @property {string[]} tags
 * @property {string} owner
 */

/**
 * @typedef {Object} ExtensionInfo
 * @property {string} name
 * @property {string} schema
 * @property {string} version
 * @property {boolean} isAvailable
 */

/**
 * @typedef {Object} PolicyInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} table
 * @property {'ALL'|'SELECT'|'INSERT'|'UPDATE'|'DELETE'} command
 * @property {boolean} isPermissive
 * @property {string[]} roles
 * @property {string} [usingExpression]
 * @property {string} [withCheckExpression]
 */

/**
 * @typedef {Object} GrantInfo
 * @property {string} schema
 * @property {string} object
 * @property {string} objectType
 * @property {string} privilege
 * @property {string} grantee
 * @property {string} grantor
 * @property {boolean} isGrantable
 * @property {string} [column]
 */

/**
 * @typedef {Object} SequenceOptions
 * @property {number} [startWith]
 * @property {number} [incrementBy]
 * @property {number|'NO_MINVALUE'} [minValue]
 * @property {number|'NO_MAXVALUE'} [maxValue]
 * @property {number} [cache]
 * @property {boolean} [cycle]
 * @property {string} [ownedBy]
 */

/**
 * @typedef {Object} StatisticsInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} [table]
 * @property {Array<string>} kinds
 * @property {string[]} columns
 * @property {string} [definition]
 * @property {string} owner
 */

/**
 * @typedef {Object} CollationInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} provider
 * @property {string} [locale]
 * @property {number} [encoding]
 * @property {boolean} isDeterministic
 * @property {string} owner
 */

/**
 * @typedef {Object} ConversionInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} proc
 * @property {boolean} isDefault
 * @property {string} owner
 */

/**
 * @typedef {Object} OperatorInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} [leftType]
 * @property {string} [rightType]
 * @property {string} [resultType]
 * @property {string} proc
 * @property {boolean} canHash
 * @property {boolean} canMerge
 * @property {string} [commutator]
 * @property {string} [negator]
 * @property {string} owner
 */

/**
 * @typedef {Object} OperatorClassInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} family
 * @property {string} inputType
 * @property {boolean} isDefault
 * @property {string} accessMethod
 * @property {string} owner
 */

/**
 * @typedef {Object} OperatorFamilyInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} accessMethod
 * @property {string} owner
 */

/**
 * @typedef {Object} TextSearchConfigInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} parser
 * @property {string} owner
 */

/**
 * @typedef {Object} TextSearchDictInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} template
 * @property {Object} [options]
 * @property {string} owner
 */

/**
 * @typedef {Object} TextSearchParserInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} start
 * @property {string} getToken
 * @property {string} end
 * @property {string} [headline]
 * @property {string} owner
 */

/**
 * @typedef {Object} TextSearchTemplateInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} [init]
 * @property {string} lexize
 * @property {string} owner
 */

/**
 * @typedef {Object} ForeignDataWrapperInfo
 * @property {string} name
 * @property {string} [handler]
 * @property {string} [validator]
 * @property {Object} [options]
 * @property {string} owner
 */

/**
 * @typedef {Object} ForeignServerInfo
 * @property {string} name
 * @property {string} fdw
 * @property {string} [type]
 * @property {Object} [options]
 * @property {string} owner
 */

/**
 * @typedef {Object} UserMappingInfo
 * @property {string} user
 * @property {string} server
 * @property {Object} [options]
 */

/**
 * @typedef {Object} CastInfo
 * @property {string} sourceType
 * @property {string} targetType
 * @property {string} [function]
 * @property {'EXPLICIT'|'ASSIGNMENT'|'IMPLICIT'} context
 * @property {'FUNCTION'|'INOUT'|'BINARY'} method
 */

/**
 * @typedef {Object} RuleInfo
 * @property {string} schema
 * @property {string} name
 * @property {string} table
 * @property {string} event
 * @property {boolean} isInstead
 * @property {boolean} isEnabled
 * @property {string} [definition]
 * @property {string} [qual]
 */

/**
 * @typedef {Object} RoleInfo
 * @property {string} name
 * @property {boolean} isSuperuser
 * @property {boolean} canCreateRole
 * @property {boolean} canCreateDB
 * @property {boolean} canLogin
 * @property {boolean} inherit
 * @property {Array<{member:string,admin_option:boolean}>} memberships
 * @property {string} [comment]
 */

/**
 * @typedef {Object} TablespaceInfo
 * @property {string} name
 * @property {string} owner
 * @property {string} [location]
 * @property {boolean} isDefault
 * @property {string} [acl]
 * @property {Object} [options]
 */

/**
 * @typedef {Object} AccessMethodInfo
 * @property {string} name
 * @property {'TABLE'|'INDEX'} type
 * @property {string} [handler]
 */

/**
 * @typedef {Object} LanguageInfo
 * @property {string} name
 * @property {boolean} isTrusted
 * @property {string} [handler]
 * @property {string} [inline]
 * @property {string} [validator]
 * @property {string} owner
 */

/**
 * @typedef {Object} DefaultPrivilegeInfo
 * @property {string} role
 * @property {string} [schema]
 * @property {string} objectType
 * @property {string} acl
 */

/**
 * @typedef {Object} PublicationInfo
 * @property {string} name
 * @property {string} owner
 * @property {boolean} allTables
 * @property {boolean} insert
 * @property {boolean} update
 * @property {boolean} delete
 * @property {boolean} truncate
 * @property {string[]} tables
 * @property {string[]} schemas
 */

/**
 * @typedef {Object} SubscriptionInfo
 * @property {string} name
 * @property {string} conninfo
 * @property {string} [slotName]
 * @property {string[]} publications
 * @property {boolean} enabled
 * @property {boolean} [syncCommit]
 * @property {string} owner
 */

export {};
