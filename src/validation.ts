// Validation rules shared by the server and the UI (single source of truth).

/** KSA VAT registration number: 15 digits, starting and ending with 3 (D12). */
export const VAT_NUMBER_PATTERN = /^3\d{13}3$/;

export function isValidVatNumber(value: string | null | undefined): boolean {
  return VAT_NUMBER_PATTERN.test((value ?? '').trim());
}
