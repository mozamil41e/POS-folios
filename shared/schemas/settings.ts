import { z } from 'zod';
import type { FontSizeLevel, OrganizationSettings } from '../types';
import { isValidVatNumber } from '../validation';
import { INPUT_LIMITS, isMissing, problemsOf, type InputReason, type Parsed, type Raw } from './common';

/**
 * Restaurant (organisation) and printing settings input rules (R2.4b). Same
 * checks, messages and order as the legacy route, plus the owner's options:
 *   (a) length limits on the text fields (no format checks for CR, building
 *       number or postal code);
 *   (a) a value outside the allowed choices (paper width, rows per page, font
 *       size, auto print) is refused instead of being replaced silently.
 * A field that is not sent keeps its current value.
 */
export const THERMAL_WIDTHS = [58, 80] as const;
export const TABLE_PAGE_SIZES = [5, 10, 20, 50] as const;
export const FONT_SIZES = ['small', 'medium', 'large'] as const satisfies readonly FontSizeLevel[];

export const STORE_REQUIRED_ERROR = 'Store name and VAT number are required.';
export const VAT_ERROR = 'VAT number must be 15 digits starting and ending with 3.';
export const URL_PROTOCOL_ERROR = 'Public Base URL must use http:// or https://';
export const URL_FORMAT_ERROR = 'Invalid Public Base URL format.';

export type ThermalWidth = (typeof THERMAL_WIDTHS)[number];
export type TablePageSize = (typeof TABLE_PAGE_SIZES)[number];

export interface SettingsInput {
  name_ar: string;
  name_en: string;
  vat_number: string;
  cr_number: string;
  street_ar: string;
  building_no: string;
  city_ar: string;
  postal_code: string;
  public_base_url: string;
  thermal_width_mm: ThermalWidth;
  auto_print_receipt: 0 | 1;
  font_size: FontSizeLevel;
  table_page_size: TablePageSize;
}

export type SettingsDefaults = Pick<OrganizationSettings, keyof SettingsInput>;

type Check = (value: string) => { reason: InputReason; message: string } | null;

/** One issue per field with our reason code. */
const checked = (check: Check) =>
  z.string().superRefine((value, ctx) => {
    const problem = check(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem.message, params: { reason: problem.reason } });
  });

const maxLength = (field: string, max: number): Check => (value) =>
  value.length > max ? { reason: 'TOO_LONG', message: `${field} must be at most ${max} characters.` } : null;

const required = (field: string, max: number): Check => (value) =>
  value.length === 0 ? { reason: 'REQUIRED', message: STORE_REQUIRED_ERROR } : maxLength(field, max)(value);

const vatNumber: Check = (value) => {
  if (value.length === 0) return { reason: 'REQUIRED', message: STORE_REQUIRED_ERROR };
  return isValidVatNumber(value) ? null : { reason: 'INVALID_VAT', message: VAT_ERROR };
};

/**
 * '' clears the link. Otherwise http(s) only, normalised to origin + path
 * without a trailing slash (query and fragment are dropped), as before.
 */
export function normalisePublicBaseUrl(value: string): { ok: true; url: string } | { ok: false; message: string } {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return { ok: true, url: '' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: URL_FORMAT_ERROR };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, message: URL_PROTOCOL_ERROR };
  return { ok: true, url: parsed.origin + parsed.pathname.replace(/\/+$/, '') };
}

const publicBaseUrl: Check = (value) => {
  const tooLong = maxLength('public_base_url', INPUT_LIMITS.url)(value);
  if (tooLong) return tooLong;
  const result = normalisePublicBaseUrl(value);
  return result.ok ? null : { reason: 'INVALID_URL', message: result.message };
};

const choiceError = (field: string, allowed: readonly (string | number)[]) =>
  `${field} must be one of: ${allowed.join(', ')}.`;

/** A choice field: not sent keeps the current value; anything not allowed is refused. */
function choice<T extends string | number>(field: string, allowed: readonly T[], read: (value: unknown) => unknown) {
  const list: readonly unknown[] = allowed;
  const isAllowed = (value: unknown): value is T => list.includes(value);
  return z.unknown().transform((value, ctx): T => {
    const candidate = read(value);
    if (isAllowed(candidate)) return candidate;
    ctx.addIssue({ code: 'custom', message: choiceError(field, allowed), params: { reason: 'INVALID_CHOICE' } });
    return z.NEVER;
  });
}

// Order of the fields = order of the checks, as in the legacy route: the
// public link first, then the store name and VAT number, then the rest.
const settingsFields = z.object({
  public_base_url: checked(publicBaseUrl),
  name_ar: checked(required('name_ar', INPUT_LIMITS.name)),
  vat_number: checked(vatNumber),
  name_en: checked(maxLength('name_en', INPUT_LIMITS.name)),
  cr_number: checked(maxLength('cr_number', INPUT_LIMITS.crNumber)),
  street_ar: checked(maxLength('street_ar', INPUT_LIMITS.street)),
  building_no: checked(maxLength('building_no', INPUT_LIMITS.buildingNo)),
  city_ar: checked(maxLength('city_ar', INPUT_LIMITS.city)),
  postal_code: checked(maxLength('postal_code', INPUT_LIMITS.postalCode)),
  thermal_width_mm: choice('thermal_width_mm', THERMAL_WIDTHS, Number),
  auto_print_receipt: choice('auto_print_receipt', [0, 1] as const, (v) =>
    v === true || v === 1 || v === '1' ? 1 : v === false || v === 0 || v === '0' ? 0 : null
  ),
  font_size: choice('font_size', FONT_SIZES, (v) => v),
  table_page_size: choice('table_page_size', TABLE_PAGE_SIZES, Number),
});

const PAGE_SIZE_LIST: readonly number[] = TABLE_PAGE_SIZES;

/** The stored font size, read leniently (older rows may hold anything). */
const storedFontSize = (value: unknown): FontSizeLevel => (value === 'small' || value === 'large' ? value : 'medium');

export function parseSettings(raw: Raw, current: SettingsDefaults): Parsed<SettingsInput> {
  const text = (key: keyof SettingsInput) =>
    isMissing(raw[key]) ? String(current[key] ?? '').trim() : String(raw[key]).trim();
  const sent = (key: keyof SettingsInput, fallback: unknown) => (isMissing(raw[key]) ? fallback : raw[key]);

  const parsed = settingsFields.safeParse({
    public_base_url: text('public_base_url'),
    name_ar: text('name_ar'),
    vat_number: text('vat_number'),
    name_en: text('name_en'),
    cr_number: text('cr_number'),
    street_ar: text('street_ar'),
    building_no: text('building_no'),
    city_ar: text('city_ar'),
    postal_code: text('postal_code'),
    // Not sent: the stored value (one outside the choices falls back to the default).
    thermal_width_mm: sent('thermal_width_mm', current.thermal_width_mm === 58 ? 58 : 80),
    auto_print_receipt: sent('auto_print_receipt', current.auto_print_receipt === 1 ? 1 : 0),
    font_size: sent('font_size', storedFontSize(current.font_size)),
    table_page_size: sent('table_page_size', PAGE_SIZE_LIST.includes(current.table_page_size) ? current.table_page_size : 10),
  });
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };

  const value = parsed.data;
  const url = normalisePublicBaseUrl(value.public_base_url);
  return { ok: true, value: { ...value, public_base_url: url.ok ? url.url : '' } };
}

