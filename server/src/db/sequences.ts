import { formatDocumentNumber, riyadhYear, type DocumentType } from '../../../src/server/sequences.ts';
import type { Executor } from './kysely.ts';

/**
 * Yearly document numbers for the modules (R2.4b), e.g. PO-2026-00042: the
 * Kysely version of nextDocumentNumber() in src/server/sequences.ts (R1.8),
 * on the same document_sequences table, so old and new code share one counter
 * per type and year. The legacy version stays for the routes not moved yet.
 *
 * Call it with the `trx` of the transaction that saves the document: a failed
 * save rolls the number back. Read then write, without a dialect-specific
 * upsert; in MariaDB (R3) the read takes FOR UPDATE.
 */
export async function nextDocumentNumber(q: Executor, type: DocumentType, date: Date = new Date()): Promise<string> {
  const year = riyadhYear(date);
  const current = await q
    .selectFrom('document_sequences')
    .select('last_value')
    .where('doc_type', '=', type)
    .where('period_year', '=', year)
    .executeTakeFirst();
  const value = (current?.last_value ?? 0) + 1;

  if (current) {
    await q
      .updateTable('document_sequences')
      .set({ last_value: value })
      .where('doc_type', '=', type)
      .where('period_year', '=', year)
      .execute();
  } else {
    await q.insertInto('document_sequences').values({ doc_type: type, period_year: year, last_value: value }).execute();
  }
  return formatDocumentNumber(type, year, value);
}
