# Return & exchange refunds — why the amount is a target, not an increment

Phase-2 Product card "Return & exchange refund processing". The customer-facing
half already shipped (`POST /shop-orders/:n/return-requests` files a
`Request type = "Return / exchange"` row into the contact inbox and refunds
nothing — Approach A). This is the atelier-facing half: the action that issues
the Stripe refund, mirroring the cancellation-refund flow.

> **Superseded (routes only):** this shipped as a CRON_SECRET-gated `?secret=`
> link, `GET /api/shop-orders/process-return[/run]`. Both routes are now deleted —
> the refund runs from the studio dashboard's `return-refund` tool. See
> [studio-internal-tools.md](studio-internal-tools.md). The refund _engine_ below
> is unchanged and still the thing worth remembering.

## The one decision worth remembering

**`?amount=` is a TARGET TOTAL, not an increment.** `?amount=X` means "the total
refunded on this order should be $X"; the service issues
`max(0, X − what Stripe reports as already refunded)`.

This exists because the cancellation flow's idempotency guard —
`refunds.list(...)` and **skip if any refund exists at all** — is correct for a
cancellation (always full, always once) and **wrong for a return**, which has
three shapes the guard can't express:

| Return shape         | What the atelier wants      | Under the cancellation guard    |
| -------------------- | --------------------------- | ------------------------------- |
| Restocking fee       | refund $180 of a $200 order | works once…                     |
| …then top up to full | refund the remaining $20    | **blocked forever** by the $180 |
| Even exchange        | refund nothing              | no way to say it                |

And the obvious alternative — "refund this increment" — makes a re-pressed Notion
link refund **twice**, which is the exact failure mode we're paid to avoid.

The declarative target buys every property at once:

- **Idempotent for the life of the order.** A re-press refunds $0: the target is
  already met. Note a Stripe `idempotencyKey` **cannot** do this job on its own —
  those expire after ~24h and the atelier may well click the same Notion link a
  week later. The key is still passed (keyed on the target, not the delta) so a
  genuine double-click collapses to one refund while a later top-up to a _higher_
  target still gets through.
- **Cannot over-refund.** The delta is computed against Stripe's own refund total
  and the target is clamped to `payment_intent.amount_received`.
- One parameter covers all three shapes: omit ⇒ full, `amount=0` ⇒ even exchange,
  `amount=180` ⇒ restocking fee.

## Stripe is the money truth; Notion is the receipt

`refundedCents()` sums `refunds.list` on the payment intent, so a refund the
atelier issued **by hand in the Stripe Dashboard** counts against the target
exactly like one the app issued. The ceiling is the intent's `amount_received`,
**not** `session.amount_total` — a session total can include a promo that was
never captured.

Because correctness rests entirely on Stripe, the two Notion markers
(`Refunded Amount`, `Return Processed`) are **atelier visibility only** and their
write is **best-effort**: `recordShopOrderRefund` resolves `false` instead of
throwing. Three reasons, all load-bearing:

1. The money has already moved when it runs — a throw there would present a
   successful refund as a failure.
2. A failed write can't cause a double refund next run (Stripe is re-read).
3. It works **before** the atelier adds the two properties — Notion 400s a PATCH
   naming a property the database doesn't have, which would otherwise make the
   whole feature undeployable until the setup step was done.

This is the same degrade-when-unconfigured contract as the `Client` CRM link, and
deliberately **unlike** `setShopOrderCancelled` (which throws) — there, the marker
_is_ the state, so a silent failure would matter.

## Degrade paths (all surfaced, none fatal)

- No recorded session id (paid offline / legacy row) ⇒ `no_payment`, "refund
  manually".
- `$0` / fully-promo session (null `payment_intent`) ⇒ `no_payment`, never
  dereferenced.
- Stripe throws (mode-mismatched session id, deleted session, hiccup) ⇒ caught,
  logged at `error`, returned as `status: "error"` with **nothing refunded and no
  marker written**. The dashboard says so plainly instead of claiming success; a
  re-run is safe because the target is recomputed from Stripe every time.

## Mounting gotcha (historical)

While they existed, both routes had to be registered **before**
`app.use("/api", router)` in `app.ts` — otherwise
`/api/shop-orders/process-return` was swallowed by the router's
`/shop-orders/:orderNumber` status lookup. Worth remembering if a single-segment
`/shop-orders/…` or `/orders/…` path is ever added again.

## Atelier setup

No new env vars (reuses `STRIPE_SECRET_KEY`, Resend, and the studio staff
allowlist). Optional on the **Shop Orders** database: `Refunded Amount` (number) +
`Return Processed` (checkbox).

Run it from `/studio` → **Refund a return**: the order number and an optional
amount are form fields, and leaving the amount blank refunds in full. The known
rough edge this note originally flagged — a partial refund meant hand-appending
`&amount=180` to a formula-built URL, because a Notion formula can't prompt for a
figure — is gone. The internal admin UI it predicted is what fixed it, delivered
with the "Staff authentication for internal tools" card. Delete the old
formula-property link in Notion.

## Not built here

- **No frontend change.** The customer already sees the request dialog; the refund
  is atelier-side. The refund total is not yet surfaced on the tracking page —
  the customer learns the amount from the email.
- **Exchanges don't re-ship.** `amount=0` records an even exchange; picking and
  shipping the replacement is still manual (it needs the writable stock the
  Phase-3 "real stock store" card provides).
- **Custom (`ORD-`) orders are out of scope** — a return of a bespoke garment is a
  conversation, not a button. The endpoint is shop-only by design.
