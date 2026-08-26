# Reviews on shop pieces, and the ratings they average to

_August 2026 — roadmap card "Reviews on shop pieces, then star ratings"._

Reviews were captured against custom orders only, so a ready-to-wear piece had
nothing to average and every shop card carried the same amount of social proof:
none. This adds the capture half (a review against one piece from a shop order),
the aggregation, and the display — the card, the quick view, and the `Product`
structured data.

The load-bearing decisions live in CLAUDE.md under "Reviews on shop pieces, and
the ratings they average to". This note keeps the reasoning that didn't belong
there: the things considered and rejected, and the traps found on the way.

## Why a relation and not a name

A review names its piece through a **`Product` relation → inventory**, and the
aggregation joins `inventory page id → shopCardId(variant) → card`.

The alternative was to store the piece's name as text and match on it, which is
what `POST /notify` does for back-in-stock requests. That flow already documents
its own weakness — "renaming an inventory item orphans requests filed under the
old name" — and a rating is worse to lose that way than a restock alert: the
alert is one email that doesn't send, while an orphaned review silently drops a
piece's average and count with nothing anywhere to say so.

The name is stored **as well**, in an `Item` rich_text and in the page title and
body, but only ever for a human to read. Nothing joins on it.

## Why the write goes through `createPageDroppingUnknownProperties`

Both of those columns are atelier setup somebody has to do by hand, and Notion
rejects the _whole page_ over one column it doesn't have. `createReview`
therefore moved onto the shared drop-and-retry helper.

The trade is explicit and worth remembering: a review filed before the columns
exist is **kept but unlinked**, so it can't be aggregated into its piece's rating
until the atelier links it by hand. That is the right way round — the alternative
loses a customer's words entirely — but it does mean early shop reviews may need
one manual pass.

The one existing test this broke was the error-message assertion: `createReview`
used to throw "Notion review creation failed…" and now throws the helper's
"Notion page creation failed…".

## Why the average is gated on consent, not just curation

`extractProductReviews` reuses `isPublishable` verbatim — published **and**
consented.

Splitting them was considered: count every published review toward the average,
and require consent only to quote the words. It would make ratings appear
sooner, and there is a real argument that consent is about publishing somebody's
_words_ rather than their score.

Rejected, for two reasons. A rating shown beside a piece is public use of what a
customer told the studio in confidence, and the consent checkbox is the only
place they said whether that was allowed. And practically: one predicate deciding
everything public is a property you can check by reading one function, while two
nearly-identical predicates are a bug waiting for the day somebody edits one of
them.

The consequence to be aware of: **a shop rating does not move until the atelier
publishes the review in the dashboard queue.** That is a real operational
dependency, not an oversight.

## Why a scan, where the testimonials take one page

`listPublishedReviews` reads a single 50-row page. `listPublishedProductReviews`
uses `scanDatabase`.

The difference is that one is a _sample_ and the other is _arithmetic_. A
testimonial strip cut off at 50 rows shows the newest 50, which is exactly what
it is for. An average cut off at 50 rows is wrong — as the studio collects
reviews, older ones would silently fall out of a piece's count, and the number
beside the piece would drift downward for no reason anyone could see.

## The Notion trap this walked around

The rating read wants only rows that carry a `Product` relation, and the obvious
filter is `relation: { is_not_empty: true }`. A Notion filter naming a property
the database doesn't have is a **400** — and `Product` is precisely a column the
atelier adds by hand, so that filter would have made `/products` fail for exactly
as long as the setup took. The filter names only `Status` and `Consent to
Publish` (both long-standing), and rows without a piece are dropped in the pure
extractor, where an absent property simply reads as "not a shop review".

Same shape as the portfolio's publish gate, and the same reason.

## Deciding when a shop order can be reviewed

`orderDelivered` against the live `Status` list — the final status, positionally,
no name baked in, failing closed on an unknown one.

The worry with this is real: if the atelier never advances an order to its final
status, nobody can ever review it, and the whole feature is dead without any
error to notice. A looser rule was considered (allow it from the second-to-last
status, or from a named "Shipped").

Kept strict anyway, because the same rule already decides what the account
portal calls a _past order_: a customer sees "Delivered" in their portal at
exactly the moment the review becomes available. A second, looser definition of
finished would be a third answer to a question the app already answers twice.

Cancellation is checked **before** delivery, because a cancelled order can also
sit at a final status, and "you can review it once it's delivered" is the wrong
thing to tell somebody whose order was cancelled.

## Why `items` rides on the tracking response

The customer has to be able to say which piece they're reviewing, and the shop
order's `Inventory Items` relation holds ids, not names. `getShopOrderStatus`
resolves them through live inventory — but **only** for a finished, uncancelled
order, which means an in-progress lookup pays for no inventory read, and the
presence of `items` is itself the frontend's "this can be reviewed" signal. One
server-side answer, so the affordance and the gate can't disagree.

Deliberately narrow: ids and names only. No quantities, no prices, and
emphatically no address — this lookup is gated by order number alone, which is
why `readFulfilmentFields` has always refused to return the shipping address.

## The Notion setup, as actually applied

Applied 2026-08-26 to the **Reviews** database under **orders**
(`collection://4e8a7e79-e556-4f78-b511-3fa246712294` — the one
`NOTION_REVIEWS_DATABASE_ID` points at, confirmed by its `Rating` / `Consent to
Publish` / `On the Website` schema, not the stale `⭐ Reviews` that used to sit
under `website`):

- **`Product`** — relation → **inventory**
  (`collection://5aaf66bb-f00b-4aa3-9030-054ead1c812d`), created **two-way**.
- **`Item`** — rich_text.

Inventory therefore also gained a **`Reviews`** back-relation. That was a
deliberate widening of what the card asked for: a one-way relation would mean the
atelier can see the piece from the review but never the reviews from the piece,
and inventory already carries two-way links to `Shop Orders` and `Order Lines`
(each with a rollup on top). Nothing in the app reads the inventory side —
`extractVariant` maps named properties only, so the extra column is inert to
`/products` — so it can be reverted to one-way with no code change.

Not added, and worth knowing why: **no rollup on inventory**. An "average rating"
rollup there would be a second implementation of `summarizeProductRatings`,
computing over a different set of rows (every review, not just the published and
consented ones), and the two would disagree the moment a review sat in triage.
The materials panel's `Restock Alert` documents the same trap.

## Known limits

- A piece the atelier has **unpublished** since it sold can still be reviewed
  (the gate reads the order's own relation, not the shop), but it has no card for
  the rating to appear on, and the review is filed with an empty `Item` name.
- Ratings are **per card**, so a grouped card pools its colourways. Someone who
  wants "the rose one rates 3.2" would need a per-variant breakdown, which is a
  different feature.
- There is **no "verified buyer" badge**, though the data exists (`Email
Verified` is already on the row). It stayed off the public projection with the
  email and the order number.
- One review per submission. A customer who bought three pieces and wants to
  review all three opens the dialog three times.
