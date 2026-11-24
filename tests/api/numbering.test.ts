import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ADMIN, SEED, bearer, createTestApp, getBootstrap, registerFirstAdmin, type TestApp } from '../helpers/app.ts';
import { riyadhYear, syncDocumentSequences } from '../../src/server/sequences.ts';

const seqOf = (documentNumber: string) => Number(documentNumber.slice(-5));

describe('document numbering (R1.8)', () => {
  let t: TestApp;
  let adminToken: string;
  const year = riyadhYear();

  const receipt = (token = adminToken, party = 'Numbering test') =>
    request(t.app)
      .post('/api/vouchers')
      .set(bearer(token))
      .send({ voucher_type: 'receipt', payment_channel: 'cash', party_name: party, amount: 10, voucher_date: '2026-11-01' });
  const payment = () =>
    request(t.app)
      .post('/api/vouchers')
      .set(bearer(adminToken))
      .send({ voucher_type: 'payment', payment_channel: 'cash', party_name: 'Numbering test', amount: 5, voucher_date: '2026-11-01' });
  const sell = () =>
    request(t.app)
      .post('/api/invoices')
      .set(bearer(adminToken))
      .send({
        items: [{ product_id: SEED.water.id, qty: 1 }],
        invoice_subtype: '0200000',
        payment_method: 'cash',
        cash_amount: 0,
        discount_total: 0,
        customer_id: null,
      });
  const login = async () =>
    (await request(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password })).body
      .token as string;

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
  });
  afterAll(() => t.cleanup());
  afterEach(() => {
    vi.useRealTimers();
  });

  it('numbers the seeded documents in the current Riyadh year', async () => {
    const body = await getBootstrap(t.app, adminToken);
    for (const inv of body.invoices) expect(inv.invoice_number).toMatch(new RegExp(`^INV-${year}-\\d{5}$`));
    for (const po of body.purchases) expect(po.purchase_number).toMatch(new RegExp(`^PO-${year}-\\d{5}$`));
    for (const v of body.vouchers) expect(v.voucher_number).toMatch(new RegExp(`^(RCV|PAY)-${year}-\\d{5}$`));
  });

  it('gives 20 simultaneous vouchers unique, consecutive numbers', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => receipt(adminToken, `Parallel ${i}`)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const seqs = results.map((r) => seqOf(r.body.voucher.voucher_number)).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(20);
    expect(seqs[19] - seqs[0]).toBe(19);
  });

  it('keeps receipts and payments in separate sequences', async () => {
    const r1 = await receipt();
    await payment();
    await payment();
    const r2 = await receipt();
    expect(r1.body.voucher.voucher_number.startsWith(`RCV-${year}-`)).toBe(true);
    expect(seqOf(r2.body.voucher.voucher_number)).toBe(seqOf(r1.body.voucher.voucher_number) + 1);
  });

  it('keeps invoices and credit notes in separate sequences (no gaps in invoices)', async () => {
    const first = await sell();
    const creditNote = await request(t.app)
      .post(`/api/invoices/${first.body.invoice.id}/credit-note`)
      .set(bearer(adminToken));
    const second = await sell();

    expect(first.body.invoice.invoice_number).toBe(`INV-${year}-00004`); // 3 seeded invoices
    expect(creditNote.body.invoice.invoice_number).toBe(`CN-${year}-00001`);
    expect(second.body.invoice.invoice_number).toBe(`INV-${year}-00005`);
  });

  it('does not consume a number when the save fails', async () => {
    const before = await receipt();
    t.db.exec(`CREATE TRIGGER fail_vouchers BEFORE INSERT ON vouchers BEGIN SELECT RAISE(ABORT, 'simulated'); END;`);
    try {
      expect((await receipt()).status).toBe(500);
    } finally {
      t.db.exec('DROP TRIGGER fail_vouchers');
    }
    const after = await receipt();
    expect(seqOf(after.body.voucher.voucher_number)).toBe(seqOf(before.body.voucher.voucher_number) + 1);
  });

  it('restarts at 00001 when the Riyadh year changes (UTC+3)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });

    // 31 Dec 2026, 21:30 UTC is already 1 Jan 2027, 00:30 in Riyadh.
    vi.setSystemTime(new Date('2026-12-31T21:30:00Z'));
    const newYear = await receipt(await login());
    expect(newYear.body.voucher.voucher_number).toBe('RCV-2027-00001');

    // 31 Dec 2026, 20:30 UTC is still 2026 in Riyadh: the 2026 sequence continues.
    vi.setSystemTime(new Date('2026-12-31T20:30:00Z'));
    const lastOfYear = await receipt(await login());
    expect(lastOfYear.body.voucher.voucher_number).toMatch(/^RCV-2026-\d{5}$/);
    expect(seqOf(lastOfYear.body.voucher.voucher_number)).toBeGreaterThan(1);
  });

  it('never reissues a number already stored (startup sync)', async () => {
    t.db
      .prepare(
        `INSERT INTO vouchers (voucher_number, voucher_type, payment_channel, party_name, category, amount, notes, voucher_date, created_at)
         VALUES (?, 'receipt', 'cash', 'Imported', '', 1, '', '2026-11-01', ?)`
      )
      .run(`RCV-${year}-00090`, new Date().toISOString());
    syncDocumentSequences(t.db);

    // The year-change test logged in under a simulated 2027 date, which purged
    // this user's real-time sessions as expired: sign in again.
    const next = await receipt(await login());
    expect(next.body.voucher.voucher_number).toBe(`RCV-${year}-00091`);
  });
});
