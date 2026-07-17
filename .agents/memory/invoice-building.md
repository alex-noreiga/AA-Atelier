# Custom-order payments — the invoice is the source of truth for all three stages

## What this is

Custom orders are paid online in **three staged payments**: a **first deposit**
(after the sketch is finalized), a **second deposit** (at the first fitting), and
the **final balance** (after delivery = itemized **materials + labor** minus both
deposits). All three are owned by the order's Notion **invoice** ("invoices &
payments"); the app **reads** the costing and collects each stage via Stripe. It
does **not** own or recompute the costing.

## 2026-07 migration — deposits moved onto the invoice (source of truth)

Originally deposits lived on the **order** (`Deposit Amount`/`Deposit Paid`,
`Deposit 2 …`, `Invoice Paid`/`Invoice Session Id`) and only the balance was
invoice-owned; only deposit 1 was payable online. That drifted from the live
Order Tracking Pipeline (which actually had `First/Second Deposit …`, not those
names) so the deposit charge + balance write-back were **broken against the real
DB**. Per the atelier's real flow (deposit → deposit → balance), everything a
customer pays online now lives on the **invoice** and all three stages are payable
online. The order row keeps only the `Invoices` relation — no deposit fields.
A single endpoint `POST /orders/:n/payments/:stage` (`stage ∈ {first_deposit,
second_deposit, balance}`) serves all three.

**Follow-up (2026-07): removed the dead Client CRM `Total Deposits` rollup.** That
rollup summed a deposit **number field on the order** that this migration deleted,
so once the field was gone it pointed at a missing target and rendered blank. The
CRM only relates to Order Tracking (not to `invoices & payments`, where the deposit
amounts now live), and **no app code reads `Total Deposits`** (the CRM is
write-only from the app), so the column was dropped rather than rebuilt as a
two-hop rollup. If a per-client deposit total is ever wanted again, add a
deposits-sum formula on `invoices & payments`, a rollup on the order pulling it via
the `Invoices` relation, then repoint a CRM rollup through `Orders`.

**Follow-up (2026-07-17): removed five orphaned deposit fields from the order.**
A later re-examination of the Order Tracking Pipeline found the order still carried
`First Deposit Amount`, `First Deposit Paid`, `First Deposit Session Id`,
`Second Deposit Amount`, and `Second Deposit Paid` — parallel copies of the invoice
fields that survived this migration (the earlier cleanup deleted a different, older
deposit number field, so these were missed both by the migration and by the initial
audit). They were orphaned: `orders.schema.ts` has no deposit constants and no app
code reads/writes them on the order (the only code using these names is
`invoice.schema.ts`, against the **invoices & payments** data source). One test
order still held stale fossil values (`First Deposit Amount=200 / Paid / a
`cs_test_…` session id`) from the old pre-migration write path. All five were
dropped, so the order row now genuinely keeps **only** the `Invoices` relation for
finances, as intended above.

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

2. **Deposits + balance all live on the invoice.** `First/Second Deposit
Amount/Paid/Session Id`, `Balance Paid`/`Balance Payment Session Id`, and a
   `Balance Due` formula (for the atelier's own view) sit on "invoices & payments".
   The app reads a deposit's amount from its field; the balance is computed from
   the line items (below). Property names live in `lib/notion/invoice.schema.ts`
   (`DEPOSIT_STAGE_FIELDS` / `stagePaymentFields` map stage → field names).

3. **Balance is computed from the line items, NOT `Final Balance`.**
   `balanceDue = Σ(non-deposit Line Totals) − Σ(deposits marked paid on the
invoice)`, floored at 0 (`buildInvoiceView`). `Line Type = Deposit` lines are
   **excluded** from the subtotal — deposits are payments against the total, not
   line items, so they can't be double-counted. This deliberately avoids depending
   on whether the `Final Balance` rollup nets deposit lines. If the atelier ever
   wants `Final Balance` authoritative, revisit with populated data.

4. **All three stages are collected online, priced server-side.** `POST
/orders/:n/payments/:stage` → `createPaymentCheckout(orderNumber, stage)`. A
   deposit stage with no amount / an already-paid stage / (balance) an unready
   invoice all 400. There is no hard predecessor gate — a stage is payable when its
   amount is set and unpaid; balanceDue already nets whatever deposits are marked
   paid, so the amounts stay consistent regardless of order.

5. **Tax on the balance only.** The balance checkout sets `automatic_tax` +
   `tax_behavior: "exclusive"` + `billing_address_collection: "required"` (no
   shipping step to collect an address). Deposit stages stay untaxed.

6. **Deposits show early; the itemized balance is gated on "Invoice Ready".**
   `getOrderStatus` surfaces `deposits[]` (from the invoice head) as soon as an
   amount is set — payable before itemization. The `invoice` object (itemized
   balance) attaches only once "Invoice Ready" is ticked; the balance stage 400s
   until then.

7. **Write-back = invoice-only, idempotent.** The webhook (`kind:
"custom_payment"`, carrying `stage` + `invoicePageId`) calls `recordPayment` →
   `markInvoicePaid(invoice, stage, sessionId)`, ticking that stage's paid checkbox
   - session-id text on the invoice. Nothing is written to the order (that was the
     old broken path). Idempotent on Stripe redelivery; the paid checkbox is the
     "already paid" guard. The shop-success page skips clearing the cart for
     `custom_payment`.

## Where the code lives

- Notion adapter: `lib/notion/invoice.schema.ts` (readers, `InvoiceView`,
  `InvoiceDepositView`, `DEPOSIT_STAGE_FIELDS`, `PaymentStage`),
  `lib/notion/invoice.repository.ts` (`findInvoice`/`listInvoiceLineItems`/`markInvoicePaid`),
  clients in `lib/notion/client.ts`. The order keeps only the `Invoices` relation
  - `extractInvoiceRelationId` in `lib/notion/orders.schema.ts`.
- Service/routes: `services/invoice.service.ts` (`createPaymentCheckout`,
  `recordPayment`, `getInvoicePaymentInfo`, `buildInvoiceView`), `routes/orders.ts`
  (`POST /orders/:n/payments/:stage`), `routes/stripe-webhook.ts` (the
  `custom_payment` branch), `services/orders.service.ts` (`getOrderStatus`).
- Contract: `OrderStatus.deposits[]` + `Invoice`/`InvoiceLineItem`/`InvoiceDeposit`,
  plus `createOrderPayment` (`/orders/{n}/payments/{stage}`), in `lib/api-spec/openapi.yaml`.
- Frontend: `pages/status.tsx` (`DepositsSection` — deposit cards + "View Invoice"),
  `pages/invoice.tsx` (the document + balance pay), shared `components/receipt-row.tsx`.
