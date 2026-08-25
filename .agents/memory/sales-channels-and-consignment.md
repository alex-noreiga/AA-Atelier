# Etsy, the skate shop, and the studio figures

_Roadmap card 02 — "Etsy and consignment in the studio figures". The workspace
half was already built in Notion; this is the product half that reads it._

## What was wrong

The atelier sells through four routes: the website, Etsy, a local skate shop, and
word of mouth. Three of the four are recorded **by hand into the same Notion
"shop orders" database the Stripe webhook writes to**, and a fourth — consignment
stock left at the skate shop — lives in a database of its own that the app had
never opened. The studio dashboard therefore:

- **attributed all of it to the website**, because nothing read `Sales Channel`;
- **dated a hand-filed order by its Notion page**, so an Etsy receipt that sold
  in June and was typed up in August counted as August trade;
- **left the consignment shelf out entirely** — a rail of soakers sitting in
  another shop appeared nowhere, and neither did the payouts they earned.

## What Notion already had (verified 2026-08-25)

| Database        | What it carries                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **shop orders** | `Sales Channel` (select: Etsy / Online Store / Skate Shop / **Word of Mouth**), `Order Date` (date)                                                                                                                       |
| **inventory**   | `Consignment` relation, `At Shop (auto)` rollup, `Skate Shop (opening)`, `Show on Etsy`, `Etsy Listing`                                                                                                                   |
| **consignment** | `Placement` (title), `Item` → inventory, `Qty Delivered` / `Qty Returned` / `Qty Sold`, `Settled`, `Settled On`, `Date Delivered`, `Shop Retail Price`, and the `Your Payout` / `Gross Retail` / `Still At Shop` formulas |

Note the roadmap card names **three** channels; the live property has **four**.
Nothing enumerates them in code — the list is read live off the database schema —
which is why that discrepancy costs nothing.

## Decisions worth keeping

1. **The app stamps its own channel, and that is what makes a blank one mean
   something.** `buildShopOrderProperties` writes
   `Sales Channel = "Online Store"` unconditionally. Without it the orders the
   app writes are the ones with no channel, and "untagged" would be
   indistinguishable from "the website". With it, blank means exactly one thing:
   a row somebody filed and didn't tag.

   `SHOP_ORDER_ONLINE_STORE_CHANNEL` is a **targeted business rule** naming one
   live option value, like `STATUS_IN_STOCK`. Rename that option in Notion and it
   must change here too.

2. **`createShopOrder` now goes through
   `createPageDroppingUnknownProperties`.** That helper was private to the orders
   repository (for the intake form's optional properties); it moved to
   `lib/notion/create-page.ts` because the shop-order writer runs on the **Stripe
   webhook**, where Notion's "reject the whole page over one unknown property"
   behaviour costs a **paid order** its record: the write 400s, the webhook 500s,
   Stripe redelivers, and the redelivery early-returns at the dedupe guard. No
   amount of un-done atelier setup may be able to lose an order.

3. **`Order Date` beats the page's creation time — and a DATE-ONLY value is
   taken as written.** This is the subtle one. Pushed through a timezone,
   `2026-09-01` parses as UTC midnight, reads as August 31 in America/Chicago,
   and silently moves a sale into the previous month's figures. Only a value
   carrying a real time is converted. The app writes a **full instant** for its
   own orders, so the studio's timezone decides which day a late-evening order
   belongs to — that decision belongs where the figures are read, not at the
   write. See `orderedOn` in `studio-analytics.service.ts`.

4. **Channels are laid out over the LIVE option list, so a quiet channel reads
   as a nought** rather than vanishing — the same reason the pipeline panels keep
   their empty stages. A channel present on an order but no longer an option is
   appended after the live ones (money that was taken was taken); untagged orders
   trail last as `channel: ""`, deliberately **not** a sentinel string, since any
   word invented here could collide with a channel the atelier adds.

5. **Best sellers now say what they cannot see.** The list is built from each
   order's `Inventory Items` relation, which a hand-filed Etsy receipt usually
   lacks — so an empty list was ambiguous between "nothing sells" and "nothing is
   linked", and the second is far more often true. `topItemCoverage` reports
   `counted` / `unlinked` and the panel says so. The list itself already counted
   every channel; nothing was filtering Etsy out, the links were simply absent.

6. **Consignment is reported apart from the order figures and never summed into
   them.** A consignment sale is not an order: nobody knows a piece sold until
   the shelf is counted at the next visit, there is no customer, no email and no
   session, and what arrives is the studio's **share** of a shelf price. It is
   also why consignment money stays **out of the month-by-month chart** — one
   settlement is a lump covering weeks of trade, and plotted against months of
   website orders it would read as a spike in a month nothing was sold.

7. **Units are derived; the money is read.** Whether a piece is still on the
   shelf is arithmetic (`delivered − returned − sold`, and zero once settled), so
   `unitsAtShop` computes it — the same call the materials panel makes about its
   restock trip, and for the same two reasons (a formula's rendered value is the
   atelier's to restyle, and a `formula: {…}` filter on one derived from rollups
   400s anyway). **The rule is duplicated in Notion's `Still At Shop` and in
   `consignment.service.ts` — change one and change the other.** But `Your
Payout` is a **commercial term** (half of retail today) that can be
   renegotiated without anybody telling this code, so it is read off the formula.
   A settled placement that sold something and has no payout figure is **named**
   (`payoutUnknownPlacements`), not silently absent from the total.

8. **`Qty Sold` blank means UNKNOWN on an open placement and ZERO on a settled
   one.** Its own Notion description says it is "derived at settlement". Reading
   blank as zero on an open placement would report the whole shelf as still
   sitting there.

9. **A settled placement with no `Settled On` contributes to no month.**
   Guessing one would move real money into a period it didn't happen in.

## Atelier setup

**One optional env var: `NOTION_CONSIGNMENT_DATABASE_ID`**, plus sharing the
Notion integration with the consignment database. Unset ⇒ the panel says the
shelf isn't tracked (never an empty shelf, which would read as "nothing is out").
A 404 — id set, integration never shared — degrades the same way, flagged
`unreachable`, exactly like the materials panel.

Nothing else. `Sales Channel` and `Order Date` already exist on shop orders; if
either were missing the write would drop it and log which property to add.

## Known limits

- **`Skate Shop (opening)` on inventory is not included** in the shelf figures.
  It is an opening balance feeding the inventory rollup; the panel counts
  placements, which is where the atelier records this going forward.
- **Consignment sales are not in `topItems`.** Best sellers count _orders
  containing a piece_; consignment records _units_. Mixing the two measures in
  one bar chart would make both meaningless, so the consignment panel lists its
  own units per piece.
- A skate-shop sale the atelier files **as a shop order** counts in the channels
  panel; one recorded as a **consignment placement** counts in the consignment
  panel. The two are separate records and are never reconciled against each
  other — if the atelier ever files both for the same sale, it will be counted
  twice.
- The reporting window for channels and consignment takings is the same trailing
  `REVENUE_MONTHS` (12) the money-by-month chart covers, so the three figures
  answer the same question about the same period.
