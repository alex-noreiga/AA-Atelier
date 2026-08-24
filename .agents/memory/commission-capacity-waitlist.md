---
name: Commission capacity & the waitlist
description: When the studio's books are full, the intake form offers a waitlist instead of a bespoke commission. A counted cap plus an atelier override, gated per service, failing open in every direction. The Competitions database was tried as the "seasonal" signal and deliberately removed — read decision 1 before reintroducing it.
---

Roadmap card ③ ("Seasonal capacity & waitlist"): _"When the season is fully
booked, pause new custom orders and collect a waitlist. The Competitions
database already dates each season and derives when its push starts, which is
the demand signal to read."_

## What shipped

- **`GET /api/capacity`** (public, contract-first) — are the books open, and the
  atelier's closed-books wording.
- **`POST /api/waitlist`** (public, contract-first) — files a
  `Request type = "Waitlist"` row in the contact inbox, with the same
  honeypot / fill-time / per-IP anti-spam as the other anonymous forms.
- **A server gate on `POST /orders`** — 409 for a capacity-gated service while
  the books are closed.
- **The order form** swaps the intake for the waitlist once a capacity-gated
  service is picked, and recovers to it on a 409.
- **A `Commission capacity` panel** on `/studio`, and the three tunables in the
  existing Studio settings editor.
- **A seventh contact-inbox request kind** (`waitlist`) in the studio queue.

## The decisions worth remembering

**1. The Competitions database was tried as the "seasonal" signal and REMOVED.
Don't reintroduce it.** The roadmap card names it as the demand signal to read,
and the first cut did: `NOTION_COMPETITIONS_DATABASE_ID`, a
`lib/notion/competitions.{schema,repository}.ts` pair, dated rows served on
`GET /capacity` and offered as a picker on the waitlist form. Two things killed
it, in order of importance:

- **The atelier's own objection, which is the decisive one:** _"I'm not going to
  know about every single competition going on nationally and internationally."_
  A curated list of events is either a standing maintenance burden or a picker
  that silently omits the event the customer actually came for — and the skater
  knows theirs. Free text moves the knowledge to the person who has it.
- **The data agreed.** Every row in that database was (and is) **undated** —
  three rows with a blank `Date` and a blank `Season`, only a
  `Lead time (weeks)` and a location. Anything computed from those rows would
  have shipped completely inert while looking correct.

So the waitlist asks two plain optional fields — what's it for, and when do you
need it — and resolves neither against anything. The wording matters as much as
the mechanism: the studio makes **dancewear as well as skating costumes**, so
"What are you skating?" would read as the wrong shop to half the people seeing
it. "What's it for?" with a "Competition, recital, showcase…" placeholder covers
both without naming either. The atelier needs a
label to group the inbox by and a date to work the list in order of; free text
gives both, with no database, no env var and nothing to keep current. The whole
Competitions layer (client factory, schema, repository, env var, its tests, and
`WaitlistEvent`/`eventId` on the contract) is **deleted**, not disabled.

**2. Capacity is therefore just a number.** `COMMISSION_CAPACITY` against the
count of capacity-gated orders neither delivered nor cancelled, which works from
the first deploy with nothing to fill in. "Seasonal" is expressed by the atelier
setting the cap and the switch as their season demands, not by the app inferring
a season from a calendar it can't be expected to maintain.

**3. It fails OPEN everywhere, which is the opposite of most gates here.** No
cap configured, an unparseable cap, a negative cap, an unreadable order count —
all report open. Elsewhere the app picks the cautious direction (`orderDelivered`
fails closed rather than granting a review on a stale read); here the cautious
direction is to **keep taking orders**, because a customer turned away by a
Notion blip is gone silently and doesn't come back to check. `COMMISSION_CAPACITY`
defaults to **`0` = no cap**, so an atelier that has never heard of this feature
can never be closed by it.

**4. The count is `undefined`, never `0`, when the read fails.** A failed read
returning zero would look like an empty workroom — the same open books, but the
studio panel would then say "0 in production" instead of "not counted". Same
reasoning as the materials panel's `stock-unknown`: absent is not zero.

