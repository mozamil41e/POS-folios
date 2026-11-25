// Validation rules shared by the server and the UI (single source of truth).

/** KSA VAT registration number: 15 digits, starting and ending with 3 (D12). */
export const VAT_NUMBER_PATTERN = /^3\d{13}3$/;

export function isValidVatNumber(value: string | null | undefined): boolean {
  return VAT_NUMBER_PATTERN.test((value ?? '').trim());
}

/** Password length for new and changed passwords (R1.9, SEC-06). Existing shorter passwords still log in. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function isValidPasswordLength(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}
