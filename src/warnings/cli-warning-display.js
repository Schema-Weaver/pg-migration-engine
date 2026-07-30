/**
 * Destructive Change Warning System - CLI Warning Display
 * Terminal output formatting (colors, borders, icons)
 */
export class CliWarningDisplay {
  constructor(outputStream = process.stdout) {
    this.outputStream = outputStream;
    this.useColors = this._detectColorSupport();
  }

  _detectColorSupport() {
    if (!this.outputStream.isTTY) return false;
    const term = process.env.TERM || '';
    return term !== 'dumb' && term !== '';
  }

  displayReport(report, options = {}) {
    const formatted = this.formatReport(report, options);
    this.outputStream.write(formatted + '\n');
  }

  formatReport(report, options = {}) {
    const lines = [];
    const divider = '━'.repeat(71);
    lines.push('');
    lines.push(divider);

    let stepNum = 1;
    for (const op of report.allOperations) {
      const icon = this._getLevelIcon(op.level);
      const description = this._truncate(op.description || op.operation || op.sql?.split('\n')[0] || '', 55);
      const target = this._truncate(op.target || op.objectName || '?', 35);
      lines.push(`  ${this._padStep(stepNum)}. ${icon} ${description.padEnd(57)} → ${target}`);
      stepNum++;
    }

    lines.push(divider);
    lines.push('');

    if (!report.hasDestructiveChanges) {
      lines.push(this._color('green', '  ✅ All operations are safe — no data loss risk.'));
      lines.push('     Proceeding with migration...');
      lines.push('');
      lines.push(divider);
      return lines.join('\n');
    }

    const dataLoss = report.warnings.filter(w => w.level === 'data_loss');
    const dataRisk = report.warnings.filter(w => w.level === 'data_risk');
    const objDest = report.warnings.filter(w => w.level === 'object_destruction');

    lines.push(this._color('yellow', `  ⚠  DESTRUCTIVE CHANGES DETECTED (${dataLoss.length} data-loss, ${dataRisk.length} data-risk, ${objDest.length} object-removal)`));
    lines.push('');

    for (const w of dataLoss) {
      lines.push(this._color('red', `  🔴 ${w.operation} "${w.objectName}" on ${w.target}`));
      if (w.affectedRows !== null) {
        lines.push(this._color('red', `     → ${this._fmtNum(w.affectedRows)} rows will be PERMANENTLY DELETED`));
      } else {
        lines.push(this._color('red', `     → Data will be PERMANENTLY DELETED`));
      }
      lines.push(this._color('yellow', `     → This operation CANNOT be reversed.`));
      if (w.verification?.message) {
        lines.push(this._color('yellow', `     → ${w.verification.message}`));
      }
      if (w.samples) {
        const sampleStr = this._formatSamples(w);
        if (sampleStr) lines.push(sampleStr);
      }
      lines.push('');
    }

    for (const w of dataRisk) {
      lines.push(this._color('yellow', `  🟡 ${w.operation} "${w.objectName}" on ${w.target}`));
      if (w.affectedRows !== null && w.affectedRows > 0) {
        lines.push(this._color('yellow', `     → ${this._fmtNum(w.affectedRows)} existing rows VIOLATE this constraint`));
      }
      if (w.samples) {
        const sampleStr = this._formatSamples(w);
        if (sampleStr) lines.push(sampleStr);
      }
      lines.push(this._color('yellow', `     → Migration may FAIL unless data is corrected first`));
      lines.push('');
    }

    for (const w of objDest) {
      lines.push(this._color('cyan', `  ⚠ ${w.operation} "${w.objectName}" on ${w.target}`));
      lines.push(this._color('cyan', `     → ${w.message}`));
      lines.push('');
    }

    const safeOps = report.warnings.filter(w => w.level === 'safe');
    if (safeOps.length > 0) {
      const names = safeOps.map(s => `${s.operation} "${s.objectName}"`).join(', ');
      lines.push(this._color('green', `  ✅ Safe operations: ${names}`));
      lines.push('     → No data impact, proceeding automatically');
      lines.push('');
    }

    lines.push(divider);
    return lines.join('\n');
  }

  formatAutoProceed(report) {
    const lines = [];
    lines.push('');
    lines.push(this._color('yellow', `  ⚠  DESTRUCTIVE CHANGES DETECTED — auto-proceeding (--accept-data-loss flag set)`));
    for (const w of report.warnings) {
      if (w.level === 'data_loss') {
        lines.push(this._color('red', `  🔴 ${w.operation} "${w.objectName}": ${w.affectedRows !== null ? this._fmtNum(w.affectedRows) + ' rows lost' : 'data loss'}`));
      } else if (w.level === 'data_risk') {
        lines.push(this._color('yellow', `  🟡 ${w.operation} "${w.objectName}": possible data issues`));
      } else if (w.level === 'object_destruction') {
        lines.push(this._color('cyan', `  ⚠ ${w.operation} "${w.objectName}": object removed`));
      }
    }
    lines.push('');
    lines.push('   Proceeding with migration...');
    return lines.join('\n');
  }

  formatCancelled() {
    return this._color('red', `  ❌ Migration cancelled by user.\n     No changes have been applied to the database.\n     Fix the schema definition and re-run, or use --accept-data-loss to skip this prompt.`);
  }

  _getLevelIcon(level) {
    switch (level) {
      case 'data_loss': return this._color('red', '🔴');
      case 'data_risk': return this._color('yellow', '🟡');
      case 'object_destruction': return this._color('cyan', '⚠');
      case 'safe': return this._color('green', '✅');
      default: return '  ';
    }
  }

  _fmtNum(num) {
    if (num === null || num === undefined) return '?';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  _truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str || '';
    return str.substring(0, maxLen - 3) + '...';
  }

  _padStep(num) {
    return String(num).padStart(3);
  }

  _formatSamples(warning) {
    if (!warning.samples || !warning.samples.rows || warning.samples.rows.length === 0) return null;
    const lines = [];
    const rows = warning.samples.rows;
    const columns = warning.samples.columns || Object.keys(rows[0]);
    lines.push(this._color('magenta', `     → Sample data (${rows.length} of ${this._fmtNum(warning.affectedRows)} affected rows):`));
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

  _color(color, text) {
    if (!this.useColors) return text;
    const codes = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', magenta: '\x1b[35m', bold: '\x1b[1m', reset: '\x1b[0m' };
    return `${codes[color] || ''}${text}${codes.reset}`;
  }
}
