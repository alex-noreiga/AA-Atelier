# Flat-price quotes + per-service payment wording

## What this is

Two halves of one complaint: **payments for repairs, rhinestoning and
alterations**. The first half is the real defect — those orders could not be paid
online at all. The second is the wording that made the workaround visible to the
customer.

## The defect, precisely

Custom-order payment is invoice-owned (`invoice-building.md`): deposits from the
invoice head, the balance from `Invoice Line Items`. There was exactly **one**
writer of those lines — `invoice-generator.service.ts` — and it itemizes from the
atelier's **costing** system, which models a whole garment (costing item →
material usage lines → labor → a margin-loaded `Suggested Price`).

Nobody builds a costing for an $85 re-stone. So for the three piece-in-hand
services the chain failed end to end, silently:

1. `generateInvoiceLineItems` throws `BadRequestError("This order has no costing
items to itemize.")` when `order.costingItemIds` is empty.
2. No line items ⇒ `buildInvoiceView` gives `subtotal = 0` ⇒ `balanceDue = 0`.
3. `createPaymentCheckout("balance", …)` throws `"There's no balance due on this
order."`

Nothing logged an error and nothing looked broken — the invoice simply had no
money on it. The only workaround was to put the whole price in `First Deposit
Amount` (deposits surface without `Invoice Ready`, so that _does_ charge
correctly) — which is why the second half of this card exists: the customer then
reads the payment as **"First deposit"**.

## The fix: a second writer of the same shape

`POST /api/studio/tools/quote` → `services/quote.service.ts`. The atelier types
the price they quoted; it becomes **one priced `Invoice Line Item`**, identical in
shape to a generated one (`Manual Unit Price` at quantity 1, no `Costing Item`
link — the double-charge rule in `invoice-building.md` still holds).

Why a line and not a field: everything downstream — the tracking page, the
balance checkout, the payment reminders, both refund flows, the studio analytics
— already reads an invoice. Writing a line means none of them learn anything new.
A `Flat Price` property on the order would have needed a branch in each.

Load-bearing decisions:

- **`Line Type = "Service"`, its own value.** `Labor` would be a lie the customer
  can read (the price covers materials); `Garment` reads wrong above "Replace
  shoulder elastic". Notion auto-creates the select option, so setup is nil.
  `web-app/src/lib/invoice-format.ts` heads it **"Work"** and sorts it first;
  the PDF shares `groupLineItems`, so it followed for free.
- **Idempotent by the generator's own rule** — any existing line item ⇒ `noop`,
  title still reconciled. This is also what stops the two writers fighting over
  one invoice. Re-quoting = delete the line in Notion first, deliberately.
- **It ticks `Invoice Ready` itself, LAST.** A quote is a finished invoice by
  construction. The costing generator deliberately does not — an itemized
  commission is reviewed first, and that checkbox is where the review is
  recorded. Ticked last so a mid-way failure never exposes a half-written invoice.
- **Rush surcharge still applies**, priced off the quote. The customer ticked a
  box accepting it at intake; the invoice has to match what they were told.
- **Money validated before Notion is touched.** The generated zod only promises
  `number >= 0`, so `$0` / `NaN` / `Infinity` all arrive. `MAX_QUOTE` ($100k) is
  a typo guard, not a business limit — a stray digit is the one input error that
  matters when the figure becomes a charge.
- **Not gated on the service.** An order is a flat-quote candidate because it has
  no costing, not because of its `Service` value. The service is read for exactly
  one thing: naming the line when `description` is blank.

## The wording half

`OrderServiceDef.payment`: `"staged"` (bespoke) vs `"single"` (the other three).
Drives the pure `services/payment-labels.ts`, applied in `getInvoicePaymentInfo`
(tracking page, account portal, the Stripe line name) and in the payment-reminder
email.

- **It renames and does nothing else.** All three stages stay available on every
  order — the atelier may want money up front on an expensive restoration. This
  was the user's own call ("one payment, with optional deposit").
- **A lone deposit → "Deposit"; two keep their ordinals.** The load-bearing
  condition. Renaming unconditionally would give a genuinely staged invoice two
  payments both called "Deposit", and a customer who paid one would reasonably
  believe they were square.
- **The reminder email reads the same rule** from the new
  `PaymentReminderInvoice.depositCount`, counted from the deposit **amounts** —
  not from `stages`, which only holds stages that were given a due date.
- **No `Service` ⇒ bespoke ⇒ unchanged wording**, the same widest-form
  degradation as `resolveStoredOrderService` everywhere else.
- The tracking page renders `deposit.label` verbatim and already said "Balance
  due" for the balance, so **no frontend change was needed** for this half.

## Gotchas for next time

- `OrderRecord` and `OrderStageNotification` both gained `service?: string` — the
  **raw property value**, which is the display _name_ ("Repairs & Restoration"),
  not the id. `resolveStoredOrderService` accepts either; resolving by id alone
  would have made the whole thing a silent no-op (the same trap
  `service-pipelines.md` records).
- `getServiceOptions()` strips `payment` alongside `orderLabel` / `emailIntro` /
  `pipeline` — the intake form asks what to make, not how it is paid for.
- Adding a required field to `PaymentReminderInvoice` broke six **test** fixtures
  and nothing else; the tests still passed at runtime and only `tsc -p
tsconfig.test.json` caught it. That test-typecheck step is load-bearing.

## Still not done

- **A real payment ledger.** Custom-order payments still carry no dates (the
  invoice holds a paid _checkbox_ per stage), so the studio analytics can only
  report bespoke work as _booked_, not collected — see the `customBooked` note in
  the analytics section. Unchanged by this card.
- **Editing a quote from the dashboard.** Re-quoting means deleting the line in
  Notion. Deliberate: the price may already have been shown to a customer.
- **Multi-line quotes.** One line per press was the chosen shape; a second press
  reports `noop` rather than appending, so itemising a repair means the costing
  path or hand-written lines.
