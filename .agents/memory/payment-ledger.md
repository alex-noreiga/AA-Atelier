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

## One invoice, one value (the `Final Balance` fix)

The studio's figures used to read Notion's **`Final Balance`** while the
customer's invoice summed the line rows — two readers deriving one invoice's
value separately, agreeing only by convention. Both now go through
**`invoiceChargedTotal`** (`lib/notion/invoice.schema.ts`), over the invoice's
own lines. Code: `chargedLines` / `invoiceChargedTotal` / `ChargeableLine` in
that file, `listInvoiceLinesForAnalytics` in `invoice.repository.ts`,
`invoiceValues` in `studio-analytics.service.ts`, and `scanDatabaseChecked` in
`notion/scan.ts`.

The convention had two ways to break, and one of them was live:

- **`Final Balance` applies no Deposit filter.** `buildInvoiceView` excludes
  `Line Type = Deposit` because a deposit is a credit held on the invoice head,
  never a charge. Notion's rollup doesn't, so a Deposit line — were that option
  ever re-added — would inflate the atelier's view while the customer's stayed
  correct. Dormant, but exactly what `LINE_TYPE_DEPOSIT` exists to guard.
- **It is a FORMULA, so it reads as absent when it errors** — and this repo has
  watched that happen: `Payment Status` called a function Notion doesn't have and
  sat empty for months with nothing to see. An errored `Final Balance` silently
  dropped that invoice to $0 in `customBooked`, `invoicedTotal` and the
  outstanding split at once.

Deriving it also closes the loop on roadmap card 6's own premise: the studio's
figures no longer depend on a hand-editable Notion formula either.

1. **The rule is structural, not duplicated.** `ChargeableLine` is `{ type,
amount }` — the only two things the rule reads — so the customer's display
   record and the studio's leaner analytics record both satisfy it and there is
   one implementation.

2. **A fourth bounded scan, not a per-invoice fetch.** `listInvoiceLineItems` is
   right for ONE invoice and would be a request per invoice here, which is the
   same reason the invoice heads are scanned rather than fetched per order.

3. **An INCOMPLETE line scan falls the whole pass back to `Final Balance`**, and
   this is the subtle part. These rows are grouped BY invoice, so hitting
   `MAX_SCAN_PAGES` doesn't drop an invoice from the figures — it silently HALVES
   one, which is a wrong number rather than a short list. `scanDatabase` couldn't
   express that, so `scanDatabaseChecked` was added beside it (returning
   `{ rows, complete }`); `scanDatabase` now delegates to it and the three
   existing callers are unchanged. A failed scan takes the same path.

4. **An individual invoice with no lines falls back too**, which in the ordinary
   case is an un-itemized invoice worth 0 either way, and a line with no
   `Invoice` relation is skipped rather than guessed at — attributing an orphan
   would put money on an order that never charged it.

5. **`payment-reminder.ts` still reads `Final Balance`.** It is a filtered query,
   not a scan, so deriving the figure there would be a line fetch per invoice on
   the nightly cron. The email already omits the amount when the property isn't
   set, so the failure mode there is a quieter email rather than a wrong figure.

## Issuing the invoice (roadmap card 6b)

`Invoice Ready` was a checkbox, not an event. Ticking it published an invoice
whose line items stayed fully editable in Notion afterwards, so the charges could
move under a customer who had already been shown them — and already paid a
deposit against them — with nothing recording what the document used to say. It
also carried no number and no date of its own (`Invoice ID` is the order's
`ORD-` number, display-only).

Issuing snapshots the charges into **`issued_invoices`**, once, and ticks the
gate. Code: `supabase/migrations/0006_issued_invoices.sql`,
`lib/db/issued-invoices.repository.ts`, `services/invoice-issue.service.ts`, the
`issue-invoice` runner in `services/studio-tools.service.ts`, and the readers in
`services/invoice.service.ts`.

