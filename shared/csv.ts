/**
 * Minimal CSV reader/writer (R2.4a) for the product import, following RFC 4180:
 * quoted fields may contain the delimiter, line breaks and doubled quotes.
 *
 * Excel saves CSV with ";" instead of "," in regional settings that use the
 * comma as decimal separator, so the delimiter is detected from the header.
 * A UTF-8 byte-order mark is removed. Character decoding (UTF-8 or the Arabic
 * Windows-1256 code page) happens before this, in the browser.
 */
export type CsvDelimiter = ',' | ';' | '\t';

/** The delimiter used most often outside quotes on the first line. */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/** Parses CSV text into rows of cells. Fully empty lines are kept as [''] and can be skipped by the caller. */
export function parseCsv(input: string, delimiter: CsvDelimiter = detectDelimiter(input.replace(/^﻿/, ''))): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      i++;
    } else if (ch === delimiter) {
      endCell();
      i++;
    } else if (ch === '\r') {
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      endRow();
      i++;
    } else {
      cell += ch;
      i++;
    }
  }
  // Last line without a trailing line break.
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** True when every cell of the row is blank. */
export const isBlankRow = (row: readonly string[]) => row.every((cell) => cell.trim() === '');

function quoteCell(value: string, delimiter: CsvDelimiter): string {
  return /["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Writes rows as CSV with Windows line endings and a UTF-8 byte-order mark,
 * so Excel opens Arabic text correctly.
 */
export function toCsv(rows: readonly (readonly string[])[], delimiter: CsvDelimiter = ','): string {
  return `﻿${rows.map((r) => r.map((c) => quoteCell(c, delimiter)).join(delimiter)).join('\r\n')}\r\n`;
}