**5. The manual switch overrides the count in BOTH directions, and is checked
first.** `COMMISSION_INTAKE` = `auto` / `open` / `closed`. The atelier knows
things the count doesn't (a commission that turned out to be three garments, a
month they're away). Anything that isn't `open` or `closed` — including a typo —
reads as `auto`, so a mistyped value can't shut the shop; the settings editor's
`validate` refuses one anyway, which is the standard accepts-mirrors-the-getter /
validate-may-be-stricter split from `studio-settings-editor.md`.

**6. Only the bespoke commission is gated** (`capacityGated` on
`lib/service-catalog.ts`, served on `GET /services`). A commission is weeks of
making time; an alteration, a stoning job or a repair is hours on a piece the
customer already owns. Closing those would refuse work the studio can still do —
and it is the thing most likely to be useful to someone who has just been told
"we're full", which is why the closed-books screen keeps the service picker on
show and the customer email says so.

**7. `SERVICE_FALLBACK.capacityGated` is `true`, which is NOT the widest
option.** Every other flag in that fallback degrades toward the widest form; this
one degrades toward **matching the server**, because an order with no `service`
resolves to the bespoke commission on the way in. A `false` there would show the
intake form to somebody whose order the server would then refuse.

**8. The public endpoint carries no counts.** It is anonymous, so "3 of 8 slots
left" is a figure anyone can poll. The numbers are on the dashboard behind the
staff gate — and a test asserts the response has exactly four keys.

**9. The count is a filtered query, not the analytics' full scan.** It is reached
from a public endpoint on every intake-form load, so the Notion filter excludes
the two terminal conditions (`Cancelled` ticked, `Stage` = the last live stage)
and what comes back is bounded by the studio's real open workload. `Stage` is a
**status** property — `status: { does_not_equal }`, not `select` (see
`notion-status-filters.md`). The dashboard's own figure is computed from the
scan it already does, so the two can differ by up to a minute; that's fine, since
one is the atelier looking at their numbers and the other is the gate.

**10. Which of the counted orders are gated is the CATALOG's call.** The
repository returns each open order's stored `Service` string verbatim and
`capacity.service.ts` runs it through `resolveStoredOrderService`. That property
stores the display **name** while ids are used everywhere else, and a legacy
order carries **nothing at all** — both resolve to the bespoke commission, so the
studio's own history counts against capacity exactly as a new commission does.
(Same trap as `service-pipelines.md`: matching on id alone makes it a no-op.)

**11. The waitlist needs no new Notion property.** Seventh writer to "Website
Contact Messages", and what the piece is for reuses the shared **`Item`**
rich_text that back-in-stock introduced and return/exchange already borrows — so
the atelier can group the waitlist by event in a Notion view without a column
being added. `waitlistItemLabel` composes it as `"<event> (<date>)"`, falling
back to whichever half it has and omitting the property entirely when it has
neither, rather than writing it blank.

**12. A waitlist entry gets an atelier notification, unlike a newsletter
opt-in.** Both are "somebody gave us their email", but a waitlist entry is
somebody actively asking for work and is the signal the books reopen on.

**13. `requestAction` gives it no tool, deliberately.** Like an inquiry or a
measurement change, a waitlist entry is answered by a human — a note in the
queue says to write to them or reopen intake under Studio settings.

## Setup

**Nothing at all — no database, no env var, nothing to keep current.**
`COMMISSION_CAPACITY` defaults to `0` (no cap) and `COMMISSION_INTAKE` to
`auto`, so the feature is inert until the atelier sets a number under `/studio`
→ **Studio settings**. The `Waitlist` `Request type` option auto-creates on
first write.

## Known limits

- **No queue position and no promise.** The waitlist is a list of people to
  write to, not an ordered claim on capacity — the confirmation email says so
  explicitly ("nothing is booked and there's nothing to pay").
- **Nothing reopens the books automatically.** Delivering an order frees a slot
  within a minute (the count is 60s-cached), but nobody on the waitlist is told;
  the atelier writes to them. An automatic "a space opened" sweep would want a
  claim table like `restock_alerts`, and the same ordering question the point
  above ducks.
- **The count is per-instance cached**, like every other live Notion read, so two
  warm serverless instances can be up to 60s apart on whether the books are open.
- **Nothing validates what the customer types as their event.** That is the
  trade in decision 1: a typo or an abbreviation reaches the inbox as written,
  and grouping a Notion view by `Item` will show near-duplicates. The atelier
  reads the rows either way, and the alternative was a list nobody can keep
  current.
