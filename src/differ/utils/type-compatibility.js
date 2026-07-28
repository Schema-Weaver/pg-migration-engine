/**
 * Schema Weaver Migration Engine - Schema Differ - Utilities
 * https://schemaweaver.vivekmind.com/
 */

/**
 * Normalize type names for comparison.
 * @param {string} type - PostgreSQL type name
 * @returns {string}
 */
export function normalizeType(type) {
  if (!type) return 'unknown';
  
  const lower = type.toLowerCase().trim();
  
  // Handle array types
  const isArray = lower.endsWith('[]');
  const baseType = isArray ? lower.slice(0, -2) : lower;
  
  // Normalize common aliases
  const aliases = {
    'int': 'integer',
    'int4': 'integer',
    'int2': 'smallint',
    'int8': 'bigint',
    'serial': 'integer',
    'bigserial': 'bigint',
    'smallserial': 'smallint',
    'bool': 'boolean',
    'float4': 'real',
    'float8': 'double precision',
    'double': 'double precision',
    'char': 'character',
    'varchar': 'character varying',
    'timestamp': 'timestamp without time zone',
    'timestamptz': 'timestamp with time zone',
    'time': 'time without time zone',
    'timetz': 'time with time zone',
  };
  
  const normalized = aliases[baseType] || baseType;
  
  return isArray ? `${normalized}[]` : normalized;
}

/**
 * Extract type family and parameters.
 * @param {string} type
 * @returns {{family: string, params: Object|null}}
 */
export function parseTypeParams(type) {
  const normalized = normalizeType(type);
  
  // Check for parameterized types: varchar(n), numeric(p,s), etc.
  const match = normalized.match(/^([a-z_]+)\s*\(([^)]+)\)$/);
  
  if (!match) {
    return { family: normalized, params: null };
  }
  
  const family = match[1];
  const paramString = match[2];
  
  if (family === 'character varying' || family === 'varchar' || family === 'character') {
    return { family, params: { length: parseInt(paramString, 10) } };
  }
  
  if (family === 'numeric' || family === 'decimal') {
    const [precision, scale] = paramString.split(',').map(s => parseInt(s.trim(), 10));
    return { family, params: { precision, scale } };
  }
  
  if (family === 'bit' || family === 'bit varying' || family === 'varbit') {
    return { family, params: { length: parseInt(paramString, 10) } };
  }
  
  return { family: normalized, params: null };
}

/**
 * PostgreSQL cast matrix.
 * Format: sourceType → { targetType: { implicit: bool, safe: bool, using: string|null, dataLossRisk: string|null } }
 */
