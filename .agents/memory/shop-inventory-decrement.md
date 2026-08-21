# Automatic shop inventory decrement

Roadmap card #2. Before this, a shop sale did not move Notion stock: checkout recorded
the purchased items as free-text bullets on the shop order's page and nothing else, so
the atelier adjusted `Quantity Available` by hand — and, in practice, didn't. Stock had
drifted since the shop opened.

**Almost nothing here is new.** The workspace already had the whole mechanism, wired and
inert: an **"order lines"** database (`Item` → inventory, `Order` → shop orders, `Qty`,
`Unit Price`, `Size`, plus `Line Total` and a `Counts Toward Sold` formula), inventory's
**`Units Sold (auto)`** rollup summing `Counts Toward Sold` through the `Item` relation,
`Quantity Available` subtracting it, and the shop order's **`Voided`** checkbox that
`Counts Toward Sold` reads through the line's `Order Voided` rollup. The lines table was
simply empty. The change is: write the rows.

## Why it's shaped this way

- **The row IS the decrement; there is no number to write.** `Quantity Available` is a
  Notion formula, and formulas can't be written. The old CLAUDE.md note concluded from
  that "auto-decrement would need a new writable count property plus reservation logic"
  — which was wrong twice over: the atelier had already modelled the decrement as a
  rollup over line rows (so no writable property is needed), and reservation is a
  separate concern from decrementing (see below). Don't reintroduce a count property.

- **A line with no `Item` relation is worthless, so we don't write one.** The rollup
  travels the `Item` relation. A Stripe line whose product carries no `variantId`
  metadata — a session created before checkout stamped it, or a deleted Stripe product —
  is **skipped and warned**, not written as a dangling row that would inflate
  `Items Subtotal` and decrement nothing.

- **Best-effort, per line, never throwing.** The lines are written after the order's own
  page, on the Stripe webhook path. A throw there 500s the webhook; Stripe redelivers;
  the redelivery early-returns at the dedupe guard — so the lines would be lost _anyway_
  and a duplicate order risked. Each line's failure is caught individually (one bad row
  doesn't cost the rest of the order its stock movement) and logged at **`error`**, not
  `warn`: a missed line drifts stock with nothing visible in Notion to notice. Same
  reasoning as the confirmation email and the rewards, which sit alongside it.

  Consequence, accepted: on the rare reclaim path (a prior attempt created the order page
  then crashed) the order is treated as recorded and no lines are written for it. Like
  the email and the rewards, that's a one-off to fix by hand.

- **`size` was added to the Stripe product metadata rather than parsed back out.** The
  size was already in the line's display name (`"Keyhole Dress — Adult S"`), and the
  first instinct is to split on the em dash. That's guesswork the moment an item name
  contains one. Checkout now stamps `size` next to the `variantId` it already stamped.

- **`Unit Price` is the LISTED price, not the discounted one.** The shop order's
  `Items Subtotal` rollup exists to be compared against its `Total` "to see shipping,
  fees and discounts" (the atelier's own property description). Folding a promo code
  into the unit price would erase exactly the gap that comparison is for.

- **`resolvePurchasedInventoryIds` now derives from the same mapper.** The
  `Inventory Items` relation (roadmap card "relate shop orders to inventory rows") read
  the same `variantId` metadata with its own loop. Both now come from
  `purchasedLinesFromSession`, so the relation and the line rows can't disagree about
  which inventory rows an order touched.

- **Cancelling ticks `Voided` in the same PATCH as `Cancelled`.** This is the part that
  isn't in the roadmap card's one-line summary but follows from it: once lines exist, a
  cancelled-and-refunded order _holds_ its stock until someone ticks `Voided` by hand.
  `setShopOrderCancelled` now writes both. They stay **separate properties** on purpose —
  `Cancelled` is the customer-facing state `shop-order-result.tsx` renders, `Voided` is
  the bookkeeping fact the rollups travel, and the atelier ticks `Voided` alone for an
  order the app never took money for.

  **Returns deliberately do NOT void.** `return-refund.service.ts` was left alone:
  whether a returned piece goes back on the shelf is a judgement about the piece (it may
  come back unsellable), not something a refund amount can imply.

- **Still no reservation logic — the card scoped it out explicitly.** Stock moves at
  **payment**, so an abandoned checkout consumes nothing; but nothing is held between
  session creation and payment, so two simultaneous checkouts can still oversell the last
  piece. The quantity cap in `toLineItem` (against live `Quantity Available`) remains the
  only guard. For a studio selling handfuls of one-off pieces that race is rarer than the
  drift this fixes. Reserving would need a store of its own and a release path for
  abandoned sessions.

- **Gated on its own database id, degrading to the old behavior.** `orderLinesConfigured()`
  reads `NOTION_ORDER_LINES_DATABASE_ID`; unset ⇒ the pass no-ops and a paid order is
  recorded exactly as before. Unlike the back-in-stock sweep (which _must_ have Postgres
  or it re-emails people), there is no harm in degrading here — stock just stays manual —
  so it self-gates quietly instead of failing loudly.

## Gotchas

- **Lines exist only from this deploy onward.** There is no backfill: reconstructing
  historical lines from Stripe sessions would double-count against whatever the atelier
  has already folded into each item's `Sold (opening)`. Reconcile the accumulated drift
  once by adjusting `Sold (opening)` — the app never writes or reads that property.

- **`Size` is a `select` on order lines and a `multi_select` on inventory.** They share
  the same option vocabulary, and Notion auto-creates a select option it hasn't seen, so
  a new band can't 400 the write. A _renamed_ band on inventory would start creating a
  second option on order lines — cosmetic, since nothing filters on it.

- **The atelier's setup is one env var and one share.** Every property involved already
  exists. Nothing to add in Notion.
