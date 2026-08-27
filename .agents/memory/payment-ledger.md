# The payment ledger (roadmap card 6a)

## What this is

An append-only `payments` table in Postgres: one row per movement of money
against an order. A charge is positive cents, a refund is negative, and rows are
never updated or deleted — an order's history is its rows in `paid_at` order and
its current position is their sum.

Code: `supabase/migrations/0005_payments.sql`,
`lib/db/payments.repository.ts` (I/O), `services/payment-ledger.service.ts` (the
best-effort layer the money paths call), and `src/scripts/backfill-payments.ts`.

## Why — and why this rather than the vendor the card named

Roadmap card 6 read "Move real invoicing to a finance tool … Stripe Invoicing or
QuickBooks". Tracing the code first showed the card's premise was half wrong, and
the split matters:

- **Totals are NOT hand-editable formulas, for the customer.** `buildInvoiceView`
  sums `Line Total` off rows the app itself wrote at `Manual Unit Price` qty 1.
  The app already owns that arithmetic.
- **But the studio's own figures DO read the formula.**
  `studio-analytics.service.ts` reads `invoice.finalBalance` (Notion's
  `Final Balance`) for `customBooked` / `invoicedTotal`, so the two views of one
  invoice are computed differently and agree only while no `Deposit` line item
  exists. Still true; not fixed by this card. Worth fixing separately — it is a
  small change, not a migration.
- **The payment LEDGER half was true and was the serious half** — but it is not
  formulas either. It was three checkboxes and three session-id text fields, with
  **no dates anywhere**.

The three defects that produced, ranked by what they cost:

1. **No timestamps.** `studio-analytics.service.ts:17` already documented this as
   the reason bespoke work can only be reported as _booked_ in the month the
   order came in, never as revenue in the month it was collected.
2. **Exactly three payments per order, forever.** A deposit split across two
   cards, half a balance, a retry after a decline — none representable.
3. **Refunds never landed.** `order-cancellation.service` reads the invoice to
   FIND the sessions, refunds them, and writes nothing back, so `Balance Paid`
   stays ticked on a fully-refunded order and `buildPayments` counts it as
   collected.

QuickBooks is the wrong end of the telescope (an accounting ledger, not a payment
surface — it belongs downstream as a sync FROM Stripe). Stripe Invoicing is a
close fit and buys immutability, numbering, tax on the document, credit notes and
dunning — but its model is one invoice, one payment, and the atelier's flow is one
total in three instalments, which ripples into `payment-labels`, the reminder
table, both refund services, `pages/invoice.tsx`, the PDF and every
`PaymentStage` in the contract. So: fix the ledger first, cheaply, in the
Postgres layer this repo already has; keep the vendor as a later, now-mechanical
option. This table is also the first and highest-value slice of roadmap card 18.

## Load-bearing decisions

1. **The sign is applied from `kind`, in one place.** Callers always pass a
   positive magnitude; `recordPaymentEntry` negates a refund. The DB repeats the
   rule as a check constraint, so a hand-run `insert` cannot introduce a row
   whose sign contradicts its label and quietly invert a month's takings.

2. **`external_id` is the idempotency key, and the index on it is PARTIAL.** It
   holds the Stripe object that uniquely identifies the movement — the Checkout
   session for a charge, the refund for a refund. The Stripe webhook is
   at-least-once, so without this a redelivery would append a second row and
   double-count revenue, which is precisely the failure the table exists to
   prevent. The index is `where external_id <> ''` so hand-recorded payments
   (which have none) stay repeatable — a deposit paid as two piles of cash is two
   rows. Consequence: the insert's `on conflict` clause **must repeat that
   predicate** or Postgres cannot infer the index and the statement errors.

3. **A $0 movement is refused, not written.** A fully-promo session captures
   nothing, so a zero row would change no total — and, worse, would burn that
   session's `external_id` so a later real charge on it could never be recorded.

4. **`paid_at` ≠ `recorded_at`, and that IS the feature.** `paid_at` is when the
   money moved; `recorded_at` defaults to `now()`. A payment backfilled months
   later still lands in the month it was collected. Where the payment intent is
   already expanded (the shop path, and the backfill) `paid_at` is the instant of
   the charge; otherwise it is the instant checkout was opened. The two differ by
   the minutes a customer spends typing a card, which decides exactly one thing —
   an order paid either side of midnight on the last of the month — so it is
   worth taking the exact value where it is free and not worth an extra Stripe
   round-trip where it isn't. The shop path added `payment_intent` to an expand
   list it was already sending.

5. **Every write is best-effort and never throws.** Each caller is either the
   Stripe webhook (a throw makes Stripe redeliver, and the redelivery
   early-returns at the dedupe guard — losing the very write it retried for) or a
   refund that has **already moved real money** (a throw would report a success
   as a failure). Failures log at **`error`**, not `warn`: a missed row does not
   announce itself, it silently understates a month, and nothing downstream can
   tell "no payment" from "a payment we failed to write". Same reasoning as the
   shop's order-lines write.

6. **Unconfigured Postgres is a no-op**, like every other degrade-safe caller —
   the payment itself is unaffected, there is simply no ledger. Note this is
   _unlike_ `restock_alerts` and `staff_availability`, which hard-require it.

7. **No foreign key to `order_index`.** That index is a best-effort write and may
   be missing rows; a ledger entry must never fail because a discovery index was
   incomplete. `order_number` is the join key.

8. **Refunds key on the REFUND id, not the payment intent.** So a return refunded
   in two parts (a restocking-fee partial, later topped up to full) lands as two
   rows that sum to what the customer actually got back — which the single
   `Refunded Amount` number on the Notion order can never show.

9. **The refund's order context rides on `RefundTarget`.** `refundCheckoutSession`
   is handed the order number and stage rather than looking them up, because only
   its caller knows which order a session belonged to.

## The backfill is not optional

The ledger starts empty and **Stripe is the only place the history exists** — the
Notion invoice has no dates at all, which is the whole problem. Without a
backfill, every month before deploy day reads as zero and the dashboard looks
broken.

    STRIPE_SECRET_KEY=… POSTGRES_URL_NON_POOLING=… \
      pnpm --filter @workspace/api-server db:backfill-payments -- --dry-run

Two sweeps — Checkout sessions (→ charges, attributed from the same
`metadata.orderNumber` / `metadata.kind` / `metadata.stage` the live webhook
reads) then refunds (attributed via the payment-intent → order map built during
sweep 1). A refund matching no swept session is **reported, never guessed at**: a
misattributed refund understates one order and overstates another. Idempotent by
the same `external_id` index, so it is safe to re-run and safe to run against a
ledger the live path is already writing to. **Run it with the LIVE Stripe key** —
it reads whichever mode the key belongs to.

## What is deliberately NOT done yet

- **Nothing reads the ledger.** The capture side is complete; the payoff needs
  `studio-analytics.service.ts` to compute custom revenue by `paid_at` instead of
  attributing `Final Balance` to the order's month. That is a contract change
  (`StudioAnalytics`) plus the studio page, and was kept separate.
- **No offline-payment entry.** Cash at a fitting still gets recorded by ticking
  the Notion checkbox, which writes no ledger row. The table already supports it
  (`method`, `recorded_by`, no `external_id`); it needs a studio tool.
- **Notion is still a second writer.** The `… Paid` checkboxes remain
  hand-tickable and are still what `getInvoicePaymentInfo` and the analytics
  read. The intended end state is that they become app-written mirrors of the
  ledger with one writer; until then the two can disagree, and the ledger is the
  one with dates.
- **The `finalBalance` vs `Σ(line totals)` split** described above is untouched.
