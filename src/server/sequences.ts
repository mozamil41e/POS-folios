// Atomic yearly document numbering (R1.8, H5 / SEC-17).
//
// Replaces COUNT(*)+1, which produced duplicate numbers (and 500 errors) after a
// deletion, never restarted per year, and tied invoice numbers to the ZATCA ICV
// counter. Each number is reserved inside the same transaction as the document
// it belongs to, so a failed save does not consume a number.
//
// MariaDB equivalent for R3 (no RETURNING there):
//   INSERT INTO document_sequences (doc_type, period_year, last_value) VALUES (?, ?, LAST_INSERT_ID(1))
//   ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1);  then  SELECT LAST_INSERT_ID();
import type Database from 'better-sqlite3';

export type DocumentType = 'INV' | 'CN' | 'PO' | 'RCV' | 'PAY';

const DOCUMENT_TYPES: ReadonlySet<string> = new Set(['INV', 'CN', 'PO', 'RCV', 'PAY']);

/** Saudi Arabia is UTC+3 all year (no daylight saving). */
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Calendar year of `date` in Asia/Riyadh — documents are numbered per local year. */
export function riyadhYear(date: Date = new Date()): number {
  return new Date(date.getTime() + RIYADH_OFFSET_MS).getUTCFullYear();
}

export function formatDocumentNumber(type: DocumentType, year: number, value: number): string {
  return `${type}-${year}-${String(value).padStart(5, '0')}`;
}

/**
 * Reserves the next number for `type` in the current Riyadh year, e.g. INV-2026-00042.
 * Call it inside the transaction that inserts the document.
 */
export function nextDocumentNumber(db: Database.Database, type: DocumentType, date: Date = new Date()): string {
  const year = riyadhYear(date);
  const row = db
    .prepare(`
      INSERT INTO document_sequences (doc_type, period_year, last_value) VALUES (?, ?, 1)
      ON CONFLICT(doc_type, period_year) DO UPDATE SET last_value = last_value + 1
      RETURNING last_value
    `)
    .get(type, year) as { last_value: number };
  return formatDocumentNumber(type, year, row.last_value);
}

const NUMBERED_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'invoices', column: 'invoice_number' }, // INV- and CN-
  { table: 'purchases', column: 'purchase_number' }, // PO-
  { table: 'vouchers', column: 'voucher_number' }, // RCV- and PAY-
];

/**
 * Raises every sequence to at least the highest number already stored, so an
 * existing database never reissues a number. Safe to run on every start.
 */
export function syncDocumentSequences(db: Database.Database): void {
  const highest = new Map<string, { type: string; year: number; value: number }>();

  for (const { table, column } of NUMBERED_COLUMNS) {
    const rows = db.prepare(`SELECT ${column} AS n FROM ${table}`).all() as Array<{ n: string }>;
    for (const { n } of rows) {
      const match = /^([A-Z]+)-(\d{4})-(\d+)$/.exec(n);
      if (!match || !DOCUMENT_TYPES.has(match[1])) continue;
      const key = `${match[1]}|${match[2]}`;
      const value = Number(match[3]);
      if (value > (highest.get(key)?.value ?? 0)) {
        highest.set(key, { type: match[1], year: Number(match[2]), value });
      }
    }
  }

  const raise = db.prepare(`
    INSERT INTO document_sequences (doc_type, period_year, last_value) VALUES (?, ?, ?)
    ON CONFLICT(doc_type, period_year) DO UPDATE SET last_value = MAX(last_value, excluded.last_value)
  `);
  for (const { type, year, value } of highest.values()) {
    raise.run(type, year, value);
  }
}
