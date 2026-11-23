import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  KeyRound,
  Printer,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type {
  DecodedTlvTag,
  Invoice,
  Language,
  OrganizationSettings,
  ZatcaMode,
} from '../types';
import { formatDateTime, formatMoney, translations } from '../i18n';
import { QrCodeCanvas } from './QrCodeCanvas';

interface ZatcaCenterViewProps {
  lang: Language;
  authToken: string;
  settings: OrganizationSettings;
  invoices: Invoice[];
  onUpdateSettings: (payload: Partial<OrganizationSettings>) => Promise<void>;
  onGenerateKeys: () => Promise<void>;
  onOnboardStep: (action: 'request_ccsid' | 'compliance_check' | 'request_pcsid', otp?: string) => Promise<void>;
  onRetryInvoice: (id: number) => Promise<void>;
  onOpenReceipt: (invoice: Invoice) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function ZatcaCenterView({
  lang,
  authToken,
  settings,
  invoices,
  onUpdateSettings,
  onGenerateKeys,
  onOnboardStep,
  onRetryInvoice,
  onOpenReceipt,
  onNotify,
}: ZatcaCenterViewProps) {
  const t = translations[lang];
  const isAr = lang === 'ar';

  const [subTab, setSubTab] = useState<'invoices' | 'onboarding' | 'qr_decoder'>('invoices');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(invoices[0] ?? null);
  const [decodedTags, setDecodedTags] = useState<DecodedTlvTag[]>([]);
  const [qrInput, setQrInput] = useState<string>(invoices[0]?.qr_tlv_base64 ?? '');
  const [otpInput, setOtpInput] = useState<string>('123345');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [orgForm, setOrgForm] = useState({
    name_ar: settings.name_ar,
    name_en: settings.name_en,
    vat_number: settings.vat_number,
    cr_number: settings.cr_number,
    street_ar: settings.street_ar,
    building_no: settings.building_no,
    city_ar: settings.city_ar,
    postal_code: settings.postal_code,
    egs_serial: settings.egs_serial,
    mode: settings.mode as ZatcaMode,
  });

  useEffect(() => {
    setOrgForm({
      name_ar: settings.name_ar,
      name_en: settings.name_en,
      vat_number: settings.vat_number,
      cr_number: settings.cr_number,
      street_ar: settings.street_ar,
      building_no: settings.building_no,
      city_ar: settings.city_ar,
      postal_code: settings.postal_code,
      egs_serial: settings.egs_serial,
      mode: settings.mode,
    });
  }, [settings]);

  useEffect(() => {
    if (selectedInvoice) {
      const updated = invoices.find((i) => i.id === selectedInvoice.id);
      if (updated) setSelectedInvoice(updated);
    } else if (invoices.length > 0) {
      setSelectedInvoice(invoices[0]);
    }
  }, [invoices, selectedInvoice]);

  useEffect(() => {
    const targetQr =
      subTab === 'qr_decoder'
        ? qrInput
        : selectedInvoice?.qr_tlv_base64 ?? '';
    if (!targetQr.trim()) {
      setDecodedTags([]);
      return;
    }
    fetch('/api/zatca/decode-qr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ qr: targetQr }),
    })
      .then((r) => r.json())
      .then((d: { tags?: DecodedTlvTag[] }) => setDecodedTags(d.tags ?? []))
      .catch(() => setDecodedTags([]));
  }, [selectedInvoice, qrInput, subTab, authToken]);

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('save_org');
    try {
      await onUpdateSettings(orgForm);
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    onNotify(isAr ? `تم نسخ ${label}` : `Copied ${label}`);
  };

