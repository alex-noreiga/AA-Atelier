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

## Recording a payment taken outside Stripe (the `record-payment` tool)

The Stripe paths capture every payment a card touched, which left a hole exactly
the shape of how a local skater actually pays. `/studio` → **Record a payment**
is that hole closed: `POST /api/studio/tools/record-payment` with an order
number, an amount, a method (`cash` / `check` / `transfer` / `other`), the date
it arrived, and — on a custom order — which stage it covers. Code:
`services/payment-record.service.ts`, the `record-payment` runner in
`services/studio-tools.service.ts`, and the card in
`web-app/src/components/studio-tools.tsx`.

1. **It fails LOUDLY, unlike every other ledger write.** The Stripe writes are
   best-effort because the payment succeeded either way. Here the row IS the
   work, so an unconfigured `POSTGRES_URL` is reported (as `attention`, with the
   fix named) rather than silently no-op'd, and an order number nobody holds is a
   404 — on a Stripe path a typo'd number is impossible, but this is a hand-typed
   field and a payment filed against a number nobody holds is money the studio
   believes it has and cannot find.

2. **The stage settles from the LEDGER, not on sight.** After the row is
   written the service sums every ledger row for that stage — the Stripe charge
   as readily as the cash — and ticks `First/Second Deposit Paid` or
   `Balance Paid` only once the total covers the stage's amount. That condition
   is the point: a deposit taken as two piles of cash a fortnight apart flips the
   checkbox on the second, and the result says what is still outstanding after
   the first. A hand-ticked box could never express the halfway state, which is
   how a part-paid deposit came to read as settled.

3. **It marks the stage paid with a BLANK session id**, which is the established
   encoding for "paid outside Stripe" — `refundCheckoutSession` already reads a
   paid stage with no session id as "refund manually" rather than trying to
   refund a card that was never charged. Nothing new had to learn about offline
   payments.

4. **A date is anchored at MIDDAY in the studio's timezone.** The same date-only
   trap `orderedOn` documents: `2026-09-01` parsed as UTC midnight and read in
   `America/Chicago` lands on August 31, silently moving a payment into the
   previous month. Midday sits safely inside the day in every zone. A future date
   is refused — money cannot have arrived tomorrow, so it is always a typo, and
   it is the one typo that would put money in a month nobody looks at.

5. **`recordedBy` is stamped by the ROUTE from the verified staff session**, and
   is deliberately absent from the wire contract, so a caller cannot sign
   somebody else's name to a payment. (The generated zod body strips it anyway;
   the route then adds it. Two layers, one reason.)

6. **Everything after the row degrades rather than throws.** Reading the ledger
   back (to settle the stage and to show the history) happens _after_ the write,
   so a database blip there must not report a recorded payment as a failure and
   invite the atelier to record it twice. An unreadable ledger is a "can't tell":
   the stage stays unsettled and no outstanding figure is claimed. A failed
   Notion checkbox write is likewise surfaced in the result, not thrown.

7. **No `card` method, and no refunds.** A card payment goes through Stripe and
   records itself, so offering the option could only ever double-count. Money
   going back out is issued by the two refund tools, which record themselves; a
   cash refund handed over in person has no tool yet, and would want its own with
   its own confirmation rather than a sign toggle hidden in this one.

8. **A shop order records unstaged**, since it has no staged payments and no
   checkbox to settle — the row is the whole record. The dashboard hides the
   stage picker for an `SHP-` number using the same prefix test the server uses,
   so the card asks for exactly what the run will use.

9. **An order with no invoice yet still records**, keeping whatever stage was
   named, so the date isn't lost while the atelier gets to building the invoice
   and the row is already attributed when it appears.

**Atelier setup: none.** No env var, no new database, no Notion property — it
writes the same `payments` table and the same invoice checkboxes as before.

## Reading it: collected revenue on the dashboard

`StudioRevenueMonth` gained **`customCollected`**, and `StudioAnalytics` gained a
**`paymentLedger`** status block. Code: `buildRevenue` / `buildPaymentLedger` /
`readPaymentLedger` in `services/studio-analytics.service.ts`, and `RevenuePanel`
in `web-app/src/pages/studio.tsx`.

1. **`customBooked` was KEPT, not replaced.** It answers a question the collected
   figure can't — how much work was _won_ — and it is the figure that still works
   on an install whose ledger hasn't been backfilled. A commission booked in March
   and paid across April and June appears once in March's booked figure and twice
   in the collected one; both are right and their sum is nonsense, which is why
   the contract's own description says so. Replacing it would also have meant a
   deploy where every month read as zero until somebody ran a script.

2. **Shop revenue is deliberately NOT re-sourced from the ledger**, even though
   the ledger holds shop charges. It is already a collected, correctly-dated
   figure, and drawing the same number from two places is how the two come to
   disagree. So `buildRevenue` filters the ledger to `orderKind === "custom"`.
   Known cost: shop revenue still isn't netted of return refunds the way
   `customCollected` is — a cancelled order drops out, a returned one doesn't.

3. **The read is best-effort, unlike the three Notion scans beside it.** Those
   ARE the dashboard, so a failure is a 500 rather than a page of quiet zeroes.
   This one adds a column to figures that stand without it, so a Postgres blip
   reports `unavailable` and the rest of the page is unaffected.

4. **A nought is ambiguous, so it always travels with context.**
   `paymentLedger` carries `configured`, `unavailable`, a `payments` count for
   the window, and `recordedFrom` — the earliest month in the window holding a
   payment. That last one is the load-bearing one: it is the only thing that
   distinguishes "nothing came in that month" from "the ledger's records start
   later than that month", which is exactly what an install looks like before the
   backfill is run. `recordedFrom` is scoped to the WINDOW on purpose — a claim
   about anything outside it would be one the function hasn't read.

5. **The panel HIDES the collected bar rather than drawing it at zero** when the
   ledger can't answer, and prints one note saying which of the four states it is
   in. A nought bar reads as "nothing came in"; the truth is "we have no record".

6. **A month can be negative** — refunds are negative rows and are netted, which
   is what finally stops a refunded order counting as collected revenue. The
   figure is left signed rather than clamped (clamping would hide the refund
   where nobody could find it), with the accepted cost that `barHeight` floors a
   negative bar to nothing; the tooltip and the legend total carry the real
   number.

## What is deliberately NOT done yet

- **`buildPayments` still reads the Notion checkboxes.** Deposits-vs-balances is
  an _outstanding_ figure — what is still owed — which the ledger doesn't hold;
  it is the invoice's schedule that says what was expected. Left alone
  deliberately.
- **`finalBalance` vs `Σ(line totals)`.** The studio's `customBooked` reads
  Notion's `Final Balance` while the customer's invoice sums the line rows. They
  agree only while no `Deposit` line item exists. Untouched by any of this.
- **There is no ledger VIEW.** The `record-payment` result echoes the order's
  payment history back as detail lines, which is the only place the rows are
  readable today. A panel listing an order's payments would want its own read
  endpoint.
- **A payment recorded by hand can't be corrected or deleted.** The table is
  append-only and there is no reversing entry for a mistyped amount — today that
  means a SQL fix. A "correction" row (negative, `method: other`) would be the
  natural shape if it comes up.
- **Notion is still a second writer.** The `… Paid` checkboxes remain
  hand-tickable and are still what `getInvoicePaymentInfo` and the analytics
  read. The intended end state is that they become app-written mirrors of the
  ledger with one writer; until then the two can disagree, and the ledger is the
  one with dates.
- **The `finalBalance` vs `Σ(line totals)` split** described above is untouched.
