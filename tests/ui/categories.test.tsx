// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryView } from '../../src/components/InventoryView.tsx';
import { PosTerminalView } from '../../src/components/PosTerminalView.tsx';
import type { AuthUser, Category } from '../../shared/types.ts';
import { CATEGORIES, CUSTOMER, DRINK, PRODUCT, admin, callback, cashier, makeUser, resolves } from './fixtures.ts';

// R1.11c: Inventory > Categories, the category list in the product form, and
// the POS tab order.
const EMPTY: Category = {
  id: 3,
  name_ar: 'حلويات',
  name_en: 'Sweets',
  sort_order: 3,
  product_count: 0,
  created_at: '2026-11-01T08:00:00.000Z',
  updated_at: '2026-11-01T08:00:00.000Z',
};
const ALL_CATEGORIES = [CATEGORIES[1], CATEGORIES[0], EMPTY]; // in sort_order: Drinks, Dishes, Sweets

function renderInventory(user: AuthUser) {
  const handlers = {
    onCreateCategory: resolves(9),
    onUpdateCategory: resolves(true),
    onDeleteCategory: resolves(true),
    onReorderCategories: resolves(true),
  };
  render(
    <InventoryView
      lang="en"
      currentUser={user}
      products={[PRODUCT, DRINK]}
      categories={ALL_CATEGORIES}
      movements={[]}
      canViewCost
      onCreateProduct={resolves(true)}
      onUpdateProduct={resolves(true)}
      onStockMovement={resolves(true)}
      {...handlers}
    />
  );
  return handlers;
}

const button = (name: string | RegExp) => screen.queryByRole('button', { name });

describe('Inventory > Categories (R1.11c)', () => {
  it('lists the categories with their product counts for everyone', () => {
    renderInventory(makeUser(['inventory.view']));
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }));
    expect(screen.getByText('Sweets')).toBeTruthy();
    expect(button('Add Category')).toBeNull();
    expect(button('Edit Drinks')).toBeNull();
  });

  it('lets inventory managers add, edit, reorder and delete', async () => {
    const handlers = renderInventory(admin());
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }));
    expect(button('Add Category')).not.toBeNull();

    fireEvent.click(button('Move Dishes up')!);
    await waitFor(() => expect(handlers.onReorderCategories).toHaveBeenCalledWith([CATEGORIES[0].id, CATEGORIES[1].id, EMPTY.id]));

    fireEvent.click(button('Edit Drinks')!);
    fireEvent.change(screen.getByLabelText('Arabic name'), { target: { value: 'مشروبات باردة' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Category' }));
    await waitFor(() =>
      expect(handlers.onUpdateCategory).toHaveBeenCalledWith(CATEGORIES[1].id, { name_ar: 'مشروبات باردة', name_en: 'Drinks' })
    );
  });

  it('only allows deleting an empty category, after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const handlers = renderInventory(admin());
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }));

    expect(button('Delete Dishes')!.hasAttribute('disabled')).toBe(true); // it has a product
    fireEvent.click(button('Delete Sweets')!);
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(handlers.onDeleteCategory).toHaveBeenCalledWith(EMPTY.id));
  });
});

describe('product form category (R1.11c)', () => {
  it('chooses the category from a list instead of free text', () => {
    renderInventory(admin());
    fireEvent.click(screen.getByRole('button', { name: '+ Add Product' }));
    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['— Choose a category —', 'Drinks', 'Dishes', 'Sweets']);
    expect(select.value).toBe(String(CATEGORIES[1].id)); // first in order
  });

  it('can add a category from the form and selects it', async () => {
    const handlers = renderInventory(admin());
    fireEvent.click(screen.getByRole('button', { name: '+ Add Product' }));
    fireEvent.change(screen.getByLabelText('New category name'), { target: { value: 'مقبلات' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(handlers.onCreateCategory).toHaveBeenCalledWith({ name_ar: 'مقبلات', name_en: '' }));
  });
});

describe('POS category tabs (R1.11c)', () => {
  const tabOrder = () =>
    screen
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((text) => text === 'Drinks' || text === 'Dishes');

  const renderPos = (categories?: Category[]) =>
    render(
      <PosTerminalView
        lang="en"
        currentUser={cashier()}
        products={[PRODUCT, DRINK]}
        categories={categories}
        customers={[CUSTOMER]}
        heldCarts={[]}
        onCheckout={resolves(true)}
        onHoldCart={resolves(true)}
        onDeleteHeldCart={resolves(true)}
        onCreateCustomer={resolves(0)}
        onNotify={callback()}
      />
    );

  it('follows the order set in Inventory > Categories', () => {
    renderPos(ALL_CATEGORIES);
    expect(tabOrder()).toEqual(['Drinks', 'Dishes']);
  });

  it('falls back to the order products appear in without categories', () => {
    renderPos();
    expect(tabOrder()).toEqual(['Dishes', 'Drinks']);
  });
});
