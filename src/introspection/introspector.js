/**
 * Schema Weaver Migration Engine - Schema Introspection
 * https://schemaweaver.vivekmind.com/
 */
import { detectPgVersion, majorVersion } from './version-detector.js';
import { translateSnapshot } from './translator.js';
import * as queries from './queries/index.js';

const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'];

export class SchemaIntrospector {
  /**
   * @param {import('pg').Pool} pool
   * @param {Object} [options]
   * @param {number} [options.queryTimeout] - Query timeout in milliseconds (default: 60000)
   */
  constructor(pool, options = {}) {
    this.pool = pool;
    this.logger = console;
    this.queryTimeout = options.queryTimeout || 60000;
  }

  /**
   * Execute a query with timeout
   * @private
   */
  async _queryWithTimeout(sql, params) {
    const config = typeof sql === 'string' 
      ? { text: sql, timeout: this.queryTimeout }
      : { ...sql, timeout: this.queryTimeout };
    if (params) return this.pool.query(config, params);
    return this.pool.query(config);
  }

  /**
   * @param {Object} [options]
   * @param {string[]} [options.schemas] - Specific schemas to introspect (default: all user schemas)
   * @param {number} [options.timeout] - Override default query timeout for this introspection
   * @returns {Promise<import('../types/schema.js').SchemaSnapshot>}
   */
  async introspect(options = {}) {
    const timeout = options.timeout || this.queryTimeout;
    const originalTimeout = this.queryTimeout;
    this.queryTimeout = timeout;
    const version = await detectPgVersion(this.pool);
    const pgMajor = majorVersion(version);
    const versionStr = await this.detectVersionString();

    // Resolve target schemas
    const targetSchemas = options.schemas || await this.resolveUserSchemas();

    // Database-level objects (queried once, not per-schema)
    const [
      roles,
      tablespaces,
      accessMethods,
      databases,
      casts,
      proceduralLanguages,
      defaultPrivileges,
      foreignDataWrappers,
      foreignServers,
      userMappings,
      eventTriggers,
      publications,
      subscriptions,
    ] = await Promise.all([
      queries.queryRoles(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryInterfaceTablespaces(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryInterfaceAccessMethods(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryInterfaceDatabases(this.pool, version).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryCasts(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryProceduralLanguages(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryDefaultPrivileges(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryForeignDataWrappers(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryForeignServers(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryUserMappings(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryEventTriggers(this.pool, version).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryPublications(this.pool, version).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.querySubscriptions(this.pool, version).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
    ]);

    // Per-schema queries (parallelized)
    const [
      schemasResult,
      tables,
      columns,
      constraints,
      indexes,
      indexColumns,
      functions,
      triggers,
      typesResult,
      viewsResult,
      sequences,
      partitions,
      policies,
      extensions,
      inheritance,
      comments,
      grants,
      statistics,
      collations,
      conversions,
      operators,
      operatorClasses,
      operatorFamilies,
      textSearchConfigs,
      textSearchDictionaries,
      textSearchParsers,
      textSearchTemplates,
      foreignTables,
      multiranges,
      rules,
      aggregates,
      procedures,
      toastOptions,
    ] = await Promise.all([
      queries.querySchemas(this.pool).then(r => r.filter(s => targetSchemas.includes(s.name))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryTables(this.pool, version).then(r => r.filter(t => targetSchemas.includes(t.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryColumns(this.pool, version).then(r => r.filter(c => targetSchemas.includes(c.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryConstraints(this.pool, version).then(r => r.filter(c => targetSchemas.includes(c.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryIndexes(this.pool, version).then(r => r.filter(i => targetSchemas.includes(i.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryIndexColumns(this.pool).then(r => r.filter(i => targetSchemas.includes(i.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryFunctions(this.pool).then(r => r.filter(f => targetSchemas.includes(f.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryTriggers(this.pool).then(r => r.filter(t => targetSchemas.includes(t.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryTypes(this.pool).then(r => ({
        enums: (r.enums || []).filter(e => targetSchemas.includes(e.schema)),
        composites: (r.composites || []).filter(c => targetSchemas.includes(c.schema)),
        domains: (r.domains || []).filter(d => targetSchemas.includes(d.schema)),
        ranges: (r.ranges || []).filter(r => targetSchemas.includes(r.schema)),
      })).catch(err => { console.warn('[Introspection] queryTypes failed:', err.message); return { enums: [], composites: [], domains: [], ranges: [] }; }),
      queries.queryViews(this.pool).then(r => ({
        views: (r.views || []).filter(v => targetSchemas.includes(v.schema)),
        materializedViews: (r.materializedViews || []).filter(v => targetSchemas.includes(v.schema))
      })).catch(err => { console.warn('[Introspection] queryViews failed:', err.message); return { views: [], materializedViews: [] }; }),
      queries.querySequences(this.pool).then(r => r.filter(s => targetSchemas.includes(s.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryPartitions(this.pool).then(r => r.filter(p => targetSchemas.includes(p.child_schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryPolicies(this.pool).then(r => r.filter(p => targetSchemas.includes(p.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryExtensions(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryInheritance(this.pool).then(r => r.filter(i => targetSchemas.includes(i.child_schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryComments(this.pool).catch(err => { console.warn('[Introspection] Query failed:', err.message); return {}; }),
      queries.queryGrants(this.pool).then(r => r.filter(g => targetSchemas.includes(g.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryStatistics(this.pool, version).then(r => r.filter(s => targetSchemas.includes(s.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryCollations(this.pool).then(r => r.filter(c => targetSchemas.includes(c.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryConversions(this.pool).then(r => r.filter(c => targetSchemas.includes(c.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryOperators(this.pool).then(r => r.filter(o => targetSchemas.includes(o.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryOperatorClasses(this.pool).then(r => r.filter(o => targetSchemas.includes(o.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryOperatorFamilies(this.pool).then(r => r.filter(o => targetSchemas.includes(o.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryTextSearchConfigs(this.pool).then(r => ({
        configs: (r.configs || []).filter(t => targetSchemas.includes(t.schema)),
        tokenMappings: (r.tokenMappings || []).filter(t => targetSchemas.includes(t.schema)),
      })).catch(err => { console.warn('[Introspection] queryTextSearchConfigs failed:', err.message); return { configs: [], tokenMappings: [] }; }),
      queries.queryTextSearchDictionaries(this.pool).then(r => r.filter(t => targetSchemas.includes(t.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryTextSearchParsers(this.pool).then(r => r.filter(t => targetSchemas.includes(t.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryTextSearchTemplates(this.pool).then(r => r.filter(t => targetSchemas.includes(t.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryForeignTables(this.pool).then(r => ({
        tables: (r.tables || []).filter(f => targetSchemas.includes(f.schema)),
        columnOptions: (r.columnOptions || []).filter(c => targetSchemas.includes(c.schema)),
      })).catch(err => { console.warn('[Introspection] queryForeignTables failed:', err.message); return { tables: [], columnOptions: [] }; }),
      queries.queryMultiranges(this.pool, version).then(r => r.filter(m => targetSchemas.includes(m.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryRules(this.pool).then(r => r.filter(r => targetSchemas.includes(r.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryFunctions(this.pool).then(r => r.filter(f => targetSchemas.includes(f.schema) && f.kind === 'AGGREGATE')).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryFunctions(this.pool).then(r => r.filter(f => targetSchemas.includes(f.schema) && f.kind === 'PROCEDURE')).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
      queries.queryToastOptions(this.pool).then(r => r.filter(t => targetSchemas.includes(t.schema))).catch(err => { console.warn('[Introspection] Query failed:', err.message); return []; }),
    ]);

    // PG18+ features
    let pg18Features = { notEnforced: [], virtualColumns: [] };
    if (pgMajor >= 18) {
      pg18Features = await queries.queryPg18Features(this.pool).catch(err => { console.warn('[Introspection] queryPg18Features failed:', err.message); return { notEnforced: [], virtualColumns: [] }; });
    }

    // Current database info
    let databaseInfo = null;
    try {
      const icuRulesCol = version >= 160000 ? ', daticurules AS icu_rules' : '';
      const dbResult = await this._queryWithTimeout(`
        SELECT 
          current_database() AS name,
          pg_catalog.pg_get_userbyid(datdba) AS owner,
          pg_catalog.pg_encoding_to_char(encoding) AS encoding,
          datcollate AS collate,
          datctype AS ctype
          ${icuRulesCol}
        FROM pg_catalog.pg_database 
        WHERE datname = current_database()
      `);
      databaseInfo = dbResult.rows[0] || null;
    } catch {
      databaseInfo = null;
    }

    this.queryTimeout = originalTimeout;

    // Translate raw results to SchemaSnapshot
    const snapshot = translateSnapshot({
      version: { numeric: version, major: pgMajor, string: versionStr },
      database: databaseInfo,
      schemas: schemasResult,
      tables,
      columns,
      constraints,
      indexes,
      indexColumns,
      functions,
      triggers,
      types: {
        ...typesResult,
        multiranges,
      },
      views: viewsResult.views || [],
      materializedViews: viewsResult.materializedViews || [],
      sequences,
      partitions,
      policies,
      extensions,
      inheritance,
      comments,
      grants,
      pg18Features,
      // New object types
      publications,
      subscriptions,
      statistics,
      collations,
      conversions,
      operators,
      operatorClasses,
      operatorFamilies,
      textSearchConfigs,
      textSearchDictionaries,
      textSearchParsers,
      textSearchTemplates,
      foreignDataWrappers,
      foreignServers,
      userMappings,
      foreignTables,
      casts,
      eventTriggers,
      rules,
      roles,
      tablespaces,
      accessMethods,
      proceduralLanguages,
      defaultPrivileges,
      databases,
      aggregates,
      procedures,
      toastOptions,
    });

    return snapshot;
  }

  /**
   * Resolve user schemas (excluding system schemas).
   * @returns {Promise<string[]>}
   */
  async resolveUserSchemas() {
    const result = await this._queryWithTimeout(`
      SELECT n.nspname AS name
      FROM pg_catalog.pg_namespace n
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND n.nspname NOT LIKE 'pg_temp_%'
        AND n.nspname NOT LIKE 'pg_toast_temp_%'
      ORDER BY n.nspname
    `);
    return result.rows.map(r => r.name);
  }

  /** @returns {Promise<number>} */
  async detectVersion() {
    return detectPgVersion(this.pool);
  }

  /** @returns {Promise<string>} */
  async detectVersionString() {
    const result = await this.pool.query("SELECT current_setting('server_version') AS version");
    return result.rows[0].version;
  }
}
