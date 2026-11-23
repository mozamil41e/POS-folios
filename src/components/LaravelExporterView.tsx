import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, FolderOpen } from 'lucide-react';
import type { Language, LaravelVirtualFile } from '../types';
import { translations } from '../i18n';

interface LaravelExporterViewProps {
  lang: Language;
  onNotify: (msg: string) => void;
}

export function LaravelExporterView({ lang, onNotify }: LaravelExporterViewProps) {
  const t = translations[lang];
  const isAr = lang === 'ar';

  const [files, setFiles] = useState<LaravelVirtualFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/laravel-files')
      .then((r) => r.json())
      .then((d: { files: LaravelVirtualFile[] }) => {
        setFiles(d.files);
        if (d.files.length > 0) {
          setSelectedPath(d.files[0].path);
        }
      })
      .catch(() => setFiles([]));
  }, []);

  const activeFile = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? files[0] ?? null,
    [files, selectedPath]
  );

  const handleCopy = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    onNotify(isAr ? `تم نسخ ${activeFile.path}` : `Copied ${activeFile.path}`);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {t.laravelTitle}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t.laravelSubtitle}
          </p>
        </div>

        <a
          href="/api/laravel-export"
          download="mizan-laravel-livewire-zatca.zip"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 self-start"
        >
          <Download className="w-4 h-4" />
          {t.downloadZip}
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* File Explorer Sidebar */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
            <FolderOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>mizan-laravel-pos/</span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
            {files.map((file) => {
              const isActive = activeFile?.path === file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`w-full text-start px-4 py-3 transition-colors block ${
                    isActive
                      ? 'bg-emerald-50/80 dark:bg-emerald-950/35'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FileCode2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span
                      dir="ltr"
                      className={`text-xs font-mono truncate ${
                        isActive
                          ? 'font-bold text-emerald-800 dark:text-emerald-300'
                          : 'text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {file.path}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                    {isAr ? file.description_ar : file.description_en}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Code Viewer */}
        <div className="lg:col-span-8 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
          {activeFile ? (
            <>
              <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div dir="ltr" className="text-xs font-mono font-semibold text-white truncate">
                    {activeFile.path}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">
                    {isAr ? activeFile.description_ar : activeFile.description_en}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors whitespace-nowrap shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? t.copied : t.copyCode}
                </button>
              </div>
              <pre
                dir="ltr"
                className="p-4 text-xs font-mono text-slate-100 overflow-auto max-h-[600px] leading-relaxed"
              >
                {activeFile.content}
              </pre>
            </>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">Loading files...</div>
          )}
        </div>
      </div>
    </div>
  );
}
