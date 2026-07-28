/**
 * Schema Weaver Migration Engine - DDL Generator
 * https://schemaweaver.vivekmind.com/
 */
import { generateCreateSql } from './create-generator.js';
import { generateAlterSql } from './alter-generator.js';
import { generateDropSql } from './drop-generator.js';
import { generateRenameSql } from './rename-generator.js';
import { generateCommentSql } from './comment-generator.js';
import { generateGrantSql } from './grant-generator.js';
import { generateSafePatterns } from './safe-patterns.js';

export class DdlGenerator {
  /**
   * @param {import('../types/changes.js').SchemaChange[]} changes
   * @param {import('../types/execution.js').DdlOptions} [options]
   * @returns {string}
   */
  generate(changes, options = {}) {
    const { safeMode = false } = options;
    const statements = [];

    for (const change of changes) {
      if (safeMode) {
        const safeSteps = generateSafePatterns(change);
        if (safeSteps) {
          for (const step of safeSteps) {
            statements.push(`-- ${step.description}`);
            statements.push(step.sql);
          }
          continue;
        }
      }

      let sql = '';
      const changeType = change.changeType;
      const objectType = change.objectType;

      if (change.sql) {
        sql = change.sql;
      } else if (change.ddlStrategy === 'ALTER_TYPE_ADD_VALUE') {
        sql = generateAlterSql(change);
      } else if (change.requiresRecreation || changeType === 'PARTITION_STRUCTURE_CHANGE') {
        const beforeObj = change.before || change.currentValue;
        const afterObj = change.after || change.desiredValue;
        
        const dropSql = generateDropSql({
          changeType: 'DROP',
          objectType: change.objectType,
          objectKey: change.objectKey,
          before: beforeObj
        });
        
        const createSql = generateCreateSql({
          changeType: 'CREATE',
          objectType: change.objectType,
          objectKey: change.objectKey,
          after: afterObj
        });
        
        sql = `${dropSql}\n${createSql}`;
      } else if (changeType === 'CREATE' || changeType.startsWith('ADD')) {
        sql = generateCreateSql(change);
      } else if (changeType === 'ALTER' || changeType.includes('CHANGE') || changeType.includes('CAST')) {
        sql = generateAlterSql(change);
      } else if (changeType === 'DROP' || changeType.startsWith('REMOVE') || changeType.includes('RECREATE')) {
        sql = generateDropSql(change);
      } else if (changeType === 'RENAME') {
        sql = generateRenameSql(change);
      } else if (changeType === 'COMMENT') {
        sql = generateCommentSql(change);
      } else if (changeType === 'GRANT' || changeType === 'REVOKE') {
        sql = generateGrantSql(change);
      }

      if (sql && !sql.startsWith('--')) {
        statements.push(`-- ${changeType} ${objectType} ${change.objectKey}`);
        statements.push(sql);
      }
    }

    return statements.join('\n');
  }
}
