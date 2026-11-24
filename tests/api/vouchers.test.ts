import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

const voucher = (overrides: Record<string, unknown> = {}) => ({
  voucher_type: 'receipt',
  payment_channel: 'cash',
  party_name: 'Opening float',
  category: '',
  amount: 250.5,
  notes: '',
  voucher_date: '2026-11-01',
  ...overrides,
});

describe('vouchers (characterization)', () => {
  let t: TestApp;
  let adminToken: string;

  const create = (body: Record<string, unknown>) =>
    request(t.app).post('/api/vouchers').set(bearer(adminToken)).send(body);
  const remove = (id: number) => request(t.app).delete(`/api/vouchers/${id}`).set(bearer(adminToken));
  const voidVoucher = (id: number, reason: string) =>
    request(t.app).post(`/api/vouchers/${id}/void`).set(bearer(adminToken)).send({ reason });

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
  });
  afterAll(() => t.cleanup());

  it('creates a receipt voucher numbered per type', async () => {
    const res = await create(voucher());
    expect(res.status).toBe(201);
    // One receipt voucher is seeded, so this one is number 2.
    expect(res.body.voucher.voucher_number).toMatch(/^RCV-\d{4}-00002$/);
    expect(res.body.voucher.amount).toBe(250.5);
    expect(res.body.voucher.voucher_date).toBe('2026-11-01');
  });

  it('requires a party name and a positive amount', async () => {
    expect((await create(voucher({ party_name: '' }))).status).toBe(400);
    expect((await create(voucher({ amount: 0 }))).status).toBe(400);
  });

  it("falls back to today's date when the date is invalid", async () => {
    const res = await create(voucher({ voucher_date: 'not-a-date' }));
    expect(res.status).toBe(201);
    expect(res.body.voucher.voucher_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // SEC-17 fixed in R1.8: vouchers are never deleted.
  it('refuses to delete a voucher (405) and keeps it', async () => {
    const created = await create(voucher({ party_name: 'Cannot be deleted' }));
    const id = created.body.voucher.id as number;
    const res = await remove(id);
    expect(res.status).toBe(405);
    expect(res.body.code).toBe('VOUCHER_DELETE_NOT_ALLOWED');
    const row = t.db.prepare('SELECT status FROM vouchers WHERE id = ?').get(id) as { status: string };
    expect(row.status).toBe('active');
  });

  it('voids a voucher with a reason and records who and when', async () => {
    const created = await create(voucher({ party_name: 'Entered by mistake' }));
    const id = created.body.voucher.id as number;

    const res = await voidVoucher(id, 'Duplicate entry');
    expect(res.status).toBe(200);
    expect(res.body.voucher).toMatchObject({ id, status: 'void', void_reason: 'Duplicate entry' });
    expect(res.body.voucher.voided_at).toEqual(expect.any(String));
    expect(res.body.voucher.voided_by).toEqual(expect.any(Number));
    // Still listed, with its number kept.
    expect(res.body.vouchers.some((v: { id: number }) => v.id === id)).toBe(true);
  });

  it('requires a reason, rejects voiding twice and unknown vouchers', async () => {
    const created = await create(voucher({ party_name: 'Reason checks' }));
    const id = created.body.voucher.id as number;

    expect((await voidVoucher(id, '')).body.code).toBe('VOID_REASON_REQUIRED');
    expect((await voidVoucher(id, 'ok')).status).toBe(400);
    expect((await voidVoucher(id, 'Wrong amount')).status).toBe(200);

    const again = await voidVoucher(id, 'Wrong amount');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_VOID');

    expect((await voidVoucher(999_999, 'Not there')).status).toBe(404);
  });

  // H5 fixed in R1.8: numbers come from document_sequences, not COUNT(*)+1.
  it('keeps numbering unique after a voucher is voided', async () => {
    const first = await create(voucher({ voucher_type: 'payment', party_name: 'Supplier A' }));
    const second = await create(voucher({ voucher_type: 'payment', party_name: 'Supplier B' }));
    await voidVoucher(first.body.voucher.id, 'Cancelled order');
    const third = await create(voucher({ voucher_type: 'payment', party_name: 'Supplier C' }));

    expect(third.status).toBe(201);
    const numbers = [first, second, third].map((r) => r.body.voucher.voucher_number as string);
    expect(new Set(numbers).size).toBe(3);
    const seq = numbers.map((n) => Number(n.slice(-5)));
    expect(seq).toEqual([seq[0], seq[0] + 1, seq[0] + 2]);
  });
});
