import type { Parsed } from '../../../shared/schemas/common.ts';
import { ValidationError } from './errors.ts';

/**
 * The value of a parse from shared/schemas, or its first problem as a 400
 * VALIDATION_FAILED with field and reason (one message per request).
 */
export function valueOrThrow<T>(parsed: Parsed<T>): T {
  if (parsed.ok) return parsed.value;
  const first = parsed.problems[0];
  throw new ValidationError(first.field, first.reason, first.message);
}
