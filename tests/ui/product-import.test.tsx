// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryView } from '../../src/components/InventoryView.tsx';
import { ProductImport, decodeCsvBytes } from '../../src/components/ProductImport.tsx';
import { importTemplateCsv, type ImportReport } from '../../shared/schemas/product-import.ts';
import { PRODUCT, admin, callback, cashier, resolves } from './fixtures.ts';

// R2.4a: the CSV import screen.
type ImportHandler = (csv: string) => Promise<ImportReport | null>;
const report = (overrides: Partial<ImportReport> = {}): ImportReport => ({
  dryRun: true,
  totalRows: 4,
  validRows: 4,
  fileProblems: [],
  rowProblems: [],
  newCategories: [],
  imported: 0,
  ...overrides,
});

const chooseFile = (content: BlobPart, name = 'products.csv') => {
  const input = screen.getByLabelText('ملف CSV');
  fireEvent.change(input, { target: { files: [new File([content], name, { type: 'text/csv' })] } });
};

describe('decodeCsvBytes (R2.4a)', () => {
  it('reads UTF-8 files', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('الباركود,شاي').buffer)).toBe('الباركود,شاي');
  });

  it('falls back to Windows-1256, the code page of plain "CSV" from Arabic Excel', () => {
    // "شاي" in Windows-1256: ش=D4, ا=C7, ي=ED
    expect(decodeCsvBytes(new Uint8Array([0x41, 0x2c, 0xd4, 0xc7, 0xed]).buffer)).toBe('A,شاي');
  });
});

describe('import window (R2.4a)', () => {
  it('previews the file, lists every problem and keeps the import button off', async () => {
    const onPreview = vi.fn<ImportHandler>(async () =>
      report({
        validRows: 2,
        rowProblems: [
          { row: 3, column: 'سعر البيع', field: 'sell_price', reason: 'MUST_BE_POSITIVE', message: '' },
          { row: 5, column: 'الباركود', field: 'sku', reason: 'ALREADY_EXISTS', message: '' },
        ],
      })
    );
    render(<ProductImport lang="ar" onPreview={onPreview} onImport={resolves(null)} onClose={callback()} />);
    chooseFile('الباركود,الاسم بالعربية,سعر البيع\n');

    await waitFor(() => expect(onPreview).toHaveBeenCalledWith('الباركود,الاسم بالعربية,سعر البيع\n'));
    expect(await screen.findByText('يجب أن يكون أكبر من صفر')).toBeTruthy();
    expect(screen.getByText('موجود مسبقاً في النظام')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('المشكلات: 2');
    expect(screen.getByRole('button', { name: 'استيراد 2 صنف' }).hasAttribute('disabled')).toBe(true);
  });

  it('explains file problems in Arabic', async () => {
    const onPreview = vi.fn<ImportHandler>(async () =>
      report({ totalRows: 0, validRows: 0, fileProblems: [{ code: 'MISSING_COLUMNS', columns: ['سعر البيع'] }] })
    );
    render(<ProductImport lang="ar" onPreview={onPreview} onImport={resolves(null)} onClose={callback()} />);
    chooseFile('x\n');
    expect((await screen.findByRole('alert')).textContent).toContain('أعمدة مطلوبة غير موجودة: سعر البيع');
  });

  it('imports a clean file in one go and closes', async () => {
    const onImport = vi.fn<ImportHandler>(async () => report({ dryRun: false, imported: 4 }));
    const onClose = callback();
    render(
      <ProductImport lang="ar" onPreview={vi.fn<ImportHandler>(async () => report({ newCategories: ['شاورما'] }))} onImport={onImport} onClose={onClose} />
    );
    chooseFile('csv text');
    expect(await screen.findByText(/تصنيفات جديدة ستُنشأ: شاورما/)).toBeTruthy();

    const button = screen.getByRole('button', { name: 'استيراد 4 صنف' });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(onImport).toHaveBeenCalledWith('csv text'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('inventory screen buttons (R2.4a)', () => {
  const renderInventory = (user = admin()) =>
    render(
      <InventoryView
        lang="ar"
        currentUser={user}
        products={[PRODUCT]}
        movements={[]}
        canViewCost
        onCreateProduct={resolves(true)}
        onUpdateProduct={resolves(true)}
        onStockMovement={resolves(true)}
        onPreviewImport={resolves(report())}
        onImportProducts={resolves(report())}
      />
    );

  it('downloads the empty template with Arabic headings', async () => {
    const created: Blob[] = [];
    vi.stubGlobal('URL', { ...URL, createObjectURL: (b: Blob) => (created.push(b), 'blob:template'), revokeObjectURL: callback() });
    try {
      renderInventory();
      fireEvent.click(screen.getByRole('button', { name: 'تحميل نموذج CSV' }));
      expect(created).toHaveLength(1);
      // Blob.text() drops the BOM when decoding, so check the raw bytes for it.
      expect([...new Uint8Array(await created[0].arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(await created[0].text()).toBe(importTemplateCsv().slice(1));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens the import window for inventory managers only', () => {
    renderInventory();
    fireEvent.click(screen.getByRole('button', { name: 'استيراد من CSV' }));
    expect(screen.getByText('استيراد الأصناف من ملف CSV')).toBeTruthy();
  });

  it('shows no import buttons to a cashier', () => {
    renderInventory(cashier());
    expect(screen.queryByRole('button', { name: 'استيراد من CSV' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'تحميل نموذج CSV' })).toBeNull();
  });
});
