import { describe, expect, it } from 'vitest';
import { PAGE_SIZE_DEFAULT, pageMeta, parsePage } from '../../shared/schemas/pagination.ts';

// R2.5a: paged lists for API v1 (?page=&pageSize=).
describe('parsePage', () => {
  it('defaults to the first page of 50', () => {
    expect(parsePage({})).toEqual({ ok: true, value: { page: 1, pageSize: PAGE_SIZE_DEFAULT, offset: 0 } });
    expect(parsePage({ page: '', pageSize: '' })).toEqual({ ok: true, value: { page: 1, pageSize: 50, offset: 0 } });
  });

  it('reads query strings, also with Arabic digits, and computes the offset', () => {
    expect(parsePage({ page: '3', pageSize: '20' })).toEqual({ ok: true, value: { page: 3, pageSize: 20, offset: 40 } });
    expect(parsePage({ page: '٢', pageSize: '١٠' })).toEqual({ ok: true, value: { page: 2, pageSize: 10, offset: 10 } });
  });

  it('refuses pages below 1, fractions and pages of more than 200 rows', () => {
    const reason = (query: Record<string, unknown>) => {
      const parsed = parsePage(query);
      return parsed.ok ? null : `${parsed.problems[0].field}:${parsed.problems[0].reason}`;
    };
    expect(reason({ page: 0 })).toBe('page:MUST_BE_POSITIVE');
    expect(reason({ page: 1.5 })).toBe('page:NOT_INTEGER');
    expect(reason({ pageSize: 201 })).toBe('pageSize:TOO_LARGE');
    expect(reason({ pageSize: 'all' })).toBe('pageSize:INVALID_NUMBER');
    expect(reason({ pageSize: 200 })).toBeNull();
  });
});

describe('pageMeta', () => {
  it('reports the page, its size and the total', () => {
    const page = parsePage({ page: 2, pageSize: 25 });
    expect(page.ok ? pageMeta(page.value, 61) : null).toEqual({ page: 2, pageSize: 25, total: 61 });
  });
});
