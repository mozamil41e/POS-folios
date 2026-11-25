import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../validation';
import { INPUT_LIMITS, isMissing, problemsOf, type InputReason, type Parsed, type Raw } from './common';

/**
 * Sign-in and first-run setup input rules (R2.4b). The same checks and
 * messages as the legacy routes (R1.2, R1.9); every failure now also carries a
 * `reason` code. The users module reuses the name, email and password fields.
 */
export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 100;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const FULL_NAME_ERROR = `Full name must be between ${FULL_NAME_MIN_LENGTH} and ${FULL_NAME_MAX_LENGTH} characters.`;
export const EMAIL_ERROR = 'Valid email address is required.';
export const PASSWORD_LENGTH_ERROR = `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`;
export const LOGIN_REQUIRED_ERROR = 'Email and password are required.';

/** One issue per field, with our reason code (see toProblem in common.ts). */
function check(reasonOf: (value: string) => InputReason | null, message: string) {
  return (value: string, ctx: z.RefinementCtx) => {
    const reason = reasonOf(value);
    if (reason) ctx.addIssue({ code: 'custom', message, params: { reason } });
  };
}

const lengthReason = (min: number, max: number) => (value: string): InputReason | null => {
  if (value.length === 0) return 'REQUIRED';
  if (value.length < min) return 'TOO_SHORT';
  if (value.length > max) return 'TOO_LONG';
  return null;
};

/** Trimmed text; anything sent becomes a string. */
const trimmed = (value: unknown) => (isMissing(value) ? '' : String(value).trim());

export const fullNameField = z.preprocess(
  trimmed,
  z.string().superRefine(check(lengthReason(FULL_NAME_MIN_LENGTH, FULL_NAME_MAX_LENGTH), FULL_NAME_ERROR))
);

/** Emails are compared in lower case everywhere (sign-in, lockout, accounts). */
export const emailField = z.preprocess(
  (value) => trimmed(value).toLowerCase(),
  z.string().superRefine(
    check((value) => {
      if (value.length === 0) return 'REQUIRED';
      if (value.length > INPUT_LIMITS.email) return 'TOO_LONG';
      return EMAIL_PATTERN.test(value) ? null : 'INVALID_EMAIL';
    }, EMAIL_ERROR)
  )
);

/** Passwords are never trimmed: spaces are part of the password. */
const passwordText = (value: unknown) => (typeof value === 'string' ? value : '');

/** For new and changed passwords only; sign-in accepts older, shorter ones (R1.9). */
export const newPasswordField = z.preprocess(
  passwordText,
  z.string().superRefine(check(lengthReason(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH), PASSWORD_LENGTH_ERROR))
);

function parse<T>(schema: z.ZodType<T>, raw: Raw): Parsed<T> {
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, problems: problemsOf(parsed.error) };
}

// ------------------------------------------------------------ first-run setup

export interface SetupInput {
  full_name: string;
  email: string;
  password: string;
}

const setupFields = z.object({ full_name: fullNameField, email: emailField, password: newPasswordField });

/** Problems in the order the legacy route checked them: name, email, password. */
export function parseSetupInput(raw: Raw): Parsed<SetupInput> {
  return parse(setupFields, raw);
}

// ------------------------------------------------------------------- sign-in

export interface LoginInput {
  email: string;
  password: string;
}

/** Only presence is checked: a wrong format simply does not match an account. */
const loginFields = z.object({
  email: z.preprocess(
    (value) => trimmed(value).toLowerCase(),
    z.string().superRefine(check((v) => (v ? null : 'REQUIRED'), LOGIN_REQUIRED_ERROR))
  ),
  password: z.preprocess(
    passwordText,
    z.string().superRefine(check((v) => (v ? null : 'REQUIRED'), LOGIN_REQUIRED_ERROR))
  ),
});

export function parseLoginInput(raw: Raw): Parsed<LoginInput> {
  return parse(loginFields, raw);
}
