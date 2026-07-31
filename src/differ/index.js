/**
 * Schema Weaver Migration Engine - Schema Differ
 * https://schemaweaver.vivekmind.com/
 */
export {
  SchemaDiffer,
  ObjectMatcher,
  PropertyDiffer,
  DependencyResolver,
  ChangeClassifier,
  RiskTagger,
} from './schema-differ.js';

export { levenshtein, similarity } from './utils/levenshtein.js';
export { buildPath } from './utils/path-builder.js';
export { getCastInfo } from './utils/type-compatibility.js';
export { ReverseDependencyIntrospector, DEP_TYPES } from './reverse-dependency-introspector.js';