1. **What is frozen and what is not is the whole design.** FROZEN: the lines and
   their subtotal — a charge that moves after the customer has seen it is the
   defect. LIVE: which deposits have been PAID, and so the balance due, because
   paying a deposit legitimately reduces what is owed. The deposit schedule is
   snapshotted for the record, but the live invoice head still decides what is
   payable — deposits are payable before an invoice is itemized at all.

2. **The unique index IS the immutability guarantee.**
   `issued_invoices.invoice_page_id` is unique, so an invoice can be issued
   exactly once, enforced by the database rather than by a caller remembering to
   check. A conflicting insert reads the standing row back and reports
   `alreadyIssued`; a conflict with no visible row (an uncommitted peer) throws
   rather than reporting a success with no document behind it.

3. **There is deliberately no re-issue.** An invoice that genuinely needs to
   change after being shown to a customer is a credit note or a new invoice, not
   an edit. The tool says so in its own result.

4. **Snapshot first, gate second.** `setInvoiceReady` runs only after the
   snapshot exists, so a failure part-way through can never publish an invoice
   with no document behind it. The reverse — a failed gate write after a
   successful snapshot — is reported, not thrown: the document is immutable and
   already written, and throwing would read as a failed issue and invite a
   re-press that could only find it already issued.

5. **One place decides which document is being read.** `chargedLinesOf` picks the
   snapshot over the live rows, and the invoice page, its PDF and the BALANCE
   CHECKOUT all go through it. Being shown one total and charged another is the
   sharpest form of this bug, so the checkout prices from the same document the
   page rendered.

6. **The read is best-effort; the write is not.** An unconfigured or unreachable
   database answers `null` and every reader falls back to computing live — the
   pre-6b behaviour, so a customer can still see and pay their invoice during an
   outage. Issuing itself refuses to run without a database, because ticking the
   gate with no snapshot would publish exactly the mutable document this
   replaces.

7. **A quote issues the invoice it writes.** It was already ticking
   `Invoice Ready` (a quote is a finished invoice by construction), so it now
   issues instead — one press, a numbered document. Best-effort on the issuing
   half only: the line is already written by then, so a database outage degrades
   to the plain gate and the atelier can issue it later. `invoice-lines`
   deliberately still does NOT tick the gate — an itemized commission is reviewed
   first, and that review is now "issue it".

8. **The number is derived from the row's own identity value** in the insert
   statement (`'INV-' || lpad(nextval(…), 6, '0')`), so nothing reads a counter
   and writes it back and two concurrent issues can't collide. Gaps are possible
   — a rolled-back insert consumes an identity value — so the series is
   sequential, not gapless.

9. **Tax is NOT on the document, and that is honest rather than missing.** Stripe
   computes it from an address collected at checkout, which the invoice does not
   have at issue time, so the amount genuinely cannot be known. The snapshot
   records only THAT the balance is taxed, and the tool's result says tax is
   calculated at checkout. Putting a figure there would need an address the app
   deliberately never stores for a custom order.

10. **`issuedAt` is a plain ISO string, not `format: date-time`.** The zod and
    client generators disagree on that format (one emits `Date`, the other
    `string`), which makes the two packages' own `Invoice` types mutually
    unassignable — the drift `.agents/memory/orval-zod-codegen-drift.md` warned
    would show up "if more formats are added". `paymentDeadline` beside it
    already avoids it the same way.

## Credit notes — the way an issued invoice changes

Issuing made an invoice's charges immutable and deliberately left no re-issue,
which is right and left the atelier no way to REDUCE one: an invoice issued for
too much, work that was dropped, a goodwill discount. A credit note is the answer
invoicing has always used — a second document against the first. `/studio` →
**Credit an invoice** (`POST /api/studio/tools/credit-note`, `{ orderNumber,
amount, description }`). Code: `supabase/migrations/0007_credit_notes.sql`,
`lib/db/credit-notes.repository.ts`, `services/credit-note.service.ts`, the
`credit-note` runner, and the readers in `services/invoice.service.ts` +
`services/studio-analytics.service.ts`.

