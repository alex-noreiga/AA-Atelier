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
online via a single endpoint `POST /orders/:n/payments/:stage` (`stage ∈
{first_deposit, second_deposit, balance}`). The order row keeps **only** the
`Invoices` relation for finances — `orders.schema.ts` has no deposit constants
(the only code using the deposit field names is `invoice.schema.ts`, against the
**invoices & payments** data source).

Two later cleanups finished squaring the Notion schema with that intent:

- **Removed the dead Client CRM `Total Deposits` rollup** — it summed a deposit
  number field on the order that the migration deleted, so it pointed at a missing
  target and rendered blank. The CRM only relates to Order Tracking (not to
  `invoices & payments`, where the amounts now live) and **no app code reads it**
  (the CRM is write-only from the app), so it was dropped, not rebuilt. To restore
  a per-client deposit total: add a deposits-sum formula on `invoices & payments`,
  a rollup on the order pulling it via the `Invoices` relation, then repoint a CRM
  rollup through `Orders`.
- **Removed five orphaned deposit fields** the order still carried
  (`First/Second Deposit Amount`, `First/Second Deposit Paid`, `First Deposit
Session Id`) — parallel copies of the invoice fields that the migration missed
  (the earlier pass deleted a different, older deposit number field). Nothing read
  or wrote them on the order; one test order held stale fossil values from the old
  write path. Gone now, so the order genuinely keeps only the `Invoices` relation.

## The pre-existing Notion model (do not recreate)

Discovered during planning — the orders database already relates to a full
finance system under the "finances" page:

- **`invoices & payments`** (one invoice per order): `Invoice ID` (title),
  `Payment Deadline`, `Final Balance` (sums line-item `Line Total`), `Line Items`
  (relation), `Order` (relation, limit 1). (The original `Deposit Status`
  status property is **gone** — superseded by the `Payment Status` formula, see
  the 2026-07-19 note below.)