  const handleDownloadXml = (inv: Invoice) => {
    const blob = new Blob([inv.xml_content], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${inv.invoice_number}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runOnboard = async (action: 'request_ccsid' | 'compliance_check' | 'request_pcsid') => {
    setBusyAction(action);
    try {
      await onOnboardStep(action, otpInput);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t.zatcaTitle}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span className="font-mono">{settings.vat_number}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{settings.egs_serial}</span>
            <span aria-hidden="true">·</span>
            <span>
              {settings.mode === 'fatoora_simulation' ? t.modeFatoora : t.modeSimulator}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {isAr ? `آخر ICV: #${settings.last_icv}` : `Last ICV: #${settings.last_icv}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setSubTab('invoices')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              subTab === 'invoices'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.zatcaInvoicesTab}
          </button>
          <button
            type="button"
            onClick={() => setSubTab('onboarding')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              subTab === 'onboarding'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.zatcaOnboardingTab}
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedInvoice) setQrInput(selectedInvoice.qr_tlv_base64);
              setSubTab('qr_decoder');
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              subTab === 'qr_decoder'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.zatcaQrDecoderTab}
          </button>
        </div>
      </div>

      {/* TAB 1: E-Invoices & UBL 2.1 XML Ledger */}
      {subTab === 'invoices' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-3 text-start font-medium">{t.icvCol}</th>
                  <th className="py-3 px-3 text-start font-medium">{t.invNoCol}</th>
                  <th className="py-3 px-3 text-start font-medium">{t.typeCol}</th>
                  <th className="py-3 px-3 text-end font-medium">{t.totalCol}</th>
                  <th className="py-3 px-3 text-start font-medium">{t.zatcaStatusCol}</th>
                  <th className="py-3 px-3 text-end font-medium">{t.actionsCol}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoices.map((inv) => {
                  const isSelected = selectedInvoice?.id === inv.id;
                  const statusColor =
                    inv.zatca_status === 'CLEARED' || inv.zatca_status === 'REPORTED'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : inv.zatca_status === 'REJECTED'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-600 dark:text-amber-400';

                  return (
                    <tr
                      key={inv.id}
                      onClick={() => setSelectedInvoice(inv)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-3 font-mono font-semibold tabular-nums">
                        #{inv.icv}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-mono font-semibold text-slate-900 dark:text-white">
                          {inv.invoice_number}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                          {formatDateTime(inv.created_at, lang)}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium">
                          {inv.invoice_type_code === '381'
                            ? isAr ? 'إشعار دائن (381)' : 'Credit Note'
                            : inv.invoice_subtype === '0100000'
                            ? isAr ? 'ضريبية B2B' : 'Standard B2B'
                            : isAr ? 'مبسطة B2C' : 'Simplified B2C'}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[140px]">
                          {inv.customer_name}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-end font-mono font-bold tabular-nums">
                        {formatMoney(inv.grand_total, lang)}
                      </td>
                      <td className={`py-3 px-3 font-mono font-semibold ${statusColor}`}>
                        {inv.zatca_status}
                      </td>
                      <td
                        className="py-3 px-3 text-end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenReceipt(inv)}
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            title={t.printBtn}
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          {(inv.zatca_status === 'PENDING' || inv.zatca_status === 'REJECTED') && (
                            <button
                              type="button"
                              onClick={() => onRetryInvoice(inv.id)}
                              className="p-1.5 rounded-md border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                              title={t.retryBtn}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Inspector Column */}
          <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            {selectedInvoice ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div>
                    <div className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                      {selectedInvoice.invoice_number}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      UUID: {selectedInvoice.uuid}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownloadXml(selectedInvoice)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    UBL 2.1 XML
                  </button>
                </div>

                {/* Cryptographic Chain */}
                <div className="space-y-2 text-xs">
                  <div>
                    <div className="text-slate-500 mb-0.5">Invoice Hash (SHA-256)</div>
                    <div className="font-mono text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 break-all">
                      {selectedInvoice.invoice_hash}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-0.5">Previous Invoice Hash (PIH)</div>
                    <div className="font-mono text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 break-all">
                      {selectedInvoice.previous_hash}
                    </div>
                  </div>
                </div>

                {/* QR + Decoded Tags Summary */}
                <div className="flex items-start gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <QrCodeCanvas value={selectedInvoice.qr_tlv_base64} size={112} className="shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {isAr ? 'محتوى رمز QR (TLV Tags)' : 'Decoded TLV QR Tags'}
                    </div>
                    <div className="space-y-1 max-h-28 overflow-y-auto text-[11px]">
                      {decodedTags.slice(0, 5).map((tag) => (
                        <div key={tag.tag} className="flex justify-between gap-2">
                          <span className="text-slate-500 shrink-0">
                            T{tag.tag} ({isAr ? tag.label_ar : tag.label_en}):
                          </span>
                          <span className="font-mono truncate">{tag.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* UBL 2.1 XML Code Preview */}
                <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      <FileCode2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                      UBL 2.1 XML (KSA-EN 16931)
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(selectedInvoice.xml_content, 'XML')}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                      <Copy className="w-3 h-3" />
                      {t.copyCode}
                    </button>
                  </div>
                  <pre
                    dir="ltr"
                    className="text-[11px] font-mono bg-slate-950 text-slate-100 rounded-lg p-3 max-h-64 overflow-auto leading-relaxed"
                  >
                    {selectedInvoice.xml_content}
                  </pre>
                </div>
              </>
            ) : (
              <div className="py-12 text-center text-xs text-slate-500">
                {isAr ? 'اختر فاتورة لعرض تفاصيل XML والتشفير' : 'Select an invoice to inspect XML and hashes'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: EGS Onboarding & Organization Settings */}
      {subTab === 'onboarding' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Organization & Connection Mode Form */}
          <form
            onSubmit={handleSaveOrg}
            className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-3">
              {isAr ? 'بيانات المنشأة ونمط الربط مع فاتورة' : 'Taxpayer Profile & Fatoora Mode'}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'وضع الربط والتشغيل' : 'ZATCA Integration Mode'}
                </label>
                <select
                  value={orgForm.mode}
                  onChange={(e) =>
                    setOrgForm({ ...orgForm, mode: e.target.value as ZatcaMode })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-medium"
                >
                  <option value="simulator">{t.modeSimulator}</option>
                  <option value="fatoora_simulation">{t.modeFatoora}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'اسم المنشأة (عربي)' : 'Legal Name (AR)'}
                </label>
                <input
                  required
                  type="text"
                  value={orgForm.name_ar}
                  onChange={(e) => setOrgForm({ ...orgForm, name_ar: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'اسم المنشأة (إنجليزي)' : 'Legal Name (EN)'}
                </label>
                <input
                  required
                  type="text"
                  value={orgForm.name_en}
                  onChange={(e) => setOrgForm({ ...orgForm, name_en: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'الرقم الضريبي (15 خانة)' : 'VAT Number (15 digits)'}
                </label>
                <input
                  required
                  type="text"
                  value={orgForm.vat_number}
                  onChange={(e) => setOrgForm({ ...orgForm, vat_number: e.target.value })}
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'رقم السجل التجاري' : 'CR Number'}
                </label>
                <input
                  required
                  type="text"
                  value={orgForm.cr_number}
                  onChange={(e) => setOrgForm({ ...orgForm, cr_number: e.target.value })}
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'المدينة' : 'City'}
                </label>
                <input
                  required
                  type="text"
                  value={orgForm.city_ar}
                  onChange={(e) => setOrgForm({ ...orgForm, city_ar: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'الرقم التسلسلي للجهاز (EGS)' : 'EGS Serial Number'}
                </label>
                <input
                  required
                  type="text"
                  value={orgForm.egs_serial}
                  onChange={(e) => setOrgForm({ ...orgForm, egs_serial: e.target.value })}
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={busyAction === 'save_org'}
                className="px-4 py-2 text-xs font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg hover:opacity-90 transition-opacity"
              >
                {isAr ? 'حفظ إعدادات المنشأة' : 'Save Taxpayer Settings'}
              </button>
            </div>
          </form>

          {/* 4-Step CSID Lifecycle */}
          <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-3">
              {isAr ? 'دورة حياة شهادة الربط مع هيئة الزكاة (CSID)' : 'ZATCA CSID Onboarding Lifecycle'}
            </h2>

            {/* Step 1 */}
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold">
                  <KeyRound className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>
                    {isAr
                      ? '01. توليد مفاتيح ECDSA (secp256k1) وطلب CSR'
                      : '01. Generate ECDSA (secp256k1) Keypair & CSR'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onGenerateKeys}
                  className="px-3 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-md whitespace-nowrap"
                >
                  {isAr ? 'توليد جديد' : 'Generate Keys'}
                </button>
              </div>
              {settings.csr_pem && (
                <pre
                  dir="ltr"
                  className="text-[10px] font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-2 max-h-20 overflow-auto text-slate-600 dark:text-slate-400"
                >
                  {settings.csr_pem}
                </pre>
              )}
            </div>

            {/* Step 2 */}
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold">
                  {isAr ? '02. طلب شهادة الامتثال (CCSID) عبر OTP' : '02. Request Compliance CSID (CCSID)'}
                </div>
                {settings.ccsid_token && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value)}
                  placeholder="Fatoora OTP (e.g. 123345)"
                  className="flex-1 text-xs font-mono px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
                <button
                  type="button"
                  disabled={busyAction === 'request_ccsid'}
                  onClick={() => runOnboard('request_ccsid')}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-md whitespace-nowrap"
                >
                  {isAr ? 'طلب CCSID' : 'Issue CCSID'}
                </button>
              </div>
              {settings.ccsid_token && (
                <div className="text-[11px] font-mono text-slate-500 truncate">
                  Token: {settings.ccsid_token} · ReqID: {settings.ccsid_request_id}
                </div>
              )}
            </div>

            {/* Step 3 */}
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold">
                  {isAr ? '03. فحص فواتير الامتثال (388 / 381 / 383)' : '03. Compliance Invoice Verification'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {settings.onboarding_step >= 3
                    ? isAr ? 'تم اجتياز فحص جميع أنماط الفواتير' : 'All 4 invoice profiles verified'
                    : isAr ? 'مطلوب قبل الترقية لشهادة الإنتاج' : 'Required before PCSID'}
                </div>
              </div>
              <button
                type="button"
                disabled={busyAction === 'compliance_check'}
                onClick={() => runOnboard('compliance_check')}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md whitespace-nowrap"
              >
                {isAr ? 'تشغيل الفحص' : 'Run Check'}
              </button>
            </div>

            {/* Step 4 */}
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold">
                  <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>
                    {isAr ? '04. إصدار شهادة الإنتاج الدائمة (PCSID)' : '04. Issue Production CSID (PCSID)'}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busyAction === 'request_pcsid'}
                  onClick={() => runOnboard('request_pcsid')}
                  className="px-3 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-md whitespace-nowrap"
                >
                  {isAr ? 'إصدار PCSID' : 'Issue PCSID'}
                </button>
              </div>
              {settings.pcsid_token && (
                <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 truncate">
                  Active PCSID: {settings.pcsid_token}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: TLV QR Code Decoder & Verifier */}
      {subTab === 'qr_decoder' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold">
              <QrCode className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>{isAr ? 'نص Base64 لرمز الاستجابة السريعة (TLV)' : 'TLV Base64 QR Payload'}</span>
            </div>

            <textarea
              dir="ltr"
              rows={5}
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              placeholder="Paste ZATCA TLV Base64 string..."
              className="w-full text-xs font-mono p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />

            <div className="flex items-center justify-between gap-4 pt-2">
              <QrCodeCanvas value={qrInput} size={136} />
              <div className="flex-1 space-y-1.5 text-xs">
                <div className="font-semibold text-slate-700 dark:text-slate-200">
                  {isAr ? 'تحميل من فواتير سابقة:' : 'Load from recent invoices:'}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {invoices.slice(0, 4).map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => setQrInput(inv.qr_tlv_base64)}
                      className="px-2.5 py-1 text-[11px] font-mono rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {inv.invoice_number}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-bold text-sm">
              {isAr ? 'الحقول المستخرجة (ZATCA TLV Tags 1–9)' : 'Decoded ZATCA TLV Tags (1–9)'}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {decodedTags.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  {isAr ? 'أدخل نص Base64 صالح لفك ترميز الحقول' : 'Enter a valid Base64 TLV string to decode'}
                </div>
              ) : (
                decodedTags.map((tag) => (
                  <div key={tag.tag} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="font-medium text-slate-700 dark:text-slate-200 shrink-0">
                      <span className="font-mono text-emerald-700 dark:text-emerald-400 me-2">
                        Tag {tag.tag}
                      </span>
                      {isAr ? tag.label_ar : tag.label_en}
                    </div>
                    <div
                      dir="ltr"
                      className="font-mono text-[11px] text-slate-600 dark:text-slate-300 break-all sm:text-end"
                    >
                      {tag.value}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
