/**
 * Schema Weaver Migration Engine - Core
 * https://schemaweaver.vivekmind.com/
 */

export class MigrationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MigrationError';
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

export class IntrospectionError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'IntrospectionError';
  }
}

export class DiffError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'DiffError';
  }
}

export class DDLGenerationError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'DDLGenerationError';
  }
}

export class ExecutionError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'ExecutionError';
    this.stepId = details?.step?.id;
    this.phase = details?.phase?.name;
    this.sql = details?.step?.sql;
    this.cause = details?.cause;
  }
}

export class PreCheckFailedError extends ExecutionError {
  constructor(message, details) {
    super(message, details);
    this.name = 'PreCheckFailedError';
  }
}

export class PostCheckFailedError extends ExecutionError {
  constructor(message, details) {
    super(message, details);
    this.name = 'PostCheckFailedError';
  }
}

export class MigrationConflictError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'MigrationConflictError';
    this.code = details?.code || 'CONCURRENT_MIGRATION';
  }
}

export class VersionIncompatibilityError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'VersionIncompatibilityError';
    this.requiredVersion = details?.requiredVersion;
    this.currentVersion = details?.currentVersion;
  }
}

export class RollbackError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'RollbackError';
  }
}

export class DriftDetectedError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'DriftDetectedError';
    this.driftDetails = details?.drift;
  }
}

export class LockAcquisitionError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'LockAcquisitionError';
  }
}

export class TimeoutError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'TimeoutError';
    this.timeout = details?.timeout;
  }
}

export class ValidationError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'ValidationError';
    this.validationErrors = details?.errors || [];
  }
}

export class StorageError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'StorageError';
  }
}

export class PlanBlockedError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'PlanBlockedError';
    this.blockReason = details?.blockReason;
    this.riskAssessment = details?.riskAssessment;
  }
}

export class RecoveryError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'RecoveryError';
    this.recoverySteps = details?.recoverySteps || [];
  }
}

export class UnsupportedFeatureError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'UnsupportedFeatureError';
    this.feature = details?.feature;
    this.pgVersion = details?.pgVersion;
    this.requiredVersion = details?.requiredVersion;
  }
}

export class ConnectionError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'ConnectionError';
    this.host = details?.host;
    this.port = details?.port;
    this.code = details?.code;
  }
}

export class EngineInternalError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'EngineInternalError';
    this.component = details?.component;
    this.operation = details?.operation;
  }
}

export class InputValidationError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'InputValidationError';
    this.expected = details?.expected;
    this.actual = details?.actual;
  }
}

export class ConfigurationError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'ConfigurationError';
    this.missing = details?.missing || [];
  }
}

export class AtlasError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'AtlasError';
    this.exitCode = details?.exitCode;
    this.stderr = details?.stderr;
  }
}

export class DestructiveChangeError extends MigrationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'DestructiveChangeError';
    this.warnings = details?.warnings || [];
    this.warningReport = details?.warningReport || null;
    this.dataLossAcknowledged = details?.dataLossAcknowledged || false;
  }
}
