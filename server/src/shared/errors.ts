/**
 * Application errors (R2.1). Services throw these; the central error handler
 * turns them into JSON with a stable `code` the UI can translate. Anything
 * that is not an AppError is unexpected: logged with the request id and
 * answered as 500 INTERNAL without internals.
 *
 * The response keeps today's shape ({ error, code, ...details }) until the
 * API v1 envelope ({ error: { code, message, details } }) arrives in R2.5.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra fields for the client (field, reason, available, count, ...). */
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(404, code, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(409, code, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(403, code, message, details);
  }
}

/** Invalid input for one field: 400 VALIDATION_FAILED with field and reason. */
export class ValidationError extends AppError {
  readonly field: string;
  readonly reason: string;
  constructor(field: string, reason: string, message: string) {
    super(400, 'VALIDATION_FAILED', message, { field, reason });
    this.field = field;
    this.reason = reason;
  }
}
