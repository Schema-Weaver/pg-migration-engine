/**
 * Destructive Change Warning System - Data Impact Analyzer
 * Runs data impact queries against the database to count affected rows,
 * then samples actual values that would be affected.
 */
import { DataSampler } from './data-sampler.js';

export class DataImpactAnalyzer {
  constructor(pool) {
    this.pool = pool;
    this.sampler = new DataSampler(pool);
  }

  async analyze(change, dataImpactQuery, classification) {
    if (!dataImpactQuery) {
      return { affectedRows: null, hasDataRisk: false, details: null, query: null };
    }
    try {
      const result = await this.pool.query(dataImpactQuery);
      const parsed = this.parseResult(change, result);
      if (parsed.affectedRows > 0 && parsed.hasDataRisk) {
        parsed.samples = await this.sampler.sample(change, classification);
      }
      return parsed;
    } catch (error) {
      return {
        affectedRows: null,
        hasDataRisk: true,
        error: error.message,
        details: 'Could not query data impact. Permission issue or table does not exist.',
        query: dataImpactQuery,
      };
    }
  }

  parseResult(change, result) {
    const row = result.rows[0] || {};
    const keys = Object.keys(row);

    if (keys.length === 0) {
      return { affectedRows: 0, hasDataRisk: false, details: 'No data found', query: result.query };
    }

    const firstKey = keys[0];
    const count = parseInt(row[firstKey], 10) || 0;

    const details = {};
    for (const key of keys) {
      details[key] = row[key];
    }

    const hasDataRisk = count > 0;

    return {
      affectedRows: count,
      hasDataRisk,
      details,
      query: result.query,
    };
  }

  async analyzeBatch(changes) {
    const results = [];
    for (const item of changes) {
      const result = await this.analyze(item.change, item.query, item.classification);
      results.push({ change: item.change, query: item.query, result });
    }
    return results;
  }

  async verifyTypeNarrowing(change, info) {
    if (!info || !info.query) return null;
    try {
      const result = await this.pool.query(info.query);
      const row = result.rows[0] || {};

      if ('max_val' in row) {
        const maxVal = row.max_val;
        const toType = (change.desiredValue || change.after?.dataType || '').toUpperCase();
        const limits = { SMALLINT: 32767, INTEGER: 2147483647, INT: 2147483647, INT4: 2147483647 };
        for (const [typeName, limit] of Object.entries(limits)) {
          if (toType.includes(typeName)) {
            return {
              currentMax: maxVal,
              newTypeLimit: limit,
              willOverflow: maxVal > limit,
              message: maxVal > limit
                ? `Current max ${maxVal} exceeds ${typeName} limit ${limit}`
                : `Current max ${maxVal} fits within ${typeName} limit ${limit}`,
            };
          }
        }
      }

      if ('max_length' in row) {
        const maxLen = row.max_length;
        const toMatch = toType.match(/VARCHAR\s*\((\d+)\)/i);
        if (toMatch) {
          const limit = parseInt(toMatch[1], 10);
          return {
            currentMax: maxLen,
            newTypeLimit: limit,
            willOverflow: maxLen > limit,
            message: maxLen > limit
              ? `Current max length ${maxLen} exceeds new limit ${limit}`
              : `Current max length ${maxLen} within new limit ${limit}`,
          };
        }
      }

      if ('affected' in row) {
        return {
          affectedRows: parseInt(row.affected, 10) || 0,
          message: `${row.affected} rows affected by type change`,
          willOverflow: (parseInt(row.affected, 10) || 0) > 0,
        };
      }

      return { willOverflow: false, message: 'Type change verified', currentMax: null };
    } catch (error) {
      return { error: error.message, willOverflow: true, message: `Could not verify: ${error.message}` };
    }
  }
}
