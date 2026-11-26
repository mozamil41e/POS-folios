import { kysely } from '../../db/kysely.ts';
import { AppError, NotFoundError } from '../../shared/errors.ts';
import { getSettings } from '../settings/service.ts';
import * as repo from './repository.ts';

/**
 * The public view of one invoice or credit note (R2.4b), opened from the
 * receipt QR (D1, D8). Same answer as before (R1.9): the invoice, its lines
 * and the restaurant's details, nothing more.
 *
 * Known limit, for R3: the restaurant's details are today's settings, not a
 * copy taken when the invoice was issued (needs new columns in MariaDB).
 */
const MAX_ID_LENGTH = 80;

export async function publicInvoice(rawUuid: unknown) {
  const uuid = String(rawUuid ?? '').trim();
  if (!uuid || uuid.length > MAX_ID_LENGTH) {
    throw new AppError(400, 'INVALID_INVOICE_ID', 'Invalid invoice identifier.');
  }
  const invoice = await repo.findByUuid(kysely, uuid);
  if (!invoice) throw new NotFoundError('INVOICE_NOT_FOUND', 'Invoice not found.');

  const settings = await getSettings();
  return {
    invoice,
    store: {
      name_ar: settings.name_ar,
      name_en: settings.name_en,
      vat_number: settings.vat_number,
      cr_number: settings.cr_number,
      street_ar: settings.street_ar,
      building_no: settings.building_no,
      city_ar: settings.city_ar,
      postal_code: settings.postal_code,
      public_base_url: settings.public_base_url,
    },
  };
}
