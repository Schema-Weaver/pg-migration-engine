/**
 * Schema Weaver Migration Engine - Migration Executor
 * https://schemaweaver.vivekmind.com/
 */

import { LockAcquisitionError } from '../errors.js';

export class TransactionManager {
  /**
   * @param {import('pg').Pool} pool
   */
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Execute steps in a transaction
   * @param {Array} steps - Steps to execute
   * @param {Object} options - { lockTimeout, statementTimeout, dryRun, continueOnError, lockKey, lockMode }
   * @returns {Promise<Array>} Results of each step
   */
  async executeTransactional(steps, options = {}) {
    const client = await this.pool.connect();
    const results = [];

    try {
      await client.query('BEGIN');

      if (options.lockTimeout) {
        await client.query(`SET LOCAL lock_timeout = '${options.lockTimeout}'`);
      }
      if (options.lockStatementTimeout || options.statementTimeout) {
        // Bounds the advisory-lock query itself; reset to the DDL
        // statementTimeout once the lock is held.
        await client.query(`SET LOCAL statement_timeout = '${options.lockStatementTimeout || options.statementTimeout}'`);
      }

      await client.query(`SET LOCAL search_path = 'public'`);

      // Transaction-scoped advisory lock (auto-releases on COMMIT/ROLLBACK).
      // Respects the lock_timeout set above (55P03 on timeout in blocking mode).
      if (options.lockKey) {
        const lockMode = options.lockMode || 'blocking';
        if (lockMode === 'try') {
          const lockResult = await client.query(
            'SELECT pg_try_advisory_xact_lock($1) AS acquired',
            [options.lockKey]
          );
          if (!lockResult.rows[0].acquired) {
            throw new LockAcquisitionError(
              `Transaction-scoped advisory lock ${options.lockKey} could not be acquired (try mode). ` +
              `Another transaction may be modifying this database concurrently.`,
              { lockKey: options.lockKey }
            );
          }
        } else {
          await client.query('SELECT pg_advisory_xact_lock($1)', [options.lockKey]);
        }
      }

      if (options.statementTimeout) {
        await client.query(`SET LOCAL statement_timeout = '${options.statementTimeout}'`);
      }

      for (const step of steps) {
        const startTime = Date.now();
        try {
          const result = await client.query(step.sql);
          results.push({
            stepId: step.id,
            success: true,
            duration: Date.now() - startTime,
            rowCount: result.rowCount,
            rows: result.rows,
          });
        } catch (error) {
          results.push({
            stepId: step.id,
            success: false,
            duration: Date.now() - startTime,
            error: error.message,
            code: error.code,
          });

          if (!options.continueOnError) {
            throw error;
          }
        }
      }

      if (options.dryRun) {
        await client.query('ROLLBACK');
      } else {
        await client.query('COMMIT');
      }

      return results;

    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a single non-transactional step
   * @param {Object} step - The step to execute
   * @param {Object} options - { statementTimeout }
   * @returns {Promise<Object>}
   */
  async executeNonTransactional(step, options = {}) {
    const client = await this.pool.connect();

    try {
      if (options.statementTimeout) {
        await client.query(`SET statement_timeout = '${options.statementTimeout}'`);
      }

      const startTime = Date.now();
      const result = await client.query(step.sql);

      return {
        stepId: step.id,
        success: true,
        duration: Date.now() - startTime,
        rowCount: result.rowCount,
        isTransactional: false,
        warning: 'This step was executed outside a transaction and cannot be automatically rolled back',
      };

    } catch (error) {
      return {
        stepId: step.id,
        success: false,
        error: error.message,
        code: error.code,
        isTransactional: false,
        requiresManualRecovery: true,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Execute steps with validation first, then for real
   * @param {Array} steps
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async executeWithValidation(steps, options = {}) {
    const validationResult = await this.executeTransactional(steps, {
      ...options,
      dryRun: true,
    });

    const hasErrors = validationResult.some(r => !r.success);
    if (hasErrors) {
      return {
        validated: false,
        validationResults: validationResult,
        message: 'Validation failed. Migration not applied.',
      };
    }

    if (!options.dryRun) {
      const executionResult = await this.executeTransactional(steps, {
        ...options,
        dryRun: false,
      });
      return {
        validated: true,
        executionResults: executionResult,
      };
    }

    return {
      validated: true,
      validationResults: validationResult,
      message: 'Validation passed (dry run). No changes applied.',
    };
  }

  /**
   * Execute with savepoint support for partial rollback
   * @param {Array} steps
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async executeWithSavepoints(steps, options = {}) {
    const client = await this.pool.connect();
    const results = [];
    let lastSuccessfulSavepoint = 0;

    try {
      await client.query('BEGIN');

      if (options.lockTimeout) {
        await client.query(`SET LOCAL lock_timeout = '${options.lockTimeout}'`);
      }
      if (options.statementTimeout) {
        await client.query(`SET LOCAL statement_timeout = '${options.statementTimeout}'`);
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const savepointName = `sp_${i}`;

        await client.query(`SAVEPOINT ${savepointName}`);

        const startTime = Date.now();
        try {
          const result = await client.query(step.sql);
          results.push({
            stepId: step.id,
            success: true,
            duration: Date.now() - startTime,
            rowCount: result.rowCount,
            savepoint: savepointName,
          });
          lastSuccessfulSavepoint = i;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);

          results.push({
            stepId: step.id,
            success: false,
            duration: Date.now() - startTime,
            error: error.message,
            code: error.code,
            savepoint: savepointName,
          });

          if (!options.continueOnError) {
            throw error;
          }
        }
      }

      if (options.dryRun) {
        await client.query('ROLLBACK');
      } else {
        await client.query('COMMIT');
      }

      return {
        success: true,
        results,
        lastSuccessfulSavepoint,
      };

    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return {
        success: false,
        results,
        lastSuccessfulSavepoint,
        error: error.message,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Execute with retry on deadlock
   * @param {Array} steps
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async executeWithRetry(steps, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 1000;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeTransactional(steps, options);
        return {
          success: true,
          results: result,
          attempts: attempt,
        };
      } catch (error) {
        lastError = error;

        const isDeadlock = error.code === '40P01';
        const isLockNotAvailable = error.code === '55P03';
        const isSerializationFailure = error.code === '40001';

        if (!isDeadlock && !isLockNotAvailable && !isSerializationFailure) {
          throw error;
        }

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message,
      attempts: maxRetries,
    };
  }

  /**
   * Dry run a single step
   * @param {Object} step
   * @returns {Promise<Object>}
   */
  async dryRun(step) {
    return this.executeTransactional([step], { dryRun: true });
  }
}
