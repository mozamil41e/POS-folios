// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InventoryView } from '../../src/components/InventoryView.tsx';
import { PosTerminalView } from '../../src/components/PosTerminalView.tsx';
import { PurchasesView } from '../../src/components/PurchasesView.tsx';
import { ReportsCenterView } from '../../src/components/ReportsCenterView.tsx';
import { SalesView } from '../../src/components/SalesView.tsx';
import type { OrganizationSettings } from '../../shared/types.ts';
import { SETTINGS, admin, callback, resolves } from './fixtures.ts';

// R1.7: production now starts with no products, customers, invoices or
// suppliers. Every screen must open on that empty workspace without errors.
const EMPTY_SETTINGS: OrganizationSettings = {
  ...SETTINGS,
  name_ar: 'اسم المطعم',
  name_en: 'Restaurant name',
  vat_number: '',
  cr_number: '',
  street_ar: '',
  building_no: '',
  city_ar: '',
  postal_code: '',
  public_base_url: '',
};

describe('screens on an empty workspace (R1.7)', () => {
  it('POS shows an empty cart and a disabled checkout', () => {
    render(
      <PosTerminalView
        lang="en"
        currentUser={admin()}
        products={[]}
        customers={[]}
        heldCarts={[]}
        onCheckout={resolves(true)}
        onHoldCart={resolves(true)}
        onDeleteHeldCart={resolves(true)}
        onCreateCustomer={resolves(0)}
        onNotify={callback()}
      />
    );
    expect(screen.getByText('Cart is empty')).toBeTruthy();
    const checkout = screen.getByRole('button', { name: 'Complete Sale & Print Receipt' });
    expect(checkout.hasAttribute('disabled')).toBe(true);
  });

  it('sales opens, including the new-sale form, with no products or invoices', () => {
    render(
      <SalesView
        lang="en"
        currentUser={admin()}
        settings={EMPTY_SETTINGS}
        products={[]}
        customers={[]}
        invoices={[]}
        canViewCost
        onCreateSale={resolves(true)}
        onCreditNote={resolves(true)}
        onCreateCustomer={resolves(0)}
        onUpdateCustomer={resolves(true)}
        onOpenReceipt={callback()}
        onNotify={callback()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '+ New Sale Invoice' }));
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('inventory and purchases open, including their forms', () => {
    render(
      <InventoryView
        lang="en"
        currentUser={admin()}
        products={[]}
        movements={[]}
        canViewCost
        onCreateProduct={resolves(true)}
        onUpdateProduct={resolves(true)}
        onStockMovement={resolves(true)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add Product' }));
    expect(screen.getByRole('button', { name: 'Save Product' })).toBeTruthy();

    render(
      <PurchasesView
        lang="en"
        currentUser={admin()}
        products={[]}
        suppliers={[]}
        purchases={[]}
        onCreatePurchase={resolves(true)}
        onPayPurchase={resolves(true)}
        onCreateSupplier={resolves(0)}
        onNotify={callback()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '+ New Purchase Invoice' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add Supplier' }));
  });

  it('opens every report with no data', () => {
    render(
      <ReportsCenterView
        lang="en"
        currentUser={admin()}
        settings={EMPTY_SETTINGS}
        invoices={[]}
        products={[]}
        customers={[]}
        suppliers={[]}
        purchases={[]}
        movements={[]}
        vouchers={[]}
        onCreateVoucher={resolves(true)}
        onVoidVoucher={resolves(true)}
        onStockMovement={resolves(true)}
        onNotify={callback()}
      />
    );
    for (const header of screen.getAllByRole('button').filter((b) => b.getAttribute('aria-expanded') === 'false')) {
      fireEvent.click(header);
    }
    const reportButtons = () => screen.getAllByRole('button').filter((b) => !b.hasAttribute('aria-expanded'));
    const total = reportButtons().length;
    expect(total).toBe(25);

    for (let i = 0; i < total; i++) {
      fireEvent.click(reportButtons()[i]);
      fireEvent.click(screen.getByRole('button', { name: 'All Reports' }));
    }
  });
});
