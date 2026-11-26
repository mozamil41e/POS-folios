// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PosTerminalView } from '../../src/components/PosTerminalView.tsx';
import { newIdempotencyKey } from '../../src/idempotency.ts';
import { callback, cashier, CUSTOMER, PRODUCT, resolves } from './fixtures.ts';

// R2.5a: one Idempotency-Key per sale attempt. A retry of the same sale (the
// server may already have saved it) reuses the key; a new or changed sale
// gets a new one.
function renderPos() {
  const onCheckout = resolves(false);
  render(
    <PosTerminalView
      lang="en"
      currentUser={cashier()}
      products={[PRODUCT]}
      customers={[CUSTOMER]}
      heldCarts={[]}
      onCheckout={onCheckout}
      onHoldCart={resolves(true)}
      onDeleteHeldCart={resolves(true)}
      onCreateCustomer={resolves(0)}
      onNotify={callback()}
    />
  );
  return onCheckout;
}

const addDish = () => fireEvent.click(screen.getByRole('button', { name: /Grilled Chicken/ }));
const checkout = () => fireEvent.click(screen.getByRole('button', { name: 'Complete Sale & Print Receipt' }));
const keyOfCall = (mock: ReturnType<typeof resolves>, n: number) => (mock.mock.calls[n][0] as { idempotency_key: string }).idempotency_key;

describe('POS terminal: Idempotency-Key per sale (R2.5a)', () => {
  it('sends the same key again when the same sale is retried after a failure', async () => {
    const onCheckout = renderPos();
    addDish();
    checkout();
    await waitFor(() => expect(onCheckout).toHaveBeenCalledTimes(1));
    checkout();
    await waitFor(() => expect(onCheckout).toHaveBeenCalledTimes(2));
    expect(keyOfCall(onCheckout, 0)).toMatch(/^[A-Za-z0-9_\-:.]{8,100}$/);
    expect(keyOfCall(onCheckout, 1)).toBe(keyOfCall(onCheckout, 0));
  });

  it('uses a new key when the sale changes, and after a successful sale', async () => {
    const onCheckout = renderPos();
    addDish();
    checkout();
    await waitFor(() => expect(onCheckout).toHaveBeenCalledTimes(1));

    addDish(); // two dishes now: another sale
    checkout();
    await waitFor(() => expect(onCheckout).toHaveBeenCalledTimes(2));
    expect(keyOfCall(onCheckout, 1)).not.toBe(keyOfCall(onCheckout, 0));

    onCheckout.mockResolvedValue(true);
    checkout(); // succeeds with the second key
    await waitFor(() => expect(onCheckout).toHaveBeenCalledTimes(3));
    expect(keyOfCall(onCheckout, 2)).toBe(keyOfCall(onCheckout, 1));
    await waitFor(() => expect(screen.queryByText('Cart is empty')).not.toBeNull());

    addDish();
    checkout();
    await waitFor(() => expect(onCheckout).toHaveBeenCalledTimes(4));
    expect(keyOfCall(onCheckout, 3)).not.toBe(keyOfCall(onCheckout, 2));
  });
});

describe('newIdempotencyKey', () => {
  it('makes a different valid key each time, also without crypto.randomUUID (plain http)', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(newIdempotencyKey()).toMatch(/^sale-[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
