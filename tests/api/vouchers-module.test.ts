import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { riyadhDate, riyadhToday } from '../../shared/dates.ts';
import { bearer, createTestApp, createUserWithRole, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.4b: the vouchers module. Same numbers, codes and responses as before
// (tests/api/vouchers.test.ts), plus the owner's decisions (a)+(a) on dates,
// the Riyadh day, and refusing a misspelt type instead of saving a receipt.
let t: TestApp;
let adminToken: string;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
  adminToken = await registerFirstAdmin(t.app);
});
afterAll(() => t.cleanup());
afterEach(() => {
  vi.useRealTimers();
});

const create = (body: Record<string, unknown>, token = adminToken) =>
  request(t.app)
    .post('/api/vouchers')
    .set(bearer(token))
    .send({ voucher_type: 'payment', payment_channel: 'cash', party_name: 'كهرباء', amount: 100, ...body });
const voidIt = (id: number | string, reason: unknown) =>
  request(t.app).post(`/api/vouchers/${id}/void`).set(bearer(adminToken)).send({ reason });
const count = () => (t.db.prepare('SELECT COUNT(*) AS n FROM vouchers').get() as { n: number }).n;
const tomorrow = () => riyadhDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

describe('dates (owner decisions a + a)', () => {
  it('refuses an impossible date and a date after today; today and earlier days are fine', async () => {
    expect((await create({ voucher_date: '2026-02-30' })).body).toMatchObject({ field: 'voucher_date', reason: 'INVALID_DATE' });
    expect((await create({ voucher_date: '2026-13-01' })).body).toMatchObject({ reason: 'INVALID_DATE' });
    expect((await create({ voucher_date: tomorrow() })).body).toMatchObject({ field: 'voucher_date', reason: 'FUTURE_DATE' });
    expect((await create({ voucher_date: riyadhToday() })).status).toBe(201);
    expect((await create({ voucher_date: '2025-12-31' })).status).toBe(201);
  });

  it('dates a voucher sent without a date with the Riyadh day, also after midnight there', async () => {
    // 22:30 UTC on the 25th is 01:30 on the 26th in Riyadh.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T22:30:00.000Z'));
    const res = await create({ voucher_date: undefined });
    expect(res.status).toBe(201);
    expect(res.body.voucher.voucher_date).toBe('2026-11-26');
    // ...and the 26th is today there, not the future.
    expect((await create({ voucher_date: '2026-11-26' })).status).toBe(201);
  });
});

describe('choices, amounts and lengths', () => {
  it('refuses a misspelt type or channel instead of saving a receipt in cash', async () => {
    const before = count();
    expect((await create({ voucher_type: 'paymnt' })).body).toMatchObject({ code: 'VALIDATION_FAILED', field: 'voucher_type', reason: 'INVALID_CHOICE' });
    expect((await create({ payment_channel: 'cheque' })).body).toMatchObject({ field: 'payment_channel', reason: 'INVALID_CHOICE' });
    expect(count()).toBe(before);
  });

  it('keeps the old defaults: receipt in cash, and a category by type', async () => {
    const receipt = await create({ voucher_type: undefined, payment_channel: undefined, category: '' });
    expect(receipt.body.voucher).toMatchObject({ voucher_type: 'receipt', payment_channel: 'cash', category: 'إيرادات أخرى' });
    expect(receipt.body.voucher.voucher_number).toMatch(/^RCV-\d{4}-\d{5}$/);
    const payment = await create({ category: ' ' });
    expect(payment.body.voucher).toMatchObject({ category: 'مصروفات تشغيلية' });
    expect(payment.body.voucher.voucher_number).toMatch(/^PAY-\d{4}-\d{5}$/);
  });

  it('refuses an amount that rounds to zero, and keeps the old message', async () => {
    expect((await create({ amount: 0.001 })).body).toEqual({
      error: 'Voucher amount must be greater than zero.',
      code: 'VALIDATION_FAILED',
      field: 'amount',
      reason: 'MUST_BE_POSITIVE',
    });
    expect((await create({ amount: 'abc' })).body).toMatchObject({ error: 'Voucher amount must be greater than zero.', reason: 'INVALID_NUMBER' });
    expect((await create({ amount: 0.005 })).body.voucher.amount).toBe(0.01);
    expect((await create({ amount: '١٢٥٫٥' })).body.voucher.amount).toBe(125.5);
  });

  it('keeps the party name message and limits the texts', async () => {
    expect((await create({ party_name: '  ' })).body).toMatchObject({ error: 'Party or description name is required.', field: 'party_name', reason: 'REQUIRED' });
    expect((await create({ party_name: 'ب'.repeat(121) })).body).toMatchObject({ field: 'party_name', reason: 'TOO_LONG' });
    expect((await create({ category: 'ب'.repeat(61) })).body).toMatchObject({ field: 'category', reason: 'TOO_LONG' });
    expect((await create({ notes: 'ب'.repeat(301) })).body).toMatchObject({ field: 'notes', reason: 'TOO_LONG' });
  });
});

describe('voiding', () => {
  it('lets only one of two voids at the same moment succeed', async () => {
    const id = (await create({})).body.voucher.id as number;
    const [a, b] = await Promise.all([voidIt(id, 'مكرر'), voidIt(id, 'مبلغ خاطئ')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = t.db.prepare('SELECT status, voided_by FROM vouchers WHERE id = ?').get(id) as { status: string; voided_by: number };
    expect(row.status).toBe('void');
    expect(row.voided_by).toBeGreaterThan(0);
  });

  it('keeps the old codes', async () => {
    const id = (await create({})).body.voucher.id as number;
    expect((await voidIt('abc', 'سبب')).body).toEqual({ error: 'Invalid voucher ID.', code: 'INVALID_ID' });
    expect((await voidIt(id, 'x'.repeat(301))).body).toMatchObject({ code: 'VOID_REASON_REQUIRED' });
    expect((await voidIt(99999, 'سبب كاف')).body).toEqual({ error: 'Voucher not found.', code: 'NOT_FOUND' });
  });

  it('lists void vouchers too, newest date first', async () => {
    const res = await request(t.app).get('/api/bootstrap').set(bearer(adminToken));
    const dates = (res.body.vouchers as Array<{ voucher_date: string }>).map((v) => v.voucher_date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect((res.body.vouchers as Array<{ status: string }>).some((v) => v.status === 'void')).toBe(true);
  });
});

describe('access', () => {
  it('needs vouchers.manage for every route', async () => {
    const { token } = await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local');
    expect((await create({}, token)).status).toBe(403);
    expect((await request(t.app).post('/api/vouchers/1/void').set(bearer(token)).send({ reason: 'سبب كاف' })).status).toBe(403);
    expect((await request(t.app).delete('/api/vouchers/1').set(bearer(token))).status).toBe(403);
  });
});
