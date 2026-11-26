import { z } from 'zod';
import { isBlankNumber, problemsOf, rule, toNumberInput, type Parsed, type Raw } from './common';

/**
 * Paged lists for API v1 (R2.5): ?page=1&pageSize=50. Pages count from 1;
 * a page holds at most 200 rows. The answer carries
 * meta: { page, pageSize, total } so the client knows how many pages exist.
 */
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;
export const PAGE_MAX = 1_000_000;

export interface PageRequest {
  page: number;
  pageSize: number;
  /** Rows to skip: (page - 1) × pageSize. */
  offset: number;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

const whole = (field: string, max: number) =>
  z.preprocess(
    toNumberInput,
    z
      .number({ error: `${field} must be a number.` })
      .refine(Number.isInteger, rule('NOT_INTEGER', `${field} must be a whole number.`))
      .refine((v) => v >= 1, rule('MUST_BE_POSITIVE', `${field} must be at least 1.`))
      .refine((v) => v <= max, rule('TOO_LARGE', `${field} must be at most ${max}.`))
  );

const pageFields = z.object({ page: whole('page', PAGE_MAX), pageSize: whole('pageSize', PAGE_SIZE_MAX) });

/** Reads page and pageSize from a query string; both are optional. */
export function parsePage(query: Raw): Parsed<PageRequest> {
  const parsed = pageFields.safeParse({
    page: isBlankNumber(query.page) ? 1 : query.page,
    pageSize: isBlankNumber(query.pageSize) ? PAGE_SIZE_DEFAULT : query.pageSize,
  });
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const { page, pageSize } = parsed.data;
  return { ok: true, value: { page, pageSize, offset: (page - 1) * pageSize } };
}

export function pageMeta(page: PageRequest, total: number): PageMeta {
  return { page: page.page, pageSize: page.pageSize, total };
}
