# Production Schedule — auto-generated stage milestones

Custom orders get a due date after they're quoted (offline). Once that date is
set, the app auto-fills the **"📅 Production Schedule"** Notion database with one
dated **milestone row per remaining stage**, so the atelier's Timeline/Calendar
views show when each stage must finish.

## Why a cron, not a Notion push

Notion cannot notify the app when a property changes (the same constraint that
keeps order status-change emails out of the app). So generation can't be
event-driven. Instead a **Vercel Cron** job (`crons` in `vercel.json`) calls
`GET /api/cron/generate-milestones` daily; it scans the Order Tracking Pipeline
for orders where `Due Date` is set **and** `Milestones Generated` is unchecked,
and generates their milestones. The endpoint is guarded by a `CRON_SECRET` bearer
token (Vercel sends it automatically) and is **deliberately outside the OpenAPI
contract** — a scheduler→server endpoint like the Stripe webhook — so it's mounted
directly in `app.ts`, not the `/api` router, and has no generated client.

Cron frequency is plan-gated on Vercel: **Hobby allows once per day** (and fires
within the hour of the scheduled time, not to the minute); Pro allows down to
per-minute. The default is `0 8 * * *` (08:00 UTC daily) so it deploys on Hobby;
bump it up on Pro if you want milestones to appear sooner after a due date is set.

## On-demand trigger — a Notion button (same job, no waiting for the cron)

To generate milestones immediately (rather than wait for the nightly cron), the
atelier presses a Notion **Button** → "Open link" pointed at
`GET /api/cron/generate-milestones/run?secret=<CRON_SECRET>`. It calls the exact
same `generatePendingMilestones()` and returns a small HTML confirmation page for
the tab it opens (the cron path returns JSON; this one returns HTML because a
browser tab opens it). Both handlers live in `routes/cron.ts`, mounted side by
side in `app.ts`. The nightly cron stays as a safety net.

Auth is a **query-param token** (not the Bearer header the cron uses) because a
native Notion button can only open a URL — it can't send headers. It reuses
`CRON_SECRET` to avoid another env var. Tradeoff: the token sits in the button's
config and browser history. The request logger strips query strings, so it isn't
logged, and the action is idempotent + low-stakes (it only writes schedule rows
for orders the atelier already set a `Due Date` on). Rotate `CRON_SECRET`, or add
a dedicated token, if that exposure matters. HTML errors are rendered **inline**
in the handler — the shared `errorHandler` only emits JSON.

## Scheduling algorithm (even split — no hardcoded stages)

`computeMilestoneSchedule(dueDate, stagesToSchedule, from)` in
`services/schedule.service.ts` is a pure function: it takes the stages from the
order's **current stage forward** (`remainingStages`) and spreads them evenly over
`[from(today), dueDate]`, so the last stage lands exactly on the due date. A
due date that's today/past clamps every milestone to the due date.

The stage list is read **live** from Notion (`fetchLiveOrderStages`), never
hardcoded — so it tracks the atelier's edits (same rule as everywhere else, see
`notion-status-filters.md`). The milestone's `Production Stage` is written to a
Notion **select** property, and Notion auto-creates the option on first write, so
no stage constant is baked into the block builder either.

## Idempotency & rescheduling

Two guards stop duplicates:

1. `Milestones Generated` (checkbox on the order) — the cron's primary filter.
   It's flipped to true **only after every milestone row for an order is written**,
   so a mid-batch failure leaves it unchecked and the next run retries the order.
2. `orderHasMilestones(orderPageId)` — a lookup on the Production Schedule by the
   `Order` relation, run before creating, so even if the checkbox somehow didn't
   stick, an order that already has rows just gets its checkbox flipped, not a
   second set of rows.

One order's failure is logged (`error`) and skipped, never aborting the batch —
the same resilience posture as the shipping-rate handling in `checkout.service`.

**To reschedule** after changing a due date: uncheck `Milestones Generated` on the
order and delete the stale milestone rows; the next cron run regenerates from the
new date. A smarter per-stage upsert (update in place) is intentionally not built.

Known edge (accepted for v1): if `createMilestone` fails partway through an order
that had **no** prior rows, the successful rows persist while the checkbox stays
unchecked; the next run's `orderHasMilestones` sees those rows and flips the
checkbox **without** creating the missing ones. Rare; the fix if it bites is the
per-stage upsert above.

## Current status — dormant (as of 2026-07)

The Production Schedule database is intentionally **empty** right now, and that is
expected, not a bug: **no orders in the Order Tracking Pipeline carry a `Due
Date`**. `findOrdersNeedingMilestones` filters on `Due Date is_not_empty AND
Milestones Generated = false`, so with no due dates it matches nothing and the
cron writes no rows. Because the `Production Stage` **select** only gets options
when the cron writes its first milestone (Notion auto-creates select options on
write), that select is also still empty. The code path is correct and verified —
it simply has no input yet.

To **activate** it: set a `Due Date` on a real order (leave `Milestones Generated`
unchecked), then either let the nightly Vercel cron run or press the on-demand
Notion button (`.../generate-milestones/run?secret=<CRON_SECRET>`). Milestone rows
appear and the `Production Stage` options auto-create on that first write. Also
confirm `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID` + `CRON_SECRET` are set in Vercel
and the integration is shared with the database, or the run no-ops / 401s.

## One-time Notion setup

- **Order Tracking Pipeline** (the orders DB): add `Due Date` (date) +
  `Milestones Generated` (checkbox). Property names in `lib/notion/orders.schema.ts`.
- **Production Schedule**: add `Production Stage` (select) + `Order` (relation →
  Order Tracking Pipeline). Existing `Project / Dress Name`, `Status`, and
  `Target Completion Date` are reused. (`Production Stage` is the stage label —
  named apart from `Status`, the completion state, on purpose, after an earlier
  mixup. The redundant `Client Name` and `Competition/Test Date` columns were
  dropped — both were write-only duplicates of data reachable through the `Order`
  relation.) Property names in `lib/notion/production-schedule.blocks.ts`.
- Share the Notion integration with the Production Schedule database (else 404).
- (Optional) a **Button** → "Open link" → `.../generate-milestones/run?secret=…`
  on a dashboard page, for on-demand generation (see the on-demand section above).
- Env: `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`, `CRON_SECRET`.

## Code map

`routes/cron.ts` → `services/schedule.service.ts` →
`lib/notion/orders.repository.ts` (`findOrdersNeedingMilestones`,
`markMilestonesGenerated`) + `lib/notion/production-schedule.repository.ts`
(`createMilestone`, `orderHasMilestones`) + `production-schedule.blocks.ts`
(`buildMilestoneProperties`).
