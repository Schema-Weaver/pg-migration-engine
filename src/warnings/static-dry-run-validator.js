/**
 * Schema Weaver Migration Engine - Static Dry-Run Validator
 * https://schemaweaver.vivekmind.com/
 */

import { isNonTransactionalSQL } from '../executor/migration-executor.js';

const KNOWN_STARTS = new Set([
  'CREATE', 'ALTER', 'DROP', 'COMMENT', 'GRANT', 'REVOKE', 'SET', 'RESET', 'SHOW',
  'DO', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'VACUUM', 'ANALYZE',
  'REINDEX', 'CLUSTER', 'CALL', 'SECURITY', 'REFRESH', 'REASSIGN', 'DISCARD',
  'DECLARE', 'NOTIFY', 'LISTEN', 'UNLISTEN', 'LOCK', 'COPY', 'PREPARE', 'EXECUTE',
  'EXPLAIN', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'END',
  'IMPORT', 'ATTACH', 'DETACH', 'WITH', 'VALUES', 'TABLE', 'CACHE',
]);

const STORAGE_WORDS = new Set(['PLAIN', 'EXTERNAL', 'EXTENDED', 'MAIN']);

function stripLeadingComments(stmt) {
  let s = stmt.replace(/^\s+/, '');
  while (s) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      s = (nl === -1 ? '' : s.slice(nl + 1)).replace(/^\s+/, '');
      continue;
    }
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      if (end === -1) return '';
      s = s.slice(end + 2).replace(/^\s+/, '');
      continue;
    }
    break;
  }
  return s;
}

function firstKeyword(stmt) {
  const s = stripLeadingComments(stmt);
  const m = /^[A-Za-z]+/.exec(s);
  return m ? m[0].toUpperCase() : null;
}

export function analyzeSQL(sql) {
  const warnings = [];
  const statements = [];
  let parenDepth = 0;
  let state = 'normal';
  let buffer = '';
  let error = null;
  let commentOnlyCount = 0;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === 'normal') {
      if (ch === '-' && next === '-') { state = 'line_comment'; buffer += ch + next; i++; continue; }
      if (ch === '/' && next === '*') { state = 'block_comment'; buffer += ch + next; i++; continue; }
      if (ch === "'") { state = 'single_quote'; buffer += ch; continue; }
      if (ch === '"') { state = 'double_quote'; buffer += ch; continue; }
      if (ch === '$') {
        let j = i + 1;
        let tag = '';
        while (j < sql.length && (sql[j] === '_' || /[A-Za-z0-9]/.test(sql[j]))) { tag += sql[j]; j++; }
        if (j < sql.length && sql[j] === '$') {
          const closeTag = `$${tag}$`;
          const close = sql.indexOf(closeTag, j + 1);
          if (close === -1) {
            error = 'has an unterminated dollar-quoted string';
            buffer += sql.slice(i);
            i = sql.length;
            continue;
          }
          buffer += sql.slice(i, close + closeTag.length);
          i = close + closeTag.length - 1;
          continue;
        }
      }
      if (ch === '(') { parenDepth++; buffer += ch; continue; }
      if (ch === ')') { parenDepth--; buffer += ch; continue; }
      if (ch === ';') {
        const stmt = buffer.trim();
        buffer = '';
        if (stmt) statements.push(stmt);
        continue;
      }
      buffer += ch;
      continue;
    }

    buffer += ch;
    if (state === 'single_quote') {
      if (ch === "'") {
        if (next === "'") { buffer += next; i++; }
        else state = 'normal';
      }
    } else if (state === 'double_quote') {
      if (ch === '"') {
        if (next === '"') { buffer += next; i++; }
        else state = 'normal';
      }
    } else if (state === 'line_comment') {
      if (ch === '\n') state = 'normal';
    } else if (state === 'block_comment') {
      if (ch === '*' && next === '/') { state = 'normal'; buffer += next; i++; }
    }
  }

  if (buffer.trim()) statements.push(buffer.trim());

  if (state === 'single_quote') {
    if (!error) error = 'has an unterminated single-quoted string';
  } else if (state === 'double_quote') {
    if (!error) error = 'has an unterminated double-quoted identifier';
  } else if (state === 'block_comment') {
    if (!error) error = 'has an unterminated block comment';
  } else if (state === 'dollar_quote') {
    if (!error) error = 'has an unterminated dollar-quoted string';
  } else if (parenDepth !== 0) {
    if (!error) error = `has ${Math.abs(parenDepth)} unbalanced parenthesis`;
  }

  for (const stmt of statements) {
    const stripped = stripLeadingComments(stmt);
    if (!stripped) {
      commentOnlyCount++;
      continue;
    }
    const keyword = firstKeyword(stmt);
    if (keyword && !KNOWN_STARTS.has(keyword)) {
      warnings.push({
        code: 'STEP_UNKNOWN_START',
        message: `Statement does not start with a known SQL command (got "${keyword}")`,
        severity: 'low',
      });
    }
    const storageMatch = /\bSET\s+STORAGE\s+([A-Za-z])\s*$/im.exec(stmt);
    if (storageMatch && !STORAGE_WORDS.has(storageMatch[1].toUpperCase())) {
      warnings.push({
        code: 'SET_STORAGE_CODE',
        message: `SET STORAGE uses single-letter storage code "${storageMatch[1]}"; must be PLAIN, EXTERNAL, EXTENDED or MAIN`,
        severity: 'high',
      });
    }
  }

  return { statements, error, warnings, commentOnlyCount };
}

