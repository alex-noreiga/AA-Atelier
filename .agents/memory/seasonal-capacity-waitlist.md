---
name: Seasonal capacity & the commission waitlist
description: When the studio's books are full, the intake form offers a waitlist instead of a bespoke commission. A counted cap plus an atelier override, gated per service, failing open in every direction — and the Competitions database read only to pin a waitlist entry to the event it's for.
---

Roadmap card ③ ("Seasonal capacity & waitlist"): _"When the season is fully
booked, pause new custom orders and collect a waitlist. The Competitions
database already dates each season and derives when its push starts, which is
the demand signal to read."_

## What shipped

- **`GET /api/capacity`** (public, contract-first) — are the books open, the
  atelier's closed-books wording, and the dated competitions a waitlist entry
  can be pinned to.
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

**1. What "fully booked" means was a real fork, and the Competitions database
could not answer it.** The card names Competitions as the demand signal, but
**every row in it is undated** — three rows, all with a blank `Date` and a blank
`Season`, only a `Lead time (weeks)` and a location. A season-window rule
computed from those rows would have shipped completely inert, and looked
correct. So capacity is **counted** instead: `COMMISSION_CAPACITY` against the
number of capacity-gated orders neither delivered nor cancelled, which works
from the first deploy with nothing to fill in.

**2. Competitions is still read — for the thing it can actually answer.** Not
"when do we reopen" (its `Push starts` formula answers "when should we start
advertising", a different question, and the app never reads it), but **what is
this customer waiting for**. The waitlist offers the dated competitions as a
picker, so the atelier can work the list by the date the piece is genuinely
needed. Undated rows are dropped rather than rendered as blank options, so
**today the picker doesn't appear at all** and the form asks for a date — that
fallback is the normal path, not an error case. Filling in `Date` on those rows
is what turns the picker on; nothing needs deploying.

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
Contact Messages", and the event it's for reuses the shared **`Item`**
rich_text that back-in-stock introduced and return/exchange already borrows — so
the atelier can group the waitlist by competition in a Notion view without a
column being added. The event name written there is always **resolved
server-side** from the picked `eventId`; the browser's `eventName` is ignored
when the id resolves, for the same reason checkout reprices the cart.

**12. A waitlist entry gets an atelier notification, unlike a newsletter
opt-in.** Both are "somebody gave us their email", but a waitlist entry is
somebody actively asking for work and is the signal the books reopen on.

**13. `requestAction` gives it no tool, deliberately.** Like an inquiry or a
measurement change, a waitlist entry is answered by a human — a note in the
queue says to write to them or reopen intake under Studio settings.

## Setup

**Nothing is required.** `COMMISSION_CAPACITY` defaults to `0` (no cap) and
`COMMISSION_INTAKE` to `auto`, so the feature is inert until the atelier sets a
number under `/studio` → **Studio settings**.

Optional, for the seasonal half: set **`NOTION_COMPETITIONS_DATABASE_ID`**
(`7e9de299-3413-4bb7-a38b-ce2b3b4d45b5`), share the Notion integration with
**🏆 Competitions**, and fill in `Date` (and ideally `Season`) on the rows. Until
then the waitlist asks for a plain date. The `Waitlist` `Request type` option
auto-creates on first write.

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
- **A competition renamed or archived between the form loading and the submit**
  degrades to the customer's typed name, not an error.
