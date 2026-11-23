import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Language } from '../types';

export function useTablePagination<T>(
  items: T[],
  pageSize: number,
  resetKey?: string | number
) {
  const effectiveSize = pageSize > 0 ? pageSize : 10;
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [effectiveSize, resetKey]);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / effectiveSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * effectiveSize;
    return items.slice(start, start + effectiveSize);
  }, [items, currentPage, effectiveSize]);

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * effectiveSize + 1;
  const endItem = Math.min(totalItems, currentPage * effectiveSize);

  return {
    pagedItems,
    currentPage,
    totalPages,
    totalItems,
    startItem,
    endItem,
    pageSize: effectiveSize,
    setPage,
  };
}

interface TablePaginationProps {
  lang: Language;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
  onPageChange: (page: number) => void;
}

export function TablePagination({
  lang,
  currentPage,
  totalPages,
  totalItems,
  startItem,
  endItem,
  onPageChange,
}: TablePaginationProps) {
  if (totalItems === 0) return null;

  const isAr = lang === 'ar';
  const PrevIcon = isAr ? ChevronRight : ChevronLeft;
  const NextIcon = isAr ? ChevronLeft : ChevronRight;

  // Build compact page number list with ellipsis
  const pages: Array<number | 'ellipsis-start' | 'ellipsis-end'> = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i += 1) pages.push(i);
  } else {
    pages.push(1);
    const left = Math.max(2, currentPage - 1);
    const right = Math.min(totalPages - 1, currentPage + 1);
    if (left > 2) pages.push('ellipsis-start');
    for (let i = left; i <= right; i += 1) pages.push(i);
    if (right < totalPages - 1) pages.push('ellipsis-end');
    pages.push(totalPages);
  }

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50/60 dark:bg-slate-950/30">
      <div className="text-slate-600 dark:text-slate-400 tabular-nums">
        {isAr ? (
          <>
            عرض <span className="font-mono font-semibold text-slate-900 dark:text-white">{startItem}</span>–
            <span className="font-mono font-semibold text-slate-900 dark:text-white">{endItem}</span> من{' '}
            <span className="font-mono font-semibold text-slate-900 dark:text-white">{totalItems}</span>
            <span aria-hidden="true" className="mx-1.5">·</span>
            صفحة <span className="font-mono font-semibold">{currentPage}</span> من{' '}
            <span className="font-mono font-semibold">{totalPages}</span>
          </>
        ) : (
          <>
            Showing <span className="font-mono font-semibold text-slate-900 dark:text-white">{startItem}</span>–
            <span className="font-mono font-semibold text-slate-900 dark:text-white">{endItem}</span> of{' '}
            <span className="font-mono font-semibold text-slate-900 dark:text-white">{totalItems}</span>
            <span aria-hidden="true" className="mx-1.5">·</span>
            Page <span className="font-mono font-semibold">{currentPage}</span> of{' '}
            <span className="font-mono font-semibold">{totalPages}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
        >
          <PrevIcon className="w-3.5 h-3.5" />
          <span>{isAr ? 'السابق' : 'Prev'}</span>
        </button>

        {pages.map((entry) =>
          typeof entry === 'string' ? (
            <span
              key={entry}
              className="px-1.5 text-slate-400 font-mono select-none"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onPageChange(entry)}
              className={`min-w-[30px] h-[30px] px-2 rounded-lg border font-mono text-xs font-semibold transition-colors tabular-nums shrink-0 ${
                entry === currentPage
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {entry}
            </button>
          )
        )}

        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
        >
          <span>{isAr ? 'التالي' : 'Next'}</span>
          <NextIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
