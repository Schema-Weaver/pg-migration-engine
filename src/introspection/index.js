/**
 * Schema Weaver Migration Engine - Schema Introspection
 * https://schemaweaver.vivekmind.com/
 */
export { SchemaIntrospector } from './introspector.js';
export { translateSnapshot, normalizeSchema } from './translator.js';
export { detectPgVersion, majorVersion } from './version-detector.js';
export * as queries from './queries/index.js';
