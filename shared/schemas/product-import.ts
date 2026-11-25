import { toCsv } from '../csv';

/**
 * Product import from CSV (R2.4a, owner's request). The template has Arabic
 * headings; English ones are accepted too. Owner's decisions (a)+(a):
 *  - a SKU that already exists, or appears twice in the file, rejects the file;
 *  - any invalid row means nothing is imported (fix and retry).
 * In R5 this becomes two templates (raw materials, menu items).
 */
export const IMPORT_MAX_ROWS = 1000;

export interface ImportColumn {
  /** Field of the product input (category is a name, found or created). */
  key:
    | 'sku'
    | 'name_ar'
    | 'name_en'
    | 'category_ar'
    | 'unit_ar'
    | 'cost_price'
    | 'sell_price'
    | 'tax_rate'
    | 'stock_qty'
    | 'min_stock_alert'
    | 'expiry_date';
  ar: string;
  en: string;
  required: boolean;
}

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'sku', ar: 'الباركود', en: 'sku', required: true },
  { key: 'name_ar', ar: 'الاسم بالعربية', en: 'name_ar', required: true },
  { key: 'name_en', ar: 'الاسم بالإنجليزية', en: 'name_en', required: false },
  { key: 'category_ar', ar: 'التصنيف', en: 'category', required: false },
  { key: 'unit_ar', ar: 'الوحدة', en: 'unit', required: false },
  { key: 'cost_price', ar: 'سعر التكلفة', en: 'cost_price', required: false },
  { key: 'sell_price', ar: 'سعر البيع', en: 'sell_price', required: true },
  { key: 'tax_rate', ar: 'الضريبة', en: 'tax_rate', required: false },
  { key: 'stock_qty', ar: 'الرصيد الافتتاحي', en: 'stock_qty', required: false },
  { key: 'min_stock_alert', ar: 'حد التنبيه', en: 'min_stock_alert', required: false },
  { key: 'expiry_date', ar: 'تاريخ الانتهاء', en: 'expiry_date', required: false },
];

/** The empty template: the header row only. */
export function importTemplateCsv(): string {
  return toCsv([IMPORT_COLUMNS.map((c) => c.ar)]);
}

const normaliseHeader = (h: string) => h.replace(/^﻿/, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Column index per field for a header row; missing required headings are listed. */
export function mapImportHeader(header: readonly string[]): {
  index: Partial<Record<ImportColumn['key'], number>>;
  missing: ImportColumn[];
} {
  const index: Partial<Record<ImportColumn['key'], number>> = {};
  header.forEach((cell, i) => {
    const name = normaliseHeader(cell);
    const column = IMPORT_COLUMNS.find((c) => normaliseHeader(c.ar) === name || normaliseHeader(c.en) === name);
    if (column && index[column.key] === undefined) index[column.key] = i;
  });
  return { index, missing: IMPORT_COLUMNS.filter((c) => c.required && index[c.key] === undefined) };
}

export interface ImportRowProblem {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  /** Column heading as in the template (Arabic). */
  column: string;
  field: string;
  reason: string;
  message: string;
}

export type ImportFileProblem =
  | { code: 'EMPTY_FILE' }
  | { code: 'MISSING_COLUMNS'; columns: string[] }
  | { code: 'TOO_MANY_ROWS'; max: number; found: number };

export interface ImportReport {
  dryRun: boolean;
  /** Data rows read (blank rows ignored). */
  totalRows: number;
  /** Rows without any problem. */
  validRows: number;
  fileProblems: ImportFileProblem[];
  rowProblems: ImportRowProblem[];
  /** Categories that do not exist yet and will be created. */
  newCategories: string[];
  /** Number of products added (0 for a preview or a rejected file). */
  imported: number;
}

/** Heading shown for a field in problems (Arabic template heading). */
export function columnHeading(field: string): string {
  const key = field === 'category_id' ? 'category_ar' : field;
  return IMPORT_COLUMNS.find((c) => c.key === key)?.ar ?? field;
}
