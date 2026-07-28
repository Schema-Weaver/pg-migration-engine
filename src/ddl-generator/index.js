/**
 * Schema Weaver Migration Engine - DDL Generator
 * https://schemaweaver.vivekmind.com/
 */
export { DdlGenerator } from './statement-factory.js';
export { generateSafePatterns } from './safe-patterns.js';
export { supportsPg18Features, supportsPg15Features } from './pg-version.js';
