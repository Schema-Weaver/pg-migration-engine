/**
 * Destructive Change Warning System - Executor Warning Prompt
 * Handles [y/N] confirmation prompt or --accept-data-loss flag
 */
export class ExecutorWarningPrompt {
  constructor(options = {}) {
    this.acceptDataLoss = options.acceptDataLoss || false;
    this.force = options.force || false;
    this.dryRun = options.dryRun || false;
    this.interactive = options.interactive !== false;
    this.inputStream = options.inputStream || process.stdin;
    this.outputStream = options.outputStream || process.stdout;
  }

  async resolve(report) {
    if (!report.hasDestructiveChanges) {
      return { proceed: true, reason: 'no_destructive_changes', acknowledged: [] };
    }

    if (this.dryRun) {
      return {
        proceed: true,
        reason: 'dry_run',
        acknowledged: report.warnings,
        message: 'Dry run: warnings shown but not confirmed',
      };
    }

    if (this.acceptDataLoss) {
      return {
        proceed: true,
        reason: 'accept_data_loss_flag',
        acknowledged: report.warnings,
        message: '--accept-data-loss flag set: auto-proceeding with all warnings acknowledged',
      };
    }

    if (this.force) {
      return {
        proceed: true,
        reason: 'force_flag',
        acknowledged: report.warnings,
        message: '--force flag set: auto-proceeding',
      };
    }

    if (!this.interactive) {
      return {
        proceed: false,
        reason: 'non_interactive',
        acknowledged: [],
        message: 'Non-interactive mode and no --accept-data-loss flag. Migration rejected.',
      };
    }

    return this.promptUser(report);
  }

  promptUser(report) {
    return new Promise((resolve) => {
      const promptStr = '\nDo you want to proceed? [y/N] ';

      if (!this.inputStream.isTTY || !this.outputStream.isTTY) {
        this.outputStream.write(promptStr + 'N (non-TTY: defaulting to no)\n');
        resolve({
          proceed: false,
          reason: 'user_cancelled',
          acknowledged: [],
          message: 'Migration cancelled by user (non-TTY input)',
        });
        return;
      }

      this.outputStream.write(promptStr);

      const onData = (data) => {
        this.inputStream.removeListener('data', onData);
        const answer = data.toString().trim().toLowerCase();

        if (answer === 'y' || answer === 'yes') {
          resolve({
            proceed: true,
            reason: 'user_confirmed',
            acknowledged: report.warnings,
            message: 'User confirmed migration with destructive changes',
          });
        } else {
          resolve({
            proceed: false,
            reason: 'user_cancelled',
            acknowledged: [],
            message: 'Migration cancelled by user',
          });
        }
      };

      this.inputStream.on('data', onData);
    });
  }
}
