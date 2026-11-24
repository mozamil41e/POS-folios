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

  // CURRENT BEHAVIOUR (SEC-17): financial vouchers are hard-deleted.
  // R1.8 replaces deletion with voiding — flip this test then.
  it('CURRENT BEHAVIOUR: hard-deletes a voucher', async () => {
    const created = await create(voucher({ party_name: 'To be deleted' }));
    const id = created.body.voucher.id as number;
    const res = await remove(id);
    expect(res.status).toBe(200);
    expect(res.body.vouchers.some((v: { id: number }) => v.id === id)).toBe(false);
  });

  // CURRENT BEHAVIOUR (H5 / DB-03): numbering uses COUNT(*)+1, so deleting a
  // voucher makes the next number collide with an existing one and the request
  // fails with a 500. R1.8 (document_sequences) fixes this — flip to 201 then.
  it('CURRENT BEHAVIOUR: numbering collides after a delete and the request fails with 500', async () => {
    const first = await create(voucher({ voucher_type: 'payment', party_name: 'Supplier A' }));
    const second = await create(voucher({ voucher_type: 'payment', party_name: 'Supplier B' }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    await remove(first.body.voucher.id);

    const third = await create(voucher({ voucher_type: 'payment', party_name: 'Supplier C' }));
    expect(third.status).toBe(500);
  });
});
