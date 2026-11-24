---
name: react-frontend
description: Use for any Mizan POS UI work - React components, pages, hooks, server-state with TanStack Query, the API client, forms and validation, i18n (Arabic RTL / English), money/date formatting, permission-gated UI, modals, tables, receipt printing, error boundaries, and frontend performance. Also use when editing src/App.tsx or src/components/*.tsx.
---

# React Frontend — Mizan POS

Rules for moving the UI toward `docs/ARCHITECTURE.md` §8. Follow the approval workflow in `CLAUDE.md` §2 before changing code.

## When to use / not use
- **Use:** screens, components, hooks, data fetching, forms, translations, printing, UI performance, accessibility.
- **Don't use for:** business calculations. Totals, VAT, stock, cost and reports belong on the server (`nodejs-backend`).

## Current state (read before editing)
- `src/App.tsx` holds a single `data` state loaded from `/api/bootstrap` plus 25 copy-pasted handlers.
  - **The handlers show a toast and then return normally on failure**, so components can't tell a failure from a success.
  - The result is bugs such as the cart being cleared when checkout fails (`PosTerminalView.tsx:268-283`).
- There is no router: sections are switched with `useState`, and `/i/:uuid` is matched with a regex in `App.tsx:61-68`.
- The token is kept in React state, so a page refresh logs the user out.
- God components: `ReportsCenterView.tsx` is 3,206 lines and `SalesView.tsx` is 1,702.
- There are about 1,000 inline `isAr ? … : …` ternaries, 14 copy-pasted modals, and duplicated business rules that disagree with each other.
- The only shared helper is `TablePagination.tsx`. Printing is a hidden iframe plus `doc.write`, and values are escaped correctly.

**Transitional rule (R1):** only fix the mutation contract and the safety issues: the cart, confirmations, double-submit. Don't restructure folders until R4.

## Target structure
```
web/app/            router.tsx · providers.tsx (QueryClient, I18n, Auth) · AppLayout.tsx
web/api/            client.ts (fetch wrapper) · queryKeys.ts
web/features/<f>/   pages/ · components/ · hooks/ · api.ts
web/ui/             Modal · ConfirmDialog · DataTable · KpiStrip · Tabs · SearchInput · FormField · MoneyInput · Toast
web/i18n/           ar.ts · en.ts · useT()
web/lib/            format.ts (Asia/Riyadh) · print.ts · csv.ts
```

## Core rules
1. **The server is the source of truth.** Never compute report numbers, cost of goods, payables or stock valuation in the browser. Display what the API returns. Cart totals may be *previewed* with `shared/money`, but the invoice the server returns is final.
2. **Mutations throw on failure.** Clear a cart, form or modal **only in `onSuccess`**.
3. **Disable submit buttons while pending** to prevent double submits. Ask for confirmation before irreversible actions (credit note, voiding a voucher, regenerating anything).
4. **Permission-gate the UI** with `hasPermission`, for UX only. The server enforces access.
5. **No inline translations.** Use `const t = useT(); t('pos.checkout')`. Keys are typed, so a missing key is a compile error.
6. **Format** through `formatMoney()` and `formatDate()` (Intl with `Asia/Riyadh`). Never call `toFixed` or `toISOString().slice(0,10)` for display or for "today".
7. **No magic strings:** import `DOCUMENT_TYPES` and `INVOICE_KINDS` from `shared/constants.ts`.
8. Keep components under about 400 lines. Extract hooks (`useCart`, `useDraftLines`) and use the `web/ui` primitives instead of copying markup.

## Recipe: data-backed page
```ts
// web/api/client.ts
export class ApiError extends Error { constructor(public status: number, public code: string, msg: string, public details?: unknown) { super(msg); } }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('X-CSRF-Token', readCsrfCookie());
  const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) authEvents.emit('expired');
    throw new ApiError(res.status, body?.error?.code ?? 'NETWORK', body?.error?.message ?? res.statusText, body?.error?.details);
  }
  return body?.data as T;
}
```
```ts
// web/features/vouchers/api.ts
export const useVouchers = (q: VoucherQuery) =>
  useQuery({ queryKey: ['vouchers', q], queryFn: () => api<Paged<VoucherDTO>>(`/vouchers?${toQs(q)}`) });
export const useCreateVoucher = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVoucherInput) => api<VoucherDTO>('/vouchers', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vouchers'] }),
  });
};
```
```tsx
// in a component: clear only after success; show the translated server error code otherwise
const create = useCreateVoucher();
<form onSubmit={handleSubmit((v) => create.mutate(v, { onSuccess: () => { reset(); onClose(); } }))}>
  …
  {create.error && <FormError code={(create.error as ApiError).code} />}
  <button disabled={create.isPending}>{t('common.save')}</button>
</form>
```

## Recipe: checkout (POS)
- Keep the cart in `useCart()` (local state, optionally persisted to `sessionStorage` to survive a refresh).
- Send `Idempotency-Key: crypto.randomUUID()` and generate it **once per checkout attempt**. Reuse the same key when retrying after a network error.
- On success: clear the cart, then open the receipt (auto-print if enabled). On `INSUFFICIENT_STOCK` or any other error: keep the cart and highlight the offending line using `error.details`.

## Forms
- Validate with the same zod schema the server uses (`shared/schemas`), via `@hookform/resolvers/zod` or a light equivalent.
- Show field errors next to their inputs. Keep a typed default-values object per form, in one place only (today the form defaults are duplicated 4 times).

## Modals & accessibility
- Always use `<Modal>`: it provides `role="dialog"`, `aria-modal`, focus trap, Escape to close and a labelled title. Use `<ConfirmDialog>` for destructive actions.
- RTL: use logical Tailwind classes (`ms-*`, `me-*`, `start-*`, `end-*`), mirror directional icons, and keep numbers `tabular-nums`.

## Printing
- Use one `ReceiptTemplate` component for the preview, the print output and `/i/:uuid`. Today there are three copies: `InvoiceReceiptModal.tsx:134-294` and `:531-684`, and `PublicInvoicePage.tsx`.
- Use one `printHtml()` in `web/lib/print.ts`: a sandboxed iframe (`allow-modals allow-same-origin`) with escaped values.
- Host fonts locally; don't load Google Fonts.
- Receipt QR: it encodes the absolute public invoice URL (`buildPublicInvoiceUrl`, D1/D8), so a phone camera opens `/i/:uuid`. The public page prints at full width (`.print-full-page`). A tax TLV QR may be added later (D7).

## Error handling & resilience
- Put an app-level `<ErrorBoundary>` and a per-route boundary in place, and render under `<StrictMode>`.
- `navigator.clipboard` may throw on non-HTTPS pages. Wrap it in try/catch and fall back to selecting the text.
- `JSON.parse` of stored or held data must be guarded.

## Performance
- Paginate on the server (`DataTable` with `page`/`pageSize`). Use search-as-you-type comboboxes, not `<select>` lists with every product.
- Lazy-load routes (`React.lazy`), especially reports. The POS bundle must stay small.
- Memoize only measured hot paths. Prefer moving heavy computation to the server.

## Anti-patterns already in this repo (don't copy them)
- Handlers that swallow errors (`App.tsx:300-303`, `:338-347`, `:379`, `:446`).
- A component calling `fetch` directly around the client (`ZatcaCenterView.tsx:115-125`, on every keystroke).
- Accounting computed in the browser from truncated data (`ReportsCenterView.tsx:414-2312`).
- Profit based on today's cost (`SalesView.tsx:137-143`).
- CSV export without formula-injection protection (`SalesView.tsx:380-411`).
- Font-size changes applied before save and never reverted (`InvoicesSettingsView.tsx:403`).

## Done checklist
- [ ] The owner approved the impact summary.
- [ ] No business math in the UI. Data comes from TanStack Query hooks through `api()`.
- [ ] The mutation clears or closes only on success, the submit button is disabled while pending, and destructive actions ask for confirmation.
- [ ] All text uses `t()`. RTL and LTR both checked. Money and dates go through `lib/format`.
- [ ] Uses the `web/ui` primitives; no copied modal or table markup. The component is under about 400 lines.
- [ ] Permission-gated where relevant, and the route guard is in place.
- [ ] Component or E2E test added or updated, and the real results reported.
