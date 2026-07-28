/**
 * Schema Weaver Migration Engine - Migration Planner
 * https://schemaweaver.vivekmind.com/
 *
 * TypeRegistry — resolves PostgreSQL type cast safety.
 * Falls back to hardcoded rules when no matrix is loaded.
 * Use loadFromPool() or loadFromJSON() to use authoritative pg_cast data.
 */
export class TypeRegistry {
  constructor() {
    this.matrix = null;

    this.implicitCasts = new Map([
      ['smallint', new Set(['integer', 'bigint', 'real', 'double precision', 'numeric', 'decimal'])],
      ['integer', new Set(['bigint', 'real', 'double precision', 'numeric', 'decimal'])],
      ['bigint', new Set(['real', 'double precision', 'numeric', 'decimal'])],
      ['real', new Set(['double precision', 'numeric'])],
      ['double precision', new Set(['numeric'])],
      ['numeric', new Set(['numeric'])],
      ['decimal', new Set(['numeric', 'decimal'])],
      ['character varying', new Set(['text', 'character varying'])],
      ['varchar', new Set(['text', 'character varying'])],
      ['character', new Set(['text', 'character varying', 'character'])],
      ['char', new Set(['text', 'character varying', 'character'])],
      ['text', new Set(['character varying'])],
      ['date', new Set(['timestamp', 'timestamptz'])],
      ['timestamp', new Set(['timestamptz'])],
      ['timestamptz', new Set(['timestamptz'])],
      ['time', new Set(['timetz', 'interval'])],
      ['timetz', new Set(['interval'])],
      ['inet', new Set(['cidr'])],
      ['json', new Set(['jsonb'])],
    ]);

    this.impossibleCasts = new Set([
      'text->integer', 'text->bigint', 'text->numeric',
      'integer->boolean', 'boolean->integer',
      'text->date', 'text->timestamp', 'text->uuid',
      'text->json', 'text->jsonb', 'text->boolean',
      'jsonb->json', 'json->jsonb',
    ]);

    this.narrowingCasts = new Map([
      ['bigint', new Set(['integer', 'smallint', 'real', 'double precision'])],
      ['integer', new Set(['smallint'])],
      ['double precision', new Set(['real', 'integer', 'smallint'])],
      ['real', new Set(['integer', 'smallint'])],
      ['numeric', new Set(['integer', 'smallint', 'bigint', 'real', 'double precision'])],
      ['text', new Set(['character varying', 'varchar', 'char', 'character'])],
      ['character varying', new Set(['character', 'char'])],
      ['timestamptz', new Set(['timestamp', 'date'])],
      ['timestamp', new Set(['date'])],
      ['jsonb', new Set(['json'])],
    ]);
  }

  async loadFromPool(pool) {
    const { PgCastMatrix } = await import(
      '../../../sw-migration-engine_tests/destructive-change-warnings/implementation/pg-cast-matrix.js'
    );
    this.matrix = await PgCastMatrix.build(pool);
    return this.matrix;
  }

  async loadFromJSON(data, pgVersion) {
    const { PgCastMatrix } = await import(
      '../../../sw-migration-engine_tests/destructive-change-warnings/implementation/pg-cast-matrix.js'
    );
    this.matrix = PgCastMatrix.fromJSON(data, pgVersion);
    return this.matrix;
  }

  _matrix() {
    return this.matrix;
  }

  canCastImplicitly(from, to) {
    if (this.matrix) return this.matrix.isImplicitCast(from, to);
    return this.implicitCasts.get(from.toLowerCase())?.has(to.toLowerCase()) || false;
  }

  isImpossibleCast(from, to) {
    if (this.matrix) return this.matrix.isImpossibleCast(from, to);
    return this.impossibleCasts.has(`${from.toLowerCase()}->${to.toLowerCase()}`);
  }

  isNarrowingCast(from, to) {
    if (this.matrix) return this.matrix.isNarrowing(from, to);
    const f = from.toLowerCase();
    const t = to.toLowerCase();
    if (f === t) return false;
    if (this.canCastImplicitly(f, t)) return false;
    return this.narrowingCasts.get(f)?.has(t) || false;
  }

  getDataLossRisk(from, to) {
    if (this.matrix) return this.matrix.getDataLossRisk(from, to);
    const f = from.toLowerCase();
    const t = to.toLowerCase();
    if (this.isImpossibleCast(f, t)) return 'critical';
    if (this.isNarrowingCast(f, t)) return 'truncation';
    if (this.requiresUsingClause(f, t)) return 'possible_truncation';
    return 'none';
  }

  requiresUsingClause(from, to) {
    if (this.matrix) return this.matrix.requiresUsingClause(from, to);
    return !this.canCastImplicitly(from, to) && !this.isImpossibleCast(from, to);
  }

  generateUsingClause(from, to, column) {
    if (to.toLowerCase() === 'text' || to.toLowerCase().startsWith('character')) return `${column}::text`;
    if (to.toLowerCase() === 'integer') return `${column}::integer`;
    if (to.toLowerCase() === 'numeric') return `${column}::numeric`;
    if (to.toLowerCase() === 'uuid') return `${column}::uuid`;
    if (to.toLowerCase() === 'timestamptz') return `${column}::timestamptz`;
    return `${column}::${to}`;
  }
}
