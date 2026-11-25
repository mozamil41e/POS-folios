import { categoryKey } from '../../../../src/server/db.ts';
import { isBlankRow, parseCsv } from '../../../../shared/csv.ts';
import type { Category } from '../../../../shared/types.ts';
import { parseCategoryRef, parseOpeningStock, parseProduct, type ProductInput } from '../../../../shared/schemas/inventory.ts';
import {
  IMPORT_MAX_ROWS,
  columnHeading,
  mapImportHeader,
  type ImportColumn,
  type ImportReport,
  type ImportRowProblem,
} from '../../../../shared/schemas/product-import.ts';
import { kysely } from '../../db/kysely.ts';
import { withTransaction } from '../../db/transaction.ts';
import * as repo from './repository.ts';

/**
 * Product import from CSV (R2.4a). Every row passes the same rules as adding a
 * product by hand. Owner's decisions (a)+(a): an existing or repeated SKU, or
 * any invalid row, rejects the file; otherwise all rows are added in one
 * transaction with their opening stock as a movement. A preview (dryRun) only
 * reports. The CSV is parsed before the transaction starts.
 */
interface ValidRow {
  row: number;
  product: ProductInput;
  stockQty: number;
  categoryName: string;
  categoryNameEn: string;
}

const DEFAULT_CATEGORY = { ar: 'عام', en: 'General' };

export async function importProducts(body: Record<string, unknown>): Promise<ImportReport> {
  const csv = typeof body.csv === 'string' ? body.csv : '';
  const dryRun = body.dryRun !== false;
  const report: ImportReport = {
    dryRun,
    totalRows: 0,
    validRows: 0,
    fileProblems: [],
    rowProblems: [],
    newCategories: [],
    imported: 0,
  };

  // --- the file: header, size
  const records = parseCsv(csv);
  const headerAt = records.findIndex((r) => !isBlankRow(r));
  if (headerAt < 0) {
    report.fileProblems.push({ code: 'EMPTY_FILE' });
    return report;
  }
  const { index, missing } = mapImportHeader(records[headerAt]);
  if (missing.length > 0) {
    report.fileProblems.push({ code: 'MISSING_COLUMNS', columns: missing.map((c) => c.ar) });
    return report;
  }
  // Spreadsheet row numbers: record i is row i + 1.
  const dataRows = records
    .map((cells, i) => ({ cells, row: i + 1 }))
    .filter(({ cells, row }) => row > headerAt + 1 && !isBlankRow(cells));
  report.totalRows = dataRows.length;
  if (dataRows.length === 0) {
    report.fileProblems.push({ code: 'EMPTY_FILE' });
    return report;
  }
  if (dataRows.length > IMPORT_MAX_ROWS) {
    report.fileProblems.push({ code: 'TOO_MANY_ROWS', max: IMPORT_MAX_ROWS, found: dataRows.length });
    return report;
  }

  // --- every row, every problem
  const cell = (cells: string[], key: ImportColumn['key']) => {
    const i = index[key];
    return i === undefined ? undefined : (cells[i] ?? '');
  };
  const problem = (row: number, field: string, reason: string, message: string): ImportRowProblem => ({
    row,
    column: columnHeading(field),
    field,
    reason,
    message,
  });

  const valid: ValidRow[] = [];
  const firstRowOfSku = new Map<string, number>();
  for (const { cells, row } of dataRows) {
    const raw: Record<string, unknown> = {
      sku: cell(cells, 'sku'),
      name_ar: cell(cells, 'name_ar'),
      name_en: cell(cells, 'name_en'),
      category_ar: cell(cells, 'category_ar'),
      unit_ar: cell(cells, 'unit_ar'),
      cost_price: cell(cells, 'cost_price'),
      sell_price: cell(cells, 'sell_price'),
      tax_rate: cell(cells, 'tax_rate'),
      stock_qty: cell(cells, 'stock_qty'),
      min_stock_alert: cell(cells, 'min_stock_alert'),
      expiry_date: cell(cells, 'expiry_date'),
    };
    const product = parseProduct(raw);
    const stock = parseOpeningStock(raw);
    const category = parseCategoryRef({ category_ar: raw.category_ar });
    const rowProblems: ImportRowProblem[] = [];
    for (const parsed of [product, stock, category]) {
      if (!parsed.ok) for (const p of parsed.problems) rowProblems.push(problem(row, p.field, p.reason, p.message));
    }

    const sku = String(raw.sku ?? '').trim();
    if (sku) {
      const first = firstRowOfSku.get(sku);
      if (first !== undefined) {
        rowProblems.push(problem(row, 'sku', 'DUPLICATE_IN_FILE', `SKU ${sku} is also in row ${first}.`));
      } else {
        firstRowOfSku.set(sku, row);
      }
    }

    report.rowProblems.push(...rowProblems);
    if (rowProblems.length === 0 && product.ok && stock.ok && category.ok) {
      const ref = category.value;
      valid.push({
        row,
        product: product.value,
        stockQty: stock.value,
        categoryName: ref && 'name_ar' in ref ? ref.name_ar : DEFAULT_CATEGORY.ar,
        categoryNameEn: ref && 'name_ar' in ref ? ref.name_en : DEFAULT_CATEGORY.en,
      });
    }
  }

  // --- SKUs already in the system (decision a: the file is rejected)
  const taken = await repo.products.existingSkus(kysely, valid.map((v) => v.product.sku));
  for (const v of valid) {
    if (taken.has(v.product.sku)) {
      report.rowProblems.push(problem(v.row, 'sku', 'ALREADY_EXISTS', `SKU ${v.product.sku} already exists.`));
    }
  }
  const problemRows = new Set(report.rowProblems.map((p) => p.row));
  report.rowProblems.sort((a, b) => a.row - b.row);
  report.validRows = dataRows.filter(({ row }) => !problemRows.has(row)).length;

  // --- categories that will be created
  const existing = new Set((await repo.categories.list(kysely)).map((c) => categoryKey(c.name_ar)));
  const fresh = new Map<string, string>();
  for (const v of valid) {
    const key = categoryKey(v.categoryName);
    if (!existing.has(key) && !fresh.has(key)) fresh.set(key, v.categoryName.trim().replace(/\s+/g, ' '));
  }
  report.newCategories = [...fresh.values()];

  // --- decision (a): any problem means nothing is imported
  if (dryRun || report.rowProblems.length > 0) return report;

  const stamp = new Date().toISOString();
  await withTransaction(async (trx) => {
    const byKey = new Map<string, Category>();
    for (const v of valid) {
      const key = categoryKey(v.categoryName);
      let category = byKey.get(key);
      if (!category) {
        category = (await repo.categories.findOrCreate(trx, v.categoryName, v.categoryNameEn)).category;
        byKey.set(key, category);
      }
      const id = await repo.products.insert(trx, {
        ...v.product,
        category_id: category.id,
        category_ar: category.name_ar,
        category_en: category.name_en,
        stock_qty: v.stockQty,
        active: 1,
        created_at: stamp,
        updated_at: stamp,
      });
      if (v.stockQty > 0) {
        await repo.movements.insert(trx, {
          product_id: id,
          type: 'purchase',
          qty_delta: v.stockQty,
          balance_after: v.stockQty,
          reference_no: 'CSV-IMPORT',
          notes: 'رصيد افتتاحي (استيراد من ملف)',
          created_at: stamp,
        });
      }
    }
  });
  report.imported = valid.length;
  return report;
}