1. **A credit note reduces what is OWED. It is not a refund.** If the customer
   has already paid, moving money back is a separate act with its own tools
   (`cancellation-refund` / `return-refund`), which go through Stripe and record
   themselves in the payment ledger. Crediting a settled invoice leaves them owed
   money and the tool's result **says so outright**; it never quietly sends any.
   This is the one thing about the feature that must not be misread.

2. **It requires an ISSUED invoice, and that refusal is the feature.** A credit
   note credits a document. An invoice that was never issued is still editable
   rows — the atelier changes them and issues it. Refusing says which of the two
   situations they are in.

3. **The credits on an invoice may never exceed what it charges.** A document
   cannot be reduced below nothing, and the ceiling is also what bounds a double
   press: the second is refused outright once the two together would overshoot.
   Beyond that, the dashboard asks for confirmation (`destructive`, like the two
   refunds) and the result echoes every credit note on the invoice, so a
   duplicate is visible immediately.

4. **Amounts are stored POSITIVE**, unlike the payment ledger's signed cents. The
   sign lives in the word "credit" and every consumer subtracts explicitly —
   storing them negative would let a reader add them to a subtotal and be right
   by accident, which is how a rule stops being checked.

5. **The reason is part of the document, not an internal note.** It is required,
   and it renders on the customer's invoice and PDF beside the credit number. A
   line taken off an invoice with no explanation is the sort of thing that
   prompts a phone call.

6. **The credits read is three-valued, and the balance checkout REFUSES what it
   cannot confirm.** Swallowing a database failure into an empty list would be
   indistinguishable from an uncredited invoice — and an uncredited invoice is
   charged at its full amount, so a transient blip would take money from a
   customer who had been credited. So `readCreditNotes` carries `unavailable`:
   the invoice page still renders (a display showing too high a balance is
   recoverable) while `createPaymentCheckout` throws a retriable 503. A DEPOSIT
   is unaffected — it is priced from the invoice head, not from the document —
   so refusing that too would be caution with nothing behind it.

7. **There is no unique key on the invoice**, unlike `issued_invoices`: an
   invoice may legitimately be credited more than once, for different reasons, on
   different days. The ceiling in the service is what bounds it instead.

8. **The studio's figures subtract credits too**, via `sumCreditsByInvoice` (one
   query, not one per invoice) folded into `invoiceValues` — otherwise the
   dashboard would go on reporting money the studio has told a customer it will
   not be asking for. Best-effort like the ledger: a failure reports invoices at
   their UNCREDITED value, which overstates rather than erases.

**Atelier setup: none beyond `db:migrate`.**

## Currency: what the roadmap's multi-currency card would and wouldn't change

Checked before card 11 (multi-currency & international shipping) rather than
after, on the reasoning that a storage decision is cheap to revisit now and
expensive later. The finding, so nobody has to redo it:

**The tables are right and would not need a migration.** `payments`,
`issued_invoices` and `credit_notes` each store a `currency`, in integer minor
units — the same shape Stripe uses. `recordStripeCharge` already records
whatever currency Stripe reports rather than assuming.

**The AGGREGATIONS were the gap, and it was invisible.** `buildRevenue` summed
every custom payment row and `sumCreditsByInvoice` summed every credit,
regardless of currency. Nothing could produce a non-USD row (both checkout paths
pin the currency), so it was a trap rather than a bug — but the kind that fails
by adding euros to dollars in a revenue figure with nothing on the page to show
for it, and card 11 would have armed it. Both now scope to `STUDIO_CURRENCY`;
the revenue pass logs at `error` on a row it skips, because such a row means
somebody started selling in a second currency without teaching the figures to
convert.

**`lib/currency.ts` is not a multi-currency implementation** and must not be
mistaken for one. It writes down the assumption those aggregations were already
making. It replaced four separate `const CURRENCY = "usd"` declarations
(`checkout.service`, `invoice.service`, `lib/stripe/promotions`) and three
repository defaults. `isStudioCurrency` treats an ABSENT currency as the
studio's: every row predating the columns was in it, and reading unknown as
foreign would drop real money out of the figures.