export class StaticDryRunValidator {
  constructor(plan, options = {}) {
    this.plan = plan || {};
    this.options = options || {};
  }

  validate() {
    const steps = this.plan.steps;
    const warnings = [];
    const errors = [];

    if (!Array.isArray(steps)) {
      return {
        valid: false,
        stepCount: 0,
        errors: [{ code: 'PLAN_NO_STEPS', message: 'Plan has no steps array' }],
        warnings: [],
      };
    }

    const seen = new Set();
    for (const step of steps) {
      const id = step && step.id;
      if (!id) {
        errors.push({ code: 'STEP_NO_ID', message: 'A plan step is missing an id', step: '(unknown)' });
      } else {
        if (seen.has(id)) {
          errors.push({ code: 'STEP_DUP_ID', message: `Duplicate step id "${id}"`, step: id });
        }
        seen.add(id);
      }

      if (!step || step.phase === undefined || step.phase === null) {
        errors.push({ code: 'STEP_NO_PHASE', message: `Step "${id}" is missing a phase number`, step: id });
      }

      const sql = step && step.sql != null ? String(step.sql) : '';
      if (!sql || sql.trim() === '') {
        warnings.push({
          code: 'STEP_EMPTY_SQL',
          message: `Step "${id}" has no SQL; nothing will execute for it`,
          step: id,
          severity: 'medium',
        });
        continue;
      }

      const analysis = analyzeSQL(sql);
      if (analysis.statements.length === 0 ||
          (analysis.commentOnlyCount === analysis.statements.length)) {
        warnings.push({
          code: 'STEP_COMMENT_ONLY',
          message: `Step "${id}" contains only comments; nothing will execute for it`,
          step: id,
          severity: 'medium',
        });
      }
      if (analysis.error) {
        errors.push({ code: 'STEP_SQL_SYNTAX', message: `Step "${id}" ${analysis.error}`, step: id });
      }
      for (const w of analysis.warnings) {
        warnings.push({ ...w, step: id });
      }

      if (isNonTransactionalSQL(sql, step)) {
        warnings.push({
          code: 'STEP_NON_TRANSACTIONAL',
          message: `Step "${id}" is non-transactional and cannot be rolled back if the real migration fails`,
          step: id,
          severity: 'high',
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings, stepCount: steps.length };
  }
}
