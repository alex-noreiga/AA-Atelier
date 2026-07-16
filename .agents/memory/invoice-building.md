# Custom-order invoices — surfacing the atelier's Notion invoice + collecting the balance

## What this is

Custom orders are billed as: itemized **materials + labor**, minus the **deposits
already paid**, = the **balance** the customer pays online. The atelier already
built the whole costing/invoice model in Notion; the app **reads** it and adds a
customer-facing invoice page + a Stripe balance payment. It does **not** own or
recompute the costing.

## The pre-existing Notion model (do not recreate)

Discovered during planning — the orders database already relates to a full
finance system under the "finances" page:

- **`invoices & payments`** (one invoice per order): `Invoice ID` (title),
  `Deposit Status` (Paid/Pending/Partial), `Payment Deadline`, `Final Balance`
  (rollup summing line-item `Line Total`), `Line Items` (relation), `Order`
  (relation, limit 1).
- **`Invoice Line Items`**: `Line Item` (title), `Line Type` (select: **Garment /
  Material / Labor / Deposit / Adjustment**), `Quantity`, `Manual Unit Price`,
  `Unit Price` (formula), `Line Total` (formula), relations to Order / Invoice /
  Costing Item / Material Usage Line.
- **`costing (custom orders)`**, **`material usage database`**, **`materials
inventory`**: feed the line-item prices. The per-material breakdown (main
  fabric, crystal/rhinestones, appliqué…) lives here and surfaces as individual
  `Line Type = Material` rows. The app reads only the priced `Invoice Line Items`.

## Load-bearing decisions

1. **App reads, doesn't recompute.** `getOrderStatus` follows the order's
   `Invoices` relation → the invoice → its line items. Env: `NOTION_INVOICES_DATABASE_ID`,
   `NOTION_INVOICE_LINE_ITEMS_DATABASE_ID`. The app's `NOTION_API_KEY` integration
   must be shared with both databases (a different identity than the Notion MCP
   used to edit the schema).

2. **Balance is computed from the line items, NOT `Final Balance`.**
   `balanceDue = Σ(non-deposit Line Totals) − Σ(paid deposits)`, floored at 0
   (`buildInvoiceView` in `services/invoice.service.ts`). `Line Type = Deposit`
   lines are **excluded** from the subtotal — deposits are credited from the
   order's paid-deposit amounts instead, so they can't be double-counted. This
   deliberately avoids depending on whether the `Final Balance` rollup nets
   deposit lines (there was no real invoice data to confirm at build time; the one
   existing invoice was a test stub). If the atelier ever wants `Final Balance`
   authoritative, revisit with populated data.

3. **Only the balance is collected online.** Deposits are collected however the
   atelier does today and tracked on the **order** (`Deposit Amount`/`Deposit Paid`
   = deposit 1; new `Deposit 2 Amount`/`Deposit 2 Paid` = deposit 2). The existing
   deposit-1 Stripe flow and `DepositSection` are untouched. Only paid deposits
   credit the balance.

4. **Tax on the balance only.** The invoice checkout sets `automatic_tax` +
   `tax_behavior: "exclusive"` + `billing_address_collection: "required"` (no
   shipping step to collect an address). Deposits stay untaxed.

5. **Gate = "Invoice Ready" checkbox** on the invoice. `getOrderStatus` attaches
   the `invoice` object (and the frontend shows "View Invoice" → `/invoice/:orderNumber`)
   only once it's ticked. `createInvoiceCheckout` 400s until then.

6. **Write-back = order + invoice, idempotent.** On a paid balance the webhook
   (`kind: "invoice"`) calls `markBalancePaid`, which sets `Invoice Paid` +
   `Invoice Session Id` on the order and `Balance Paid` + `Balance Payment Session
Id` on the invoice. Only these plain checkbox/text fields are written — never
   the costing formulas/rollups. Idempotent on Stripe redelivery; `Balance Paid`
   is the "already paid" guard.

## Where the code lives

- Notion adapter: `lib/notion/invoice.schema.ts` (readers + `InvoiceView`),
  `lib/notion/invoice.repository.ts` (`findInvoice`/`listInvoiceLineItems`/`markBalancePaid`),
  new clients in `lib/notion/client.ts`; order-side fields/extractors in `lib/notion/schema.ts`.
- Service/routes: `services/invoice.service.ts`, `routes/orders.ts`
  (`POST /orders/:n/invoice`), `routes/stripe-webhook.ts` (the `invoice` branch),
  `services/orders.service.ts` (`getOrderStatus` attaches the invoice).
- Contract: `Invoice`/`InvoiceLineItem`/`InvoiceDeposit` on `OrderStatus`, plus
  `createInvoicePayment`, in `lib/api-spec/openapi.yaml`.
- Frontend: `pages/invoice.tsx` (the document), the status page's "View Invoice"
  card, shared `components/receipt-row.tsx`.