**What card 11 would still need, none of which touches the above:** presentment
currencies at checkout, per-currency Stripe shipping rates (they are
currency-scoped as well as mode-scoped), duties/DDP, international VAT/GST, and
a reporting-currency conversion with rates and the dates they were taken.

**One real limit if it ever lands:** `amount_cents` and the `Math.round(x * 100)`
conversions assume a TWO-decimal currency. Fine for CAD/GBP/EUR/AUD; wrong for
JPY (zero decimals) and KWD (three). The storage is fine — minor units are minor
units — but the column name and the fixed exponent would need to become a
per-currency one. Worth knowing that Japan is a real figure-skating market, so
this is not purely theoretical.

`formatPrice` on the frontend hardcodes `currency: "USD"` and is deliberately
left alone: it would need a currency argument threaded through every caller, and
card 11 rewrites it anyway.

## Emailing the customer their invoice

Until this, the app never sent anyone their invoice. The payment reminders
linked to the tracking page, and a customer only saw the document if they went
looking — which was the one genuinely customer-facing thing Stripe Invoicing
would have given that this stack didn't. `issuedInvoiceEmail`
(`lib/resend/emails.ts`), sent from `issueOrderInvoice`.

1. **It sends on ISSUE, and only when this run issued something.** A re-press
   changed nothing, and a second copy of the same document reads as a chase
   rather than a delivery — the same "only when something new happened" rule the
   cancellation refund email keeps. A quote sends it too, since a quote issues
   the invoice it writes.

2. **The address costs one extra Notion read**, through
   `findOrderForStageNotification` — the established way the app gets a
   customer's email, because `findOrderByNumber` deliberately doesn't carry one
   (the tracking lookup is gated by order number alone, so it must not echo an
   address back).

3. **The balance in the email is LIVE, not frozen.** Deposits already paid are
   credited exactly as the invoice page credits them. Credit notes cannot exist
   at issue time — crediting requires an issued invoice, and this one has only
   just become one — so they need no handling here.

4. **A failed send is reported, not thrown, and the tool says `attention`.** The
   document is written either way, so a Resend hiccup must not read as a failed
   issue and invite a re-press that could only find the invoice already issued.
   But an invoice the customer never received is half an outcome, so the result
   names why and the run is not a clean `ok`. A legacy order with no email is the
   same shape.

5. **`PUBLIC_BASE_URL` unset omits the link rather than failing the send.** Note
   `siteBaseUrl()` THROWS when it's unset — using it here would have taken the
   whole send down over a missing link, on any install that hadn't set it. Read
   defensively instead, like `schedule.service`'s reminder links, and the copy
   falls back to "look up your order number".

**No atelier notification**, deliberately: they just pressed the button.

## What is deliberately NOT done yet

- **`buildPayments` still reads the Notion checkboxes.** Deposits-vs-balances is
  an _outstanding_ figure — what is still owed — which the ledger doesn't hold;
  it is the invoice's schedule that says what was expected. Left alone
  deliberately.
- **A credit note isn't emailed.** Issuing sends the invoice; raising a credit
  against it tells only the atelier. The customer sees it next time they open the
  invoice. Worth adding if credits turn out to be common.
- **A credit note can't be voided.** It is append-only like everything else here,
  and there is no reverse entry — a credit raised in error is a SQL fix. Voiding
  would want its own document type (a debit note), which nobody has asked for.
- **Credits are a single amount, not itemized.** "Credit the rhinestoning line"
  is expressed as an amount plus a reason rather than by crediting specific
  lines. Enough for the cases that prompted it; a line-level credit would need
  the snapshot's lines to be addressable.
- **`Invoice Ready` remains hand-tickable**, so an invoice can still be published
  in Notion without a snapshot. It then reads live, as before, with no number.
  Making the checkbox an app-written mirror is the same end state the `… Paid`
  boxes want.
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