- **`Invoice Line Items`**: `Line Item` (title), `Line Type` (select: **Garment /
  Material / Labor / Adjustment**), `Quantity`, `Manual Unit Price`,
  `Unit Price` (formula), `Line Total` (formula), relations to Order / Invoice /
  Costing Item / Material Usage Line. ("Deposit" was retired as a line type —
  deposits live on the invoice head.)
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
Amount/Paid/Session Id/Due`, `Balance Paid`/`Balance Payment Session Id`, and
   `Payment Deadline` sit on "invoices & payments", plus three atelier-facing
   formulas the app does **not** read (`Paid to Date`, `Remaining to Collect`,
   `Payment Status`). The app reads a deposit's amount from its field; the balance
   is computed from the line items (below). Property names live in
   `lib/notion/invoice.schema.ts` (`DEPOSIT_STAGE_FIELDS` / `stagePaymentFields`
   map stage → field names).

3. **Balance is computed from the line items, NOT `Final Balance`.**
   `balanceDue = Σ(Line Totals) − Σ(deposits marked paid on the
invoice)`, floored at 0 (`buildInvoiceView`). `Line Type = Deposit` lines are
   **excluded** from the subtotal — deposits are payments against the total, not
   line items. That option no longer exists in Notion, so `LINE_TYPE_DEPOSIT` is
   now a **guard**, deliberately kept: without it, re-adding the option would bill
   a customer for their own deposit. Note `Final Balance` has no such filter, so
   the app and the atelier's view agree only while no Deposit line exists.

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

## 2026-07-19 audit — `Payment Status` was silently dead

The atelier had since replaced `Deposit Status` with three formulas. Two were
correct (`Paid to Date`, `Remaining to Collect` — verified to agree with the app's
`balanceDue`, since `Final Balance` == the app's subtotal while no Deposit line
items exist). The third, **`Payment Status`, had never worked**: it called
`dateBefore(x, now())`, which is not a Notion function, so the property errored to
empty and the atelier never got an overdue signal. Fixed by rewriting it as nested
`if()`s using `x < now()`.

Two gotchas worth keeping, both learned the hard way:

- **Notion's API formula compiler rejects `ifs()`** ("Type error with formula") even
  though the UI accepts it — use nested `if()`. Comparisons inside a boolean chain
  need parens: `a and (b < c)`.
- **Don't edit Notion formulas via a browser-automation pane.** Typing sometimes
  lands but `Backspace`/`Cmd+Z` silently don't, so you can get stuck mid-edit. Use
  `notion-update-data-source` → `ALTER COLUMN "X" SET FORMULA('…')` with
  `prop("Name")` references; it validates before writing, so a bad expression 400s
  and changes nothing. Test on a throwaway `ADD COLUMN` first, then `DROP` it.

Also note `Final Balance` has been both a rollup and a formula; `extractNumericValue`
reads either, so the app is indifferent. Overdue triggers at midnight on the due
date (the due dates are date-only).

## 2026-07 — generating line items from the costing (the double-charge fix)

Itemizing by hand double-charged: the `costing (custom orders)` item is a
whole-garment aggregate (`Suggested Price` folds in materials + labor + margin),
and an `Invoice Line Item` linked to it prices at that aggregate — so a
costing-item line **plus** separate material/labor lines bills the same money
twice. Worse, the line-item `Unit Price` formula resolves **Costing Item before
Material Usage Line**, so a "Material" line linked to both silently pulls the
whole-garment price (this is what the "Toothless" test invoice showed).

Fix = the app owns itemization. `GET /api/invoices/generate-line-items`
(`?order=`, CRON_SECRET, outside the OpenAPI contract; on-demand `/run` variant
is a Notion formula-link the atelier clicks) reads the order's costing and writes:
one **Material** line per non-packaging material usage line (at its `Line Material
Cost`), one **Labor** line (summed costing `Labor Cost`), and one reconciling
**Adjustment** line "Design & finishing" = Σ(`Suggested Price`) − (materials +
labor). The adjustment folds the margin in so the itemized total lands exactly on
the costing's `Suggested Price`, regardless of what that formula includes.

Load-bearing:

- **Every generated line prices via `Manual Unit Price` (qty 1) and never links
  the `Costing Item`.** Manual price is the top of the `Unit Price` precedence, so
  the line total is exactly the amount computed; not linking the costing item is
  what makes the aggregate-vs-components double charge structurally impossible.
  (`lib/notion/invoice-line-items.blocks.ts`.)
- **Idempotent via the existing-lines guard.** If the invoice already has any line
  items, generation is skipped (only the title is reconciled) — a re-press never
  duplicates. To regenerate, delete the lines and press again.
- **Title = the `ORD-` number.** `setInvoiceTitle` sets `Invoice ID`. Display-only
  (lookup is via the order's `Invoices` relation, never the title), so it's safe.
- **Packaging usage lines are skipped** (`USAGE_TYPE_PACKAGING` — an internal cost,
  not itemized to the customer).
- **`Suggested Price`'s formula is CORRECT; its description is stale.** The Notion
  description still reads "Break-even price + labor cost," but the real formula is
  `round(Break Even × (1 + margin) / (Production ? 1 − sellingFees : 1), 2)` —
  markup-on-cost, grossing up fees on Production rows only. Do **not** rewrite the
  formula to match the description. (The description text can't be edited via the
  Notion API's `update-data-source` DDL — it's a manual UI fix.)

New env: `NOTION_COSTING_DATABASE_ID`, `NOTION_MATERIAL_USAGE_DATABASE_ID`
(integration shared with both). Traversal is order → `Costing Items` → each
costing item's `Material Usage Lines`, all by relation page-id fetch (no queries).

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
- Frontend: `components/custom-order-result.tsx` (`DepositsSection` — deposit cards
  - "View Invoice"; rendered by the unified `pages/track.tsx`), `pages/invoice.tsx`
    (the document + balance pay), shared `components/receipt-row.tsx`.
