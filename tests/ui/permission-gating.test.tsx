// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryView } from '../../src/components/InventoryView.tsx';
import { InvoiceReceiptModal } from '../../src/components/InvoiceReceiptModal.tsx';
import { PurchasesView } from '../../src/components/PurchasesView.tsx';
import { SalesView } from '../../src/components/SalesView.tsx';
import type { AuthUser } from '../../shared/types.ts';
import { admin, callback, cashier, INVOICE, makeUser, PRODUCT, resolves, SETTINGS } from './fixtures.ts';

// The server already refuses these actions (requirePermission); these tests
// cover the reported bug: a cashier was still shown the buttons.

function renderInventory(user: AuthUser, save = true) {
  const handlers = {
    onCreateProduct: resolves(save),
    onUpdateProduct: resolves(save),
    onStockMovement: resolves(save),
  };
  render(
    <InventoryView
      lang="en"
      currentUser={user}
      products={[PRODUCT]}
      movements={[]}
      canViewCost={false}
      {...handlers}
    />
  );
  return handlers;
}

function renderSales(user: AuthUser) {
  const handlers = {
    onCreateSale: resolves(true),
    onCreditNote: resolves(true),
    onCreateCustomer: resolves(1),
    onUpdateCustomer: resolves(true),
    onOpenReceipt: callback(),
    onNotify: callback(),
  };
  render(
    <SalesView
      lang="en"
      currentUser={user}
      settings={SETTINGS}
      products={[PRODUCT]}
      customers={[]}
      invoices={[INVOICE]}
      canViewCost={false}
      {...handlers}
    />
  );
  return handlers;
}

const button = (name: string | RegExp) => screen.queryByRole('button', { name });

describe('inventory buttons (R1.6)', () => {
  it('shows a cashier (inventory.view only) no add, edit or restock buttons', () => {
    renderInventory(cashier());
    expect(button('+ Add Product')).toBeNull();
    expect(button('Edit')).toBeNull();
    expect(button('Restock / Adjust')).toBeNull();
  });

  it('shows them to an admin', () => {
    renderInventory(admin());
    expect(button('+ Add Product')).not.toBeNull();
    expect(button('Edit')).not.toBeNull();
    expect(button('Restock / Adjust')).not.toBeNull();
  });

  it('shows restock without add/edit to a user with inventory.adjust only', () => {
    renderInventory(makeUser(['inventory.view', 'inventory.adjust']));
    expect(button('Restock / Adjust')).not.toBeNull();
    expect(button('+ Add Product')).toBeNull();
    expect(button('Edit')).toBeNull();
  });

  it('keeps the product form open when saving fails, and closes it on success', async () => {
    const failing = renderInventory(admin(), false);
    fireEvent.click(button('+ Add Product')!);
    fireEvent.submit(screen.getByRole('button', { name: 'Save Product' }).closest('form')!);
    await waitFor(() => expect(failing.onCreateProduct).toHaveBeenCalledTimes(1));
    expect(button('Save Product')).not.toBeNull();
  });

  it('closes the product form after a successful save', async () => {
    const ok = renderInventory(admin(), true);
    fireEvent.click(button('+ Add Product')!);
    fireEvent.submit(screen.getByRole('button', { name: 'Save Product' }).closest('form')!);
    await waitFor(() => expect(button('Save Product')).toBeNull());
    expect(ok.onCreateProduct).toHaveBeenCalledTimes(1);
  });
});

describe('sales buttons (R1.6)', () => {
  it('shows a cashier no credit-note (return) button, but keeps new sale and customers', () => {
    renderSales(cashier());
    expect(button('Credit Note (381)')).toBeNull();
    expect(button('+ New Sale Invoice')).not.toBeNull(); // pos.access
    expect(button('+ Add Customer')).not.toBeNull(); // customers.manage
  });

  it('shows the credit-note button to a user with sales.return', () => {
    renderSales(admin());
    expect(button('Credit Note (381)')).not.toBeNull();
  });

  it('hides new sale and customer buttons from a read-only sales user', () => {
    renderSales(makeUser(['sales.view']));
    expect(button('+ New Sale Invoice')).toBeNull();
    expect(button('+ Add Customer')).toBeNull();
    expect(button('Credit Note (381)')).toBeNull();
  });

  it('asks for confirmation before issuing a credit note', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onCreditNote } = renderSales(admin());

    fireEvent.click(button('Credit Note (381)')!);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(INVOICE.invoice_number));
    expect(onCreditNote).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(button('Credit Note (381)')!);
    await waitFor(() => expect(onCreditNote).toHaveBeenCalledWith(INVOICE.id));
  });
});

describe('purchases buttons (R1.6)', () => {
  it('hides new purchase and new supplier from a purchases.view user', () => {
    render(
      <PurchasesView
        lang="en"
        currentUser={makeUser(['purchases.view'])}
        products={[PRODUCT]}
        suppliers={[]}
        purchases={[]}
        onCreatePurchase={resolves(true)}
        onPayPurchase={resolves(true)}
        onCreateSupplier={resolves(1)}
        onNotify={callback()}
      />
    );
    expect(button('+ New Purchase Invoice')).toBeNull();
    expect(button('+ Add Supplier')).toBeNull();
  });

  it('shows them with purchases.manage', () => {
    render(
      <PurchasesView
        lang="en"
        currentUser={makeUser(['purchases.view', 'purchases.manage'])}
        products={[PRODUCT]}
        suppliers={[]}
        purchases={[]}
        onCreatePurchase={resolves(true)}
        onPayPurchase={resolves(true)}
        onCreateSupplier={resolves(1)}
        onNotify={callback()}
      />
    );
    expect(button('+ New Purchase Invoice')).not.toBeNull();
    expect(button('+ Add Supplier')).not.toBeNull();
  });
});

describe('receipt modal (R1.6)', () => {
  const renderReceipt = (user: AuthUser) =>
    render(
      <InvoiceReceiptModal
        invoice={INVOICE}
        settings={SETTINGS}
        lang="en"
        currentUser={user}
        onClose={callback()}
        onCreditNote={resolves(true)}
      />
    );

  it('shows no credit-note button to a cashier', () => {
    renderReceipt(cashier());
    expect(button('Credit Note')).toBeNull();
  });

  it('shows it with sales.return', () => {
    renderReceipt(admin());
    expect(button('Credit Note')).not.toBeNull();
  });
});
