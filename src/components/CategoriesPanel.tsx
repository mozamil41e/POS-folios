import { useState } from 'react';
import { ArrowDown, ArrowUp, Edit3, Plus, Trash2, X } from 'lucide-react';
import type { Category, Language } from '../types';

/**
 * Inventory > Categories (R1.11c, option a): add, rename, reorder (POS tab
 * order) and delete categories. A category that still has products cannot be
 * deleted; the server refuses it too (409 CATEGORY_IN_USE).
 */
export interface CategoryHandlers {
  onCreateCategory?: (payload: { name_ar: string; name_en: string }) => Promise<number>;
  onUpdateCategory?: (id: number, payload: { name_ar: string; name_en: string }) => Promise<boolean>;
  onDeleteCategory?: (id: number) => Promise<boolean>;
  onReorderCategories?: (ids: number[]) => Promise<boolean>;
}

interface CategoriesPanelProps extends CategoryHandlers {
  lang: Language;
  categories: Category[];
  /** inventory.manage */
  canManage: boolean;
}

export function CategoriesPanel({
  lang,
  categories,
  canManage,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onReorderCategories,
}: CategoriesPanelProps) {
  const isAr = lang === 'ar';
  const [editing, setEditing] = useState<Category | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name_ar: '', name_en: '' });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    setEditing(null);
    setForm({ name_ar: '', name_en: '' });
    setShowForm(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({ name_ar: c.name_ar, name_en: c.name_en === c.name_ar ? '' : c.name_en });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name_ar.trim() || saving) return;
    setSaving(true);
    try {
      const ok = editing
        ? await onUpdateCategory?.(editing.id, form)
        : Boolean(await onCreateCategory?.(form));
      if (ok) setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Category) => {
    if (busy) return;
    if (
      !window.confirm(
        isAr ? `حذف التصنيف "${c.name_ar}"؟` : `Delete the category "${c.name_en}"?`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await onDeleteCategory?.(c.id);
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (busy || target < 0 || target >= categories.length) return;
    const ids = categories.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true);
    try {
      await onReorderCategories?.(ids);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isAr
            ? 'ترتيب التصنيفات هنا هو ترتيب أزرارها في شاشة نقطة البيع. لا يمكن حذف تصنيف عليه أصناف.'
            : 'This order is the order of the category tabs on the POS screen. A category with products cannot be deleted.'}
        </p>
        {canManage && onCreateCategory && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 self-start"
          >
            <Plus className="w-4 h-4" />
            {isAr ? 'إضافة تصنيف' : 'Add Category'}
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-3 px-4 text-start font-medium w-16">#</th>
              <th className="py-3 px-4 text-start font-medium">{isAr ? 'الاسم بالعربية' : 'Arabic name'}</th>
              <th className="py-3 px-4 text-start font-medium">{isAr ? 'الاسم بالإنجليزية' : 'English name'}</th>
              <th className="py-3 px-4 text-center font-medium">{isAr ? 'عدد الأصناف' : 'Products'}</th>
              {canManage && <th className="py-3 px-4 text-end font-medium">{isAr ? 'إجراءات' : 'Actions'}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {categories.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="py-10 text-center text-slate-400">
                  {isAr ? 'لا توجد تصنيفات بعد' : 'No categories yet'}
                </td>
              </tr>
            ) : (
              categories.map((c, index) => (
                <tr key={c.id}>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500">{index + 1}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">{c.name_ar}</td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{c.name_en}</td>
                  <td className="py-3 px-4 text-center font-mono tabular-nums">{c.product_count}</td>
                  {canManage && (
                    <td className="py-3 px-4 text-end">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          onClick={() => void move(index, -1)}
                          aria-label={isAr ? `تحريك ${c.name_ar} للأعلى` : `Move ${c.name_en} up`}
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy || index === categories.length - 1}
                          onClick={() => void move(index, 1)}
                          aria-label={isAr ? `تحريك ${c.name_ar} للأسفل` : `Move ${c.name_en} down`}
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          aria-label={isAr ? `تعديل ${c.name_ar}` : `Edit ${c.name_en}`}
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busy || c.product_count > 0}
                          onClick={() => void handleDelete(c)}
                          title={
                            c.product_count > 0
                              ? isAr
                                ? 'انقل أصناف هذا التصنيف أولاً'
                                : 'Move its products first'
                              : undefined
                          }
                          aria-label={isAr ? `حذف ${c.name_ar}` : `Delete ${c.name_en}`}
                          className="p-1.5 rounded-md border border-red-200 dark:border-red-900/60 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editing
                  ? isAr
                    ? 'تعديل التصنيف'
                    : 'Edit Category'
                  : isAr
                  ? 'تصنيف جديد'
                  : 'New Category'}
              </h3>
              <button type="button" onClick={() => setShowForm(false)} aria-label={isAr ? 'إغلاق' : 'Close'}>
                <X className="w-4 h-4" />
              </button>
            </div>
            {editing && editing.product_count > 0 && (
              <p className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
                {isAr
                  ? `تغيير الاسم ينطبق على أصناف هذا التصنيف (${editing.product_count}).`
                  : `The new name applies to its ${editing.product_count} product(s).`}
              </p>
            )}
            <div className="space-y-1">
              <label htmlFor="category-name-ar" className="block text-slate-500">
                {isAr ? 'الاسم بالعربية' : 'Arabic name'}
              </label>
              <input
                id="category-name-ar"
                required
                maxLength={60}
                value={form.name_ar}
                onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="category-name-en" className="block text-slate-500">
                {isAr ? 'الاسم بالإنجليزية (اختياري)' : 'English name (optional)'}
              </label>
              <input
                id="category-name-en"
                dir="ltr"
                maxLength={60}
                value={form.name_en}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-600 dark:text-slate-300">
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg disabled:opacity-50"
              >
                {isAr ? 'حفظ التصنيف' : 'Save Category'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
