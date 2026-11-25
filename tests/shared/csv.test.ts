import { describe, expect, it } from 'vitest';
import { detectDelimiter, isBlankRow, parseCsv, toCsv } from '../../shared/csv.ts';
import { IMPORT_COLUMNS, importTemplateCsv, mapImportHeader } from '../../shared/schemas/product-import.ts';

// R2.4a: the CSV reader behind the product import.
describe('parseCsv (R2.4a)', () => {
  it('reads plain rows with Windows or Unix line endings, with or without a final line break', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a,\n')).toEqual([['a', '']]);
  });

  it('handles quotes: delimiters, line breaks and doubled quotes inside a field', () => {
    expect(parseCsv('"شاي, أخضر","سطر\nثان","قال ""مرحبا"""\n')).toEqual([['شاي, أخضر', 'سطر\nثان', 'قال "مرحبا"']]);
  });

  it('removes the UTF-8 byte-order mark Excel adds', () => {
    expect(parseCsv('﻿الباركود,الاسم بالعربية\n')).toEqual([['الباركود', 'الاسم بالعربية']]);
  });

  it('detects ";" and tab delimiters from the header, ignoring quoted ones', () => {
    expect(detectDelimiter('a;b;c\n1,5;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('"a;b";c,d,e')).toBe(',');
    expect(parseCsv('الباركود;سعر البيع\nA1;12,5\n')).toEqual([['الباركود', 'سعر البيع'], ['A1', '12,5']]);
  });

  it('keeps blank lines visible so row numbers match the spreadsheet', () => {
    const rows = parseCsv('h\n\nx\n');
    expect(rows).toEqual([['h'], [''], ['x']]);
    expect(isBlankRow(rows[1])).toBe(true);
  });
});

describe('toCsv and the template (R2.4a)', () => {
  it('writes a byte-order mark, Windows line endings and quotes when needed', () => {
    expect(toCsv([['a', 'b,c'], ['"x"', 'سطر\nثان']])).toBe('﻿a,"b,c"\r\n"""x""","سطر\nثان"\r\n');
  });

  it('round-trips through parseCsv', () => {
    const rows = [['الباركود', 'الاسم'], ['A-1', 'شاي "أحمر", كبير']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('is an empty template with the Arabic headings only', () => {
    const template = importTemplateCsv();
    expect(template.startsWith('﻿')).toBe(true);
    expect(parseCsv(template)).toEqual([IMPORT_COLUMNS.map((c) => c.ar)]);
  });

  it('maps Arabic or English headings in any order and lists missing required ones', () => {
    const { index, missing } = mapImportHeader([' سعر البيع ', 'SKU', 'Extra column', 'name_ar']);
    expect(index).toMatchObject({ sell_price: 0, sku: 1, name_ar: 3 });
    expect(missing).toEqual([]);
    expect(mapImportHeader(['الباركود']).missing.map((c) => c.ar)).toEqual(['الاسم بالعربية', 'سعر البيع']);
  });
});
