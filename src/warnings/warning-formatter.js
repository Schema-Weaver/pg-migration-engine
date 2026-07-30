/**
 * Destructive Change Warning System - Warning Formatter
 * Formats warnings into structured output
 */
export class WarningFormatter {
  formatReport(report) {
    const lines = [];
    lines.push('━━━ Migration Plan ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    let stepNum = 1;
    for (const op of report.allOperations) {
      const icon = this.getLevelIcon(op.level);
      const action = this.truncate(op.description || op.sql || '', 60);
      lines.push(`  Step ${stepNum}. ${icon} ${action.padEnd(62)} → ${op.target || op.objectName || '?'}`);
      stepNum++;
    }
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    if (!report.hasDestructiveChanges) {
      lines.push('✅ All operations are safe — no data loss risk.');
      lines.push('   Proceeding with migration...');
      return lines.join('\n');
    }

    const dataLossOps = report.warnings.filter(w => w.level === 'data_loss');
    const dataRiskOps = report.warnings.filter(w => w.level === 'data_risk');
    const objectDestOps = report.warnings.filter(w => w.level === 'object_destruction');
    const safeOps = report.warnings.filter(w => w.level === 'safe');

    lines.push(`⚠  DESTRUCTIVE CHANGES DETECTED (${dataLossOps.length} data-loss, ${dataRiskOps.length} data-risk, ${objectDestOps.length} object-removal)`);
    lines.push('');

    for (const w of dataLossOps) {
      lines.push(`  🔴 ${w.operation} "${w.objectName}" on ${w.target}`);
      if (w.affectedRows !== null) {
        lines.push(`     → ${this.formatNumber(w.affectedRows)} rows will be PERMANENTLY DELETED`);
      }
      lines.push(`     → This operation CANNOT be reversed. Rollback will not restore the data.`);
      if (w.dataImpactQuery) {
        lines.push(`     → Data impact query: ${w.dataImpactQuery}`);
      }
      if (w.verification) {
        lines.push(`     → ${w.verification.message}`);
      }
      lines.push('');
    }

    for (const w of dataRiskOps) {
      lines.push(`  🟡 ${w.operation} "${w.objectName}" on ${w.target}`);
      if (w.affectedRows !== null && w.affectedRows > 0) {
        lines.push(`     → ${this.formatNumber(w.affectedRows)} existing rows will cause issues`);
      }
      lines.push(`     → Migration may FAIL unless data is corrected first`);
      if (w.dataImpactQuery) {
        lines.push(`     → Data impact query: ${w.dataImpactQuery}`);
      }
      lines.push('');
    }

    for (const w of objectDestOps) {
      lines.push(`  ⚠ ${w.operation} "${w.objectName}" on ${w.target}`);
      lines.push(`     → ${w.message}`);
      lines.push('');
    }

    if (safeOps.length > 0) {
      const safeNames = safeOps.map(s => `${s.operation} "${s.objectName}"`).join(', ');
      lines.push(`  ✅ Safe operations: ${safeNames}`);
      lines.push(`     → No data impact, proceeding automatically`);
      lines.push('');
    }

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return lines.join('\n');
  }

  formatShortSummary(report) {
    if (!report.hasDestructiveChanges) {
      return '✅ All operations safe — no warnings.';
    }
    const dataLoss = report.warnings.filter(w => w.level === 'data_loss').length;
    const dataRisk = report.warnings.filter(w => w.level === 'data_risk').length;
    const objDest = report.warnings.filter(w => w.level === 'object_destruction').length;
    const safe = report.warnings.filter(w => w.level === 'safe').length;
    return `⚠ ${dataLoss} data-loss, ${dataRisk} data-risk, ${objDest} object-removal, ${safe} safe`;
  }

  formatAutoProceed(report) {
    if (!report.hasDestructiveChanges) return '✅ All operations safe — no warnings. Proceeding...';
    const lines = [];
    lines.push('⚠  DESTRUCTIVE CHANGES DETECTED — auto-proceeding (--accept-data-loss flag set)');
    for (const w of report.warnings) {
      if (w.level === 'data_loss') {
        lines.push(`  🔴 ${w.operation} "${w.objectName}": ${w.affectedRows !== null ? this.formatNumber(w.affectedRows) + ' rows lost' : 'data loss'}`);
      } else if (w.level === 'data_risk') {
        lines.push(`  🟡 ${w.operation} "${w.objectName}": ${w.affectedRows !== null ? this.formatNumber(w.affectedRows) + ' affected rows' : 'possible issues'}`);
      } else if (w.level === 'object_destruction') {
        lines.push(`  ⚠ ${w.operation} "${w.objectName}": object will be removed`);
      }
    }
    lines.push('');
    lines.push('   Proceeding with migration...');
    return lines.join('\n');
  }

  formatCancelMessage() {
    return '❌ Migration cancelled by user.\n   No changes have been applied to the database.\n   Fix the schema definition and re-run, or use --accept-data-loss to skip this prompt.';
  }

  getLevelIcon(level) {
    switch (level) {
      case 'data_loss': return '🔴';
      case 'data_risk': return '🟡';
      case 'object_destruction': return '⚠';
      case 'safe': return '✅';
      default: return '  ';
    }
  }

  formatNumber(num) {
    if (num === null || num === undefined) return '?';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str || '';
    return str.substring(0, maxLen - 3) + '...';
  }

  formatSamples(warning) {
    if (!warning.samples || !warning.samples.rows || warning.samples.rows.length === 0) return null;
    const lines = [];
    const rows = warning.samples.rows;
    const columns = warning.samples.columns || Object.keys(rows[0]);
    lines.push(`     → Sample data (${rows.length} of ${warning.affectedRows} affected rows):`);
    for (const row of rows) {
      const vals = columns.map(c => {
        const v = row[c];
        if (v === null) return 'NULL';
        const s = String(v);
        return s.length > 40 ? s.substring(0, 37) + '...' : s;
      }).join(', ');
      lines.push(`       • [${vals}]`);
    }
    if (warning.samples.truncated) {
      lines.push(`       ... (truncated, showing first ${rows.length})`);
    }
    return lines.join('\n');
  }

  formatReport(report) {
    const lines = [];
    lines.push('━━━ Migration Plan ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    let stepNum = 1;
    for (const op of report.allOperations) {
      const icon = this.getLevelIcon(op.level);
      const action = this.truncate(op.description || op.sql || '', 60);
      lines.push(`  Step ${stepNum}. ${icon} ${action.padEnd(62)} → ${op.target || op.objectName || '?'}`);
      stepNum++;
    }
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');

    if (!report.hasDestructiveChanges) {
      lines.push('All operations are safe — no data loss risk.');
      lines.push('   Proceeding with migration...');
      return lines.join('\n');
    }

    const dataLossOps = report.warnings.filter(w => w.level === 'data_loss');
    const dataRiskOps = report.warnings.filter(w => w.level === 'data_risk');
    const objectDestOps = report.warnings.filter(w => w.level === 'object_destruction');
    const safeOps = report.allOperations.filter(o => o.level === 'safe');

    lines.push(`WARNING: ${dataLossOps.length} data-loss, ${dataRiskOps.length} data-risk, ${objectDestOps.length} object-removal`);
    lines.push('');

    for (const w of dataLossOps) {
      lines.push(`  [DATA LOSS] ${w.operation} "${w.objectName}" on ${w.target}`);
      if (w.affectedRows !== null) {
        lines.push(`     -> ${this.formatNumber(w.affectedRows)} rows PERMANENTLY DELETED`);
      }
      if (w.samples) {
        const sampleStr = this.formatSamples(w);
        if (sampleStr) lines.push(sampleStr);
      }
      if (w.verification) {
        lines.push(`     -> ${w.verification.message}`);
      }
      lines.push('');
    }

    for (const w of dataRiskOps) {
      lines.push(`  [DATA RISK] ${w.operation} "${w.objectName}" on ${w.target}`);
      if (w.affectedRows !== null && w.affectedRows > 0) {
        lines.push(`     -> ${this.formatNumber(w.affectedRows)} existing rows will cause issues`);
      }
      if (w.samples) {
        const sampleStr = this.formatSamples(w);
        if (sampleStr) lines.push(sampleStr);
      }
      lines.push('');
    }

    for (const w of objectDestOps) {
      lines.push(`  [OBJECT REMOVAL] ${w.operation} "${w.objectName}" on ${w.target}`);
      lines.push(`     -> ${w.message}`);
      lines.push('');
    }

    if (safeOps.length > 0) {
      const safeNames = safeOps.map(s => `${s.operation} "${s.objectName}"`).join(', ');
      lines.push(`  Safe operations: ${safeNames}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  formatShortSummary(report) {
    if (!report.hasDestructiveChanges) {
      return 'All operations safe -- no warnings.';
    }
    const dataLoss = report.warnings.filter(w => w.level === 'data_loss').length;
    const dataRisk = report.warnings.filter(w => w.level === 'data_risk').length;
    const objDest = report.warnings.filter(w => w.level === 'object_destruction').length;
    const safe = report.warnings.filter(w => w.level === 'safe').length;
    return `${dataLoss} data-loss, ${dataRisk} data-risk, ${objDest} object-removal, ${safe} safe`;
  }

  formatAutoProceed(report) {
    if (!report.hasDestructiveChanges) return 'All operations safe -- no warnings. Proceeding...';
    const lines = [];
    lines.push('DESTRUCTIVE CHANGES DETECTED -- auto-proceeding (--accept-data-loss flag set)');
    for (const w of report.warnings) {
      if (w.level === 'data_loss') {
        lines.push(`  [DATA LOSS] ${w.operation} "${w.objectName}": ${w.affectedRows !== null ? this.formatNumber(w.affectedRows) + ' rows lost' : 'data loss'}`);
      } else if (w.level === 'data_risk') {
        lines.push(`  [DATA RISK] ${w.operation} "${w.objectName}": ${w.affectedRows !== null ? this.formatNumber(w.affectedRows) + ' affected rows' : 'possible issues'}`);
      } else if (w.level === 'object_destruction') {
        lines.push(`  [OBJECT REMOVAL] ${w.operation} "${w.objectName}": object will be removed`);
      }
      if (w.samples) {
        const sampleStr = this.formatSamples(w);
        if (sampleStr) lines.push(`  ${sampleStr.replace(/\n/g, '\n  ')}`);
      }
    }
    lines.push('');
    lines.push('   Proceeding with migration...');
    return lines.join('\n');
  }

  formatCancelMessage() {
    return 'Migration cancelled by user.\n   No changes have been applied to the database.\n   Fix the schema definition and re-run, or use --accept-data-loss to skip this prompt.';
  }

  getLevelIcon(level) {
    switch (level) {
      case 'data_loss': return '[!]';
      case 'data_risk': return '[?]';
      case 'object_destruction': return '[*]';
      case 'safe': return '[+]';
      default: return '[ ]';
    }
  }

  formatNumber(num) {
    if (num === null || num === undefined) return '?';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str || '';
    return str.substring(0, maxLen - 3) + '...';
  }

  formatWarningForHistory(warning) {
    return {
      level: warning.level,
      operation: warning.operation,
      objectType: warning.objectType,
      objectName: warning.objectName,
      target: warning.target,
      affectedRows: warning.affectedRows,
      message: warning.message,
      samples: warning.samples || null,
    };
  }
}