const CAST_MATRIX = {
  // Smallint casts
  'smallint': {
    'integer': { implicit: true, safe: true },
    'bigint': { implicit: true, safe: true },
    'real': { implicit: true, safe: true },
    'double precision': { implicit: true, safe: true },
    'numeric': { implicit: true, safe: true },
    'decimal': { implicit: true, safe: true },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  // Integer casts
  'integer': {
    'smallint': { implicit: false, safe: false, dataLossRisk: 'overflow', minCheck: 'MIN(smallint)' },
    'bigint': { implicit: true, safe: true },
    'real': { implicit: true, safe: true },
    'double precision': { implicit: true, safe: true },
    'numeric': { implicit: true, safe: true },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  // Bigint casts
  'bigint': {
    'smallint': { implicit: false, safe: false, dataLossRisk: 'overflow' },
    'integer': { implicit: false, safe: false, dataLossRisk: 'overflow' },
    'real': { implicit: true, safe: true },
    'double precision': { implicit: true, safe: true },
    'numeric': { implicit: true, safe: true },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  // Real/float casts
  'real': {
    'double precision': { implicit: true, safe: true },
    'numeric': { implicit: true, safe: true },
    'integer': { implicit: false, safe: false, dataLossRisk: 'truncation' },
    'bigint': { implicit: false, safe: false, dataLossRisk: 'truncation' },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  // Double precision casts
  'double precision': {
    'real': { implicit: true, safe: true },
    'numeric': { implicit: true, safe: true },
    'integer': { implicit: false, safe: false, dataLossRisk: 'truncation' },
    'bigint': { implicit: false, safe: false, dataLossRisk: 'truncation' },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  // Numeric/decimal casts
  'numeric': {
    'integer': { implicit: false, safe: false, dataLossRisk: 'truncation' },
    'bigint': { implicit: false, safe: false, dataLossRisk: 'truncation' },
    'real': { implicit: true, safe: true },
    'double precision': { implicit: true, safe: true },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  // Character varying/text casts
  'character varying': {
    'text': { implicit: true, safe: true },
    'character': { implicit: false, safe: false, dataLossRisk: 'truncation' },
    'integer': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'bigint': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'numeric': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'boolean': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'date': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'timestamp': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'timestamp with time zone': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'uuid': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'json': { implicit: false, safe: true, using: '::json' },
    'jsonb': { implicit: false, safe: true, using: '::jsonb' },
  },
  
  'text': {
    'character varying': { implicit: true, safe: true },
    'character': { implicit: false, safe: false, dataLossRisk: 'truncation' },
    'integer': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'bigint': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'numeric': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'boolean': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'date': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'uuid': { implicit: false, safe: false, dataLossRisk: 'parse_error' },
    'json': { implicit: false, safe: true, using: '::json' },
    'jsonb': { implicit: false, safe: true, using: '::jsonb' },
  },
  
  // Boolean casts
  'boolean': {
    'integer': { implicit: false, safe: true, using: "CASE WHEN true THEN 1 ELSE 0 END" },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  // Date/time casts
  'date': {
    'timestamp': { implicit: true, safe: true },
    'timestamp with time zone': { implicit: true, safe: true },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  'timestamp': {
    'timestamp with time zone': { implicit: true, safe: true },
    'date': { implicit: true, safe: true },
    'time': { implicit: false, safe: true, using: '::time' },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  'timestamp with time zone': {
    'timestamp': { implicit: true, safe: true },
    'date': { implicit: true, safe: true },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
    'text': { implicit: false, safe: true, using: '::text' },
  },
  
  // JSON casts
  'json': {
    'jsonb': { implicit: true, safe: true },
    'text': { implicit: true, safe: true },
    'character varying': { implicit: true, safe: true },
  },
  
  'jsonb': {
    'json': { implicit: true, safe: true },
    'text': { implicit: true, safe: true },
    'character varying': { implicit: true, safe: true },
  },
  
  // UUID casts
  'uuid': {
    'text': { implicit: false, safe: true, using: '::text' },
    'character varying': { implicit: false, safe: true, using: '::character varying' },
  },
};

/**
 * Check if a cast exists between two types.
 * @param {string} fromType
 * @param {string} toType
 * @returns {{exists: boolean, implicit: boolean, safe: boolean, using: string|null, dataLossRisk: string|null}}
 */
export function getCastInfo(fromType, toType) {
  const from = normalizeType(fromType);
  const to = normalizeType(toType);
  
  if (from === to) {
    return { exists: true, implicit: true, safe: true, using: null, dataLossRisk: null };
  }
  
  // Check parameterized types (same family)
  const fromParsed = parseTypeParams(from);
  const toParsed = parseTypeParams(to);
  
  if (fromParsed.family === toParsed.family) {
    return getSameFamilyCastInfo(fromParsed, toParsed);
  }
  
  // Check explicit cast matrix
  const sourceCasts = CAST_MATRIX[from];
  if (sourceCasts && sourceCasts[to]) {
    return { exists: true, ...sourceCasts[to] };
  }
  
  // Try reverse lookup for assignment casts
  // (Some types can be cast to even if not in the forward direction)
  const targetCasts = CAST_MATRIX[to];
  if (targetCasts && targetCasts[from]) {
    // Reverse the cast info
    const info = targetCasts[from];
    return {
      exists: true,
      implicit: false, // Not implicit in reverse
      safe: info.safe,
      using: info.using ? `::${to}` : null,
      dataLossRisk: info.dataLossRisk,
    };
  }
  
  // No cast path found
  return { exists: false, implicit: false, safe: false, using: null, dataLossRisk: 'no_cast_path' };
}

/**
 * Handle same-family type changes (varchar(50) → varchar(255), etc.)
 */
function getSameFamilyCastInfo(fromParsed, toParsed) {
  const family = fromParsed.family;
  
  // String types with length
  if (['character varying', 'varchar', 'character', 'char'].includes(family)) {
    const fromLen = fromParsed.params?.length || Infinity;
    const toLen = toParsed.params?.length || Infinity;
    
    if (toLen >= fromLen) {
      // Widening (safe)
      return { exists: true, implicit: true, safe: true, using: null, dataLossRisk: null };
    } else {
      // Narrowing (data loss)
      return { exists: true, implicit: true, safe: false, using: null, dataLossRisk: 'truncation' };
    }
  }
  
  // Numeric types with precision/scale
  if (family === 'numeric' || family === 'decimal') {
    const fromPrec = fromParsed.params?.precision || Infinity;
    const toPrec = toParsed.params?.precision || Infinity;
    const fromScale = fromParsed.params?.scale || 0;
    const toScale = toParsed.params?.scale || 0;
    
    // Widening precision is safe
    if (toPrec >= fromPrec && toScale >= fromScale) {
      return { exists: true, implicit: true, safe: true, using: null, dataLossRisk: null };
    }
    
    // Narrowing may lose data
    return { exists: true, implicit: true, safe: false, using: null, dataLossRisk: 'precision_loss' };
  }
  
  // Bit types
  if (family === 'bit' || family === 'bit varying' || family === 'varbit') {
    const fromLen = fromParsed.params?.length || Infinity;
    const toLen = toParsed.params?.length || Infinity;
    
    if (toLen >= fromLen) {
      return { exists: true, implicit: true, safe: true, using: null, dataLossRisk: null };
    }
    return { exists: true, implicit: true, safe: false, using: null, dataLossRisk: 'truncation' };
  }
  
  // Default: same family, no params
  return { exists: true, implicit: true, safe: true, using: null, dataLossRisk: null };
}

/**
 * Check if a cast is implicit (can be done without USING clause).
 * @param {string} fromType
 * @param {string} toType
 * @returns {boolean}
 */
export function isImplicitCast(fromType, toType) {
  const info = getCastInfo(fromType, toType);
  return info.exists && info.implicit;
}

/**
 * Check if a cast is safe (no data loss).
 * @param {string} fromType
 * @param {string} toType
 * @returns {boolean}
 */
export function isSafeCast(fromType, toType) {
  const info = getCastInfo(fromType, toType);
  return info.exists && info.safe;
}

/**
 * Check if a cast is a widening (e.g., int → bigint, varchar(50) → varchar(255)).
 * @param {string} fromType
 * @param {string} toType
 * @returns {boolean}
 */
export function isWideningCast(fromType, toType) {
  const fromParsed = parseTypeParams(fromType);
  const toParsed = parseTypeParams(toType);
  
  // Same family checks
  if (fromParsed.family === toParsed.family) {
    const family = fromParsed.family;
    
    // String types: longer is wider
    if (['character varying', 'varchar', 'character', 'char'].includes(family)) {
      const fromLen = fromParsed.params?.length || Infinity;
      const toLen = toParsed.params?.length || Infinity;
      return toLen >= fromLen;
    }
    
    // Numeric types: higher precision is wider
    if (family === 'numeric' || family === 'decimal') {
      const fromPrec = fromParsed.params?.precision || Infinity;
      const toPrec = toParsed.params?.precision || Infinity;
      return toPrec >= fromPrec;
    }
  }
  
  // Cross-family widening
  const wideningCasts = [
    ['smallint', 'integer'],
    ['smallint', 'bigint'],
    ['smallint', 'real'],
    ['smallint', 'double precision'],
    ['smallint', 'numeric'],
    ['integer', 'bigint'],
    ['integer', 'real'],
    ['integer', 'double precision'],
    ['integer', 'numeric'],
    ['bigint', 'real'],
    ['bigint', 'double precision'],
    ['bigint', 'numeric'],
    ['real', 'double precision'],
    ['real', 'numeric'],
    ['double precision', 'numeric'],
    ['date', 'timestamp'],
    ['date', 'timestamp with time zone'],
    ['timestamp', 'timestamp with time zone'],
    ['character varying', 'text'],
    ['json', 'jsonb'],
  ];
  
  const from = normalizeType(fromType);
  const to = normalizeType(toType);
  
  return wideningCasts.some(([f, t]) => f === from && t === to);
}

/**
 * Check if a cast is narrowing (potential data loss).
 */
export function isNarrowingCast(fromType, toType) {
  return !isWideningCast(fromType, toType) && getCastInfo(fromType, toType).exists;
}

/**
 * Check if two types are in the same family.
 * @param {string} typeA
 * @param {string} typeB
 * @returns {boolean}
 */
export function sameTypeFamily(typeA, typeB) {
  const a = parseTypeParams(typeA);
  const b = parseTypeParams(typeB);
  return a.family === b.family;
}

/**
 * Check if types are exactly equal (including parameters).
 * @param {string} typeA
 * @param {string} typeB
 * @returns {boolean}
 */
export function typesEqual(typeA, typeB) {
  return normalizeType(typeA) === normalizeType(typeB);
}

/**
 * Get the USING clause for a type cast.
 * @param {string} fromType
 * @param {string} toType
 * @param {string} columnName
 * @returns {string|null}
 */
export function getCastUsingClause(fromType, toType, columnName) {
  const info = getCastInfo(fromType, toType);
  
  if (!info.exists) return null;
  if (info.implicit) return `ALTER COLUMN ${columnName} TYPE ${normalizeType(toType)}`;
  
  const to = normalizeType(toType);
  
  if (info.using) {
    return `ALTER COLUMN ${columnName} TYPE ${to} USING ${columnName}${info.using}`;
  }
  
  return `ALTER COLUMN ${columnName} TYPE ${to} USING ${columnName}::${to}`;
}

/**
 * List of type families for compatibility checks.
 */
export const TYPE_FAMILIES = {
  integer: ['smallint', 'integer', 'bigint', 'serial', 'bigserial', 'smallserial'],
  float: ['real', 'double precision', 'float4', 'float8'],
  numeric: ['numeric', 'decimal'],
  boolean: ['boolean', 'bool'],
  string: ['text', 'character varying', 'varchar', 'character', 'char'],
  datetime: ['date', 'timestamp', 'timestamp with time zone', 'time', 'time with time zone'],
  json: ['json', 'jsonb'],
  uuid: ['uuid'],
  binary: ['bytea'],
  array: [], // Arrays are detected by [] suffix
};
