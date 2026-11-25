import { useState } from 'react';
import { FileSpreadsheet, Upload, X } from 'lucide-react';
import type { Language } from '../../shared/types';
import {
  IMPORT_MAX_ROWS,
  importTemplateCsv,
  type ImportFileProblem,
  type ImportReport,
} from '../../shared/schemas/product-import';
import { reasonText } from '../api-errors';

/**
 * Product import from CSV (R2.4a): choose a file, see a preview with every
 * problem (row, column, reason), then import all rows at once. The server
 * checks everything; this screen only reads the file and shows the report.
 */

/**
 * Excel saves "CSV UTF-8" or, in Arabic Windows, plain "CSV" in the Windows-1256
 * code page. Decode strict UTF-8 first and fall back to Windows-1256.
 */
export function decodeCsvBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1256').decode(bytes);
  }
}

/** Downloads the empty template (Arabic headings, UTF-8 with BOM for Excel). */
export function downloadImportTemplate(): void {
  const blob = new Blob([importTemplateCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mizan-products-template.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function fileProblemText(problem: ImportFileProblem, isAr: boolean): string {
  switch (problem.code) {
    case 'EMPTY_FILE':
      return isAr ? 'الملف فارغ أو لا يحتوي صفوف أصناف تحت العناوين.' : 'The file is empty or has no product rows under the headings.';
    case 'MISSING_COLUMNS':
      return isAr
        ? `أعمدة مطلوبة غير موجودة: ${problem.columns.join('، ')}. استخدم النموذج.`
        : `Required columns are missing: ${problem.columns.join(', ')}. Use the template.`;
    case 'TOO_MANY_ROWS':
      return isAr
        ? `الملف فيه ${problem.found} صفاً والحد ${problem.max}. قسّمه إلى أكثر من ملف.`
        : `The file has ${problem.found} rows; the limit is ${problem.max}. Split it into several files.`;
  }
}

interface ProductImportProps {
  lang: Language;
  /** Server preview (dry run); null when the request failed (already notified). */
  onPreview: (csv: string) => Promise<ImportReport | null>;
  /** Server import; resolves with the report, or null when it failed. */
  onImport: (csv: string) => Promise<ImportReport | null>;
  onClose: () => void;
}

export function ProductImport({ lang, onPreview, onImport, onClose }: ProductImportProps) {
  const isAr = lang === 'ar';
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const problems = report ? report.fileProblems.length + report.rowProblems.length : 0;
  const canImport = Boolean(report && problems === 0 && report.validRows > 0 && !busy);

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setReport(null);
    try {
      const text = decodeCsvBytes(await file.arrayBuffer());
      setFileName(file.name);
      setCsv(text);
      setReport(await onPreview(text));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!canImport) return;
    setBusy(true);
    try {
      const done = await onImport(csv);
      if (done && done.imported > 0) onClose();
      else if (done) setReport(done);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            {isAr ? 'استيراد الأصناف من ملف CSV' : 'Import products from CSV'}
          </h3>
          <button type="button" onClick={onClose} aria-label={isAr ? 'إغلاق' : 'Close'}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <ol className="list-decimal ps-5 space-y-1 text-slate-600 dark:text-slate-300 leading-relaxed">
          <li>
            {isAr ? 'حمّل النموذج واملأه في Excel، صنفاً في كل صف ' : 'Download the template and fill it in Excel, one product per row '}
            <button
              type="button"
              onClick={downloadImportTemplate}
              className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold hover:underline"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              {isAr ? 'تحميل نموذج CSV' : 'Download CSV template'}
            </button>
          </li>
          <li>
            {isAr
              ? `الحقول المطلوبة: الباركود، الاسم بالعربية، سعر البيع. الضريبة 15 أو 0، والتاريخ بالصيغة 2027-06-30. حتى ${IMPORT_MAX_ROWS} صف.`
              : `Required: SKU, Arabic name, selling price. VAT 15 or 0; dates like 2027-06-30. Up to ${IMPORT_MAX_ROWS} rows.`}
          </li>
          <li>
            {isAr
              ? 'احفظه بصيغة CSV ثم اختره هنا. لن يُستورد شيء إلا إذا خلا الملف من الأخطاء.'
              : 'Save it as CSV and choose it here. Nothing is imported unless the file has no problems.'}
          </li>
        </ol>

        <label className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 cursor-pointer hover:border-emerald-600">
          <Upload className="w-4 h-4 text-emerald-700" />
          <span className="font-semibold">{fileName || (isAr ? 'اختر ملف CSV' : 'Choose a CSV file')}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label={isAr ? 'ملف CSV' : 'CSV file'}
            disabled={busy}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </label>

        {busy && <p className="text-slate-500">{isAr ? 'جاري الفحص...' : 'Checking...'}</p>}

        {report && (
          <div className="space-y-3">
            <p role="status" className="font-semibold">
              {isAr
                ? `الصفوف: ${report.totalRows} · السليمة: ${report.validRows} · المشكلات: ${problems}`
                : `Rows: ${report.totalRows} · valid: ${report.validRows} · problems: ${problems}`}
            </p>

            {report.fileProblems.map((p) => (
              <p key={p.code} role="alert" className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
                {fileProblemText(p, isAr)}
              </p>
            ))}

            {report.newCategories.length > 0 && (
              <p className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300">
                {isAr ? 'تصنيفات جديدة ستُنشأ: ' : 'New categories to create: '}
                {report.newCategories.join(isAr ? '، ' : ', ')}
              </p>
            )}

            {report.rowProblems.length > 0 && (
              <div className="max-h-72 overflow-y-auto border border-red-200 dark:border-red-900 rounded-lg">
                <table className="w-full">
                  <thead className="bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300">
                    <tr>
                      <th className="py-2 px-3 text-start">{isAr ? 'الصف' : 'Row'}</th>
                      <th className="py-2 px-3 text-start">{isAr ? 'العمود' : 'Column'}</th>
                      <th className="py-2 px-3 text-start">{isAr ? 'المشكلة' : 'Problem'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100 dark:divide-red-900/60">
                    {report.rowProblems.map((p) => (
                      <tr key={`${p.row}-${p.field}`}>
                        <td className="py-1.5 px-3 font-mono">{p.row}</td>
                        <td className="py-1.5 px-3">{p.column}</td>
                        <td className="py-1.5 px-3">{reasonText(p.reason, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 dark:text-slate-300">
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={!canImport}
            onClick={() => void handleImport()}
            className="px-5 py-2 font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg disabled:opacity-40"
          >
            {isAr ? `استيراد ${report?.validRows ?? 0} صنف` : `Import ${report?.validRows ?? 0} products`}
          </button>
        </div>
      </div>
    </div>
  );
}
