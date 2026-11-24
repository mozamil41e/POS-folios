// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PosTerminalView } from '../../src/components/PosTerminalView.tsx';
import type { AuthUser, HeldCart } from '../../src/types.ts';
import { admin, callback, cashier, CUSTOMER, PRODUCT, resolves } from './fixtures.ts';

function renderPos(
  options: {
    user?: AuthUser;
    checkout?: boolean;
    hold?: boolean;
    deleteHeld?: boolean;
    heldCarts?: HeldCart[];
  } = {}
) {
  const handlers = {
    onCheckout: resolves(options.checkout ?? true),
    onHoldCart: resolves(options.hold ?? true),
    onDeleteHeldCart: resolves(options.deleteHeld ?? true),
    onCreateCustomer: resolves(0),
    onNotify: callback(),
  };
  render(
    <PosTerminalView
      lang="en"
      currentUser={options.user ?? cashier()}
      products={[PRODUCT]}
      customers={[CUSTOMER]}
      heldCarts={options.heldCarts ?? []}
      {...handlers}
    />
  );
  return handlers;
}

const addDishToCart = () =>
  fireEvent.click(screen.getByRole('button', { name: /Grilled Chicken/ }));
const checkoutButton = () => screen.getByRole('button', { name: 'Complete Sale & Print Receipt' });
const cartIsEmpty = () => screen.queryByText('Cart is empty') !== null;

describe('POS terminal: the cart survives failures (R1.6, H1)', () => {
  it('keeps the cart and re-enables checkout when the sale is rejected', async () => {
    const { onCheckout } = renderPos({ checkout: false });
    addDishToCart();
    expect(cartIsEmpty()).toBe(false);

    fireEvent.click(checkoutButton());

    await waitFor(() => expect(onCheckout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(checkoutButton().hasAttribute('disabled')).toBe(false));
    expect(cartIsEmpty()).toBe(false);
  });

  it('clears the cart after a successful sale', async () => {
    const { onCheckout } = renderPos({ checkout: true });
    addDishToCart();
    fireEvent.click(checkoutButton());

    await waitFor(() => expect(cartIsEmpty()).toBe(true));
    expect(onCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ product_id: PRODUCT.id, qty: 1 }], discount_total: 0 })
    );
  });

  it('sends one sale only, even when checkout is clicked twice', async () => {
    let finish: (ok: boolean) => void = () => {};
    const { onCheckout } = renderPos();
    onCheckout.mockImplementation(() => new Promise<boolean>((resolve) => (finish = resolve)));
    addDishToCart();

    fireEvent.click(checkoutButton());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Issuing Invoice...' }).hasAttribute('disabled')).toBe(true)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Issuing Invoice...' }));
    finish(true);

    await waitFor(() => expect(cartIsEmpty()).toBe(true));
    expect(onCheckout).toHaveBeenCalledTimes(1);
  });

  it('does not report "held" or clear the cart when holding fails', async () => {
    const { onHoldCart, onNotify } = renderPos({ hold: false });
    addDishToCart();
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));

    await waitFor(() => expect(onHoldCart).toHaveBeenCalledTimes(1));
    expect(cartIsEmpty()).toBe(false);
    expect(onNotify).not.toHaveBeenCalledWith('Order placed on hold');
  });

  it('reports "held" and clears the cart when holding succeeds', async () => {
    const { onNotify } = renderPos({ hold: true });
    addDishToCart();
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('Order placed on hold'));
    expect(cartIsEmpty()).toBe(true);
  });

  it('shows an error instead of crashing on a damaged held cart, and keeps it', async () => {
    const damaged: HeldCart = {
      id: 5,
      label: 'Broken order',
      items_json: '{not json',
      discount: 0,
      customer_id: null,
      invoice_subtype: '0200000',
      created_at: '2026-11-01T08:00:00.000Z',
    };
    const { onDeleteHeldCart, onNotify } = renderPos({ heldCarts: [damaged] });

    fireEvent.click(screen.getByRole('button', { name: /Held Carts \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith('This held order could not be read', 'error')
    );
    expect(onDeleteHeldCart).not.toHaveBeenCalled();
  });

  it('restores a held cart only after it was removed from the held list', async () => {
    const held: HeldCart = {
      id: 6,
      label: 'Table order',
      items_json: JSON.stringify([{ product_id: PRODUCT.id, qty: 2 }]),
      discount: 0,
      customer_id: null,
      invoice_subtype: '0200000',
      created_at: '2026-11-01T08:00:00.000Z',
    };
    const { onDeleteHeldCart } = renderPos({ heldCarts: [held], deleteHeld: false });

    fireEvent.click(screen.getByRole('button', { name: /Held Carts \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(onDeleteHeldCart).toHaveBeenCalledWith(6));
    expect(cartIsEmpty()).toBe(true); // the delete failed, so nothing was restored
  });
});

describe('POS terminal: controls follow permissions (R1.6)', () => {
  it('hides the discount field from a cashier without pos.discount', () => {
    renderPos({ user: cashier() });
    expect(screen.queryByLabelText('Discount (SAR)')).toBeNull();
  });

  it('shows the discount field to a user with pos.discount', () => {
    renderPos({ user: admin() });
    expect(screen.getByLabelText('Discount (SAR)')).toBeTruthy();
  });

  it('hides hold for a user without pos.hold', () => {
    renderPos({ user: withoutHold() });
    addDishToCart();
    expect(screen.queryByRole('button', { name: 'Hold' })).toBeNull();
  });

  it('hides the quick "new customer" button without customers.manage', () => {
    renderPos({ user: { ...cashier(), permissions: ['pos.access'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Standard Tax (B2B)' }));
    expect(screen.queryByRole('button', { name: '+ New Customer' })).toBeNull();
  });
});

function withoutHold(): AuthUser {
  const user = cashier();
  return { ...user, permissions: user.permissions.filter((p) => p !== 'pos.hold') };
}
