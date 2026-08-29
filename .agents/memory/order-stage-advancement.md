---
name: Advance an order's stage from the dashboard
description: The studio dashboard's stage board — GET /studio/orders and PUT /studio/orders/{n}/stage — which writes the Notion Stage and sends the customer's status email on the action itself, sharing the webhook's notifier, forward-only gate and Last Notified Stage marker. Includes why the webhook was kept.
---

# Advance an order's stage from the dashboard

Roadmap card 05. Until this, a custom order moved along its pipeline exactly one
way: somebody opened Notion and changed the `Stage` property by hand. Every
piece of machinery the app has around a stage change is downstream of that one
fact — a Notion database automation watches the property, posts a webhook, the
webhook re-reads the order, and a `Last Notified Stage` marker exists only
because that webhook cannot tell a forward move from a backward one. The
`?secret=` query token the automation may still use is the last place in the app
a shared secret is read out of a URL.

Now the change can happen where the app can see it, and the customer's status
email rides the action.

## The shape

Two contract-first operations behind the same `requireStaff` gate as the rest of
the studio surface (401 / 404 / 403), modelled on the review queue's
read-then-decide pair:

- **`GET /api/studio/orders`** — the open custom orders, each with its position
  and what "advance" means for it.
- **`PUT /api/studio/orders/{orderNumber}/stage`** — `{ stage, notify? }`.

Code: `services/studio-orders.service.ts`, the two handlers in
`routes/studio.ts`, `listOrdersForStageBoard` + `updateOrderStage` in
`lib/notion/orders.repository.ts`, and
`web-app/src/components/studio-orders.tsx` mounted by the new `orders` section.

## Load-bearing decisions

### 1. It does not send the email — it calls the webhook's notifier

`setOrderStage` writes the stage and then calls the same
`notifyOrderStageChange` the webhook calls. That is the whole reason the two
paths compose rather than collide:

- One forward-only gate, one `Last Notified Stage` marker, one piece of email
  copy, one "read the order back, never trust the caller's copy of the stage".
- **If the Notion automation is still wired, this write fires it** — and it
  finds the marker already at the new stage and sends nothing. Neither path
  needs to know the other exists. Without the shared marker the obvious
  implementation (send the email here) would double-email every advance for any
  atelier that had the automation configured.

### 2. The re-read is located by PAGE ID, not order number

The notifier re-reads the order before sending. `findOrderForStageNotification`
is a **database query** (filtered on `Order Number`), and a query is the one
Notion read that may not yet reflect a property written a moment earlier;
`findOrderForStageNotificationByPageId` is a direct `GET /v1/pages/{id}`, which
is read-your-writes. Emailing a customer the stage their order was at _before_
the press is the exact failure this feature would otherwise introduce, so the
locator is the page id. A unit test pins it.

### 3. It writes a stage, not "the next one"

The button says "advance", but the primitive is "put this order at that stage".
The other half of what sent the atelier back to Notion is fixing a mis-click, and
a board that can only move an order forward leaves that trip in place. A
backward move is allowed and simply doesn't email — the notifier's forward-only
rule already says so, and a second rule here could only disagree with it.

### 4. The target is validated against the order's OWN pipeline

Not the live superset. Two reasons, and the second is a hard requirement:

- A repair does not walk `Sketching`; offering it would put a stage on that
  customer's timeline their garment will never reach (see
  `service-pipelines.md`).
- **`Stage` is a Notion `status` property, and Notion will not create a missing
  `status` option through the API** — unlike a `select`, which auto-creates. An
  unvalidated stage name is a 400 from Notion, not a stage change. The refusal
  names the pipeline, because the reason is almost always "that belongs to a
  different service".

The current stage is folded into the list first (`stagesIncludingCurrent`,
extracted from the notifier so both callers run one rule): a stage the atelier
has since renamed out of the live options is still what the order says it is at,
and dropping it would leave the board unable to advance the very order somebody
had just touched.

### 5. `notify: false` advances the marker without sending

A quiet advance has to be quiet **everywhere**. The write fires whatever Notion
automation is configured whether we asked it to or not, so skipping our own send
without moving the marker would let the automation email the very stage the
atelier chose not to announce. Moving the marker suppresses both. It only ever
advances, so a backward quiet move leaves the high-water mark where it was, and
the next genuine forward move still emails.

### 6. The read is a filtered query, not the analytics' full scan

Same reasoning as `listOpenOrderServices`: ask Notion for the orders that are
neither cancelled nor at their final stage, and what comes back is bounded by
the studio's real open workload. The two terminal conditions mirror
`orderLifecycleState`, and the final stage is the **superset's** (`Delivered`
for every pipeline, since each service's stages are a subsequence ending there),
so a repair counts as open until delivered without a per-row pipeline resolve.

### 7. The board never returns the customer's email

It carries `notifiable: boolean` instead. A stage board has no use for the
address, and this is not the endpoint to publish one. Two tests assert the
address is absent from the response body.

### 8. Refusals

- **404** an order that doesn't exist.
- **409** a cancelled order — its tracking page shows a cancelled banner rather
  than a timeline, so moving it along is a change nobody can see.
- **400** a stage the order's service doesn't walk, or an empty one.
- An order **already at** the requested stage is a no-op reported as
  `changed: false` — nothing written, and above all the notifier is never
  reached, so a double press is not a second chance to email.

## Why the webhook was kept

The card's framing is that the automation, the webhook, the marker and the last
secret-bearing URL exist _only_ because stage changes happen in Notion. That is
true, and they are still not deleted — deliberately:

**The atelier can still edit `Stage` in Notion, and will.** Removing the webhook
would silently stop the customer email for every such edit: no error, no log,
just a customer who stops hearing about their order. Retiring it is safe only
once the studio has stopped editing the property by hand, which is their call
and not a code change. What this card removes is the _need_ to, not the ability.

When the atelier does decide to retire it, the sequence is: delete the Notion
database automation, then delete `routes/order-notification.ts` and its mount in
`app.ts`. Two things **stay**, and both are load-bearing to the dashboard rather
than to the webhook: the `Last Notified Stage` marker, which `setOrderStage`
reads to decide whether a move is forward, and
`findOrderForStageNotificationByPageId`, which is how `setOrderStage` has the
notifier re-read the order it just wrote. `CRON_SECRET` would then be sent only
as a header by Vercel Cron, and could be rotated freely.

## The dashboard section

`orders` is a new `STUDIO_SECTIONS` entry, placed second, right after the
figures — it is the most frequently taken action on the dashboard. Only the open
section mounts, so this filtered query runs when somebody is looking at it. A
`GUIDE_SECTIONS` entry of the same id lets the atelier file a how-to beside it.

## Atelier setup

**None.** No env var, no new database, no Notion property. It writes the `Stage`
property and the `Last Notified Stage` marker that already exist, and reads the
`Due Date`, `Service` and `Cancelled` the app already reads.

## Known limits

- **Custom orders only.** A shop order's `Status` is a different workflow with
  its own live list and no per-service pipeline; nothing here reads or writes it.
- **No bulk advance.** One order, one press. A "move these four to Fitting"
  affordance would need a different confirmation shape.
- **The board is one page of open orders, unpaginated.** Bounded by
  `scanDatabase`'s cap, which the studio's open workload is nowhere near.
- **No audit trail in the app.** Who advanced what is in the server logs; Notion
  records the property's own edit history.
