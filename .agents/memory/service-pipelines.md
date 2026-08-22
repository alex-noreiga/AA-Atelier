---
name: A pipeline per service
description: Each service declares the stages its orders walk over the one live Notion superset; the positional rules resolve against the order's pipeline, not the global list. Includes the Notion Milestone Status caveat.
---

# A pipeline per service

Every custom order used to be shown the same eleven `Stage` options, because the
live list was read once per query and attached to every order alike. Right for a
bespoke commission — the list _is_ the commission's pipeline — and wrong for the
other three services: a repair customer watched a timeline promising Sketching,
Sourcing and Pattern Design, stages their order would never reach.

## The shape

**One superset in Notion; the catalog declares each service's sequence over it.**

- `lib/service-catalog.ts` — `OrderServiceDef.pipeline?: readonly string[]`.
  Omitted (the bespoke commission) means "the whole live list", i.e. exactly the
  pre-pipeline behavior.
- `lib/order-pipeline.ts` — `resolveOrderPipeline(service, liveStages)`, pure.
- `lib/notion/orders.repository.ts` — `pipelineFor(page, stages)` narrows the
  shared live list per page, at every site that builds a record.

## Why nothing else had to change

The four positional rules were **already parameterized on a stage list**:
`orderDelivered` / `orderLifecycleState` (`services/delivery.ts`),
`measurementsLocked` (`services/measurement-lock.ts`), `isForwardStageChange`
(`services/order-notification.service.ts`) and `remainingStages` +
`computeMilestoneSchedule` (`services/schedule.service.ts`). None of them was
touched. Handing each record a narrower list is what re-points all four at the
order's own pipeline at once — the whole change is one substitution in the
repository. The frontend needed nothing either: the tracking timeline renders
`OrderStatus.stages`, which is now the pipeline.

## Load-bearing decisions

1. **Declaring a pipeline names live option values; it does not own the list.**
   The same targeted-business-rule exception as `STATUS_IN_STOCK` /
   `MEASUREMENT_LOCK_FROM_STAGE` / `REVIEW_STATUS_PUBLISHED`. The superset stays
   live-read, and the commission pipeline stays un-named — so the atelier can
   still add, rename and reorder stages for a commission without a deploy.

2. **The catalog owns the ORDER, not the live list.** `resolveOrderPipeline`
   emits the declared sequence, not the superset's order, because an alteration
   is pinned at a fitting _before_ anything is cut and the commission list has
   those two the other way round. This is the one thing that makes a pipeline
   more than a filter — see the caveat below.

3. **Degrades in three steps, always toward the widest list.** No declared
   pipeline (or an absent/retired service) ⇒ the live list. A _partial_ name
   match ⇒ honoured, so one Notion rename costs one step off one service's
   timeline. _No_ match ⇒ the live list again, never `[]`: an empty list would
   report the order as never delivered (`orderDelivered` fails closed on `[]`),
   strand its milestones, and render a timeline with no steps.

4. **The order's `Service` property is now READ, and it stores the display
   name.** `buildOrderProperties` writes `service.name` ("Fittings &
   Alterations") because the atelier filters that column — while the contract,
   deep links and the catalog's own lookups use the `id` ("alterations"). So
   `resolveStoredOrderService` accepts **either**, matching names case- and
   whitespace-insensitively. Resolving by id alone would have missed every
   stored order and made the whole feature a silent no-op.

5. **Analytics classify per order, count per superset.** `OrderAnalyticsRecord`
   carries an optional `pipeline`; `buildPipeline` uses `record.pipeline ?? list`
   for the lifecycle state (so a repair is completed at the end of _its_ five
   stages) and `list` for the per-stage buckets. Optional so a record built
   without a live list — and every existing test fixture — falls back to the
   superset rather than being classified against nothing.

6. **The pipeline stays off the `GET /services` contract.** Like `orderLabel`
   and `emailIntro`, it is stripped by `getServiceOptions`: the intake form asks
   what to make, and the stage list reaches the customer on `OrderStatus.stages`
   once there is an order to track.

## The declared pipelines

Over the live superset (Consultation → Sketching → Sourcing → Pattern Design →
Cutting/Pinning → Sewing/Construction → Assembly → Fitting →
Rhinestoning/Detailing → Ready for delivery/pickup → Delivered):

| Service          | Pipeline                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **bespoke**      | _(declares none — the whole live list)_                                                                    |
| **alterations**  | Consultation → **Fitting** → Cutting/Pinning → Sewing/Construction → Ready for delivery/pickup → Delivered |
| **rhinestoning** | Consultation → Sourcing → Rhinestoning/Detailing → Ready for delivery/pickup → Delivered                   |
| **repairs**      | Consultation → Sourcing → Sewing/Construction → Ready for delivery/pickup → Delivered                      |

## The `Milestone Status` caveat — read before reordering a pipeline

The Production Schedule's **`Milestone Status`** formula and the Custom Orders
**`Stage Index Sys`** formula both hardcode the **superset's** order (see
`phase2-workspace-cards.md`). They compare a milestone's stage index against the
order's stage index _in that global order_.

So a pipeline that **reorders** relative to the superset can make those two
Notion formulas render a milestone's state wrongly for that order — today only
**alterations**, whose Fitting comes before Cutting/Pinning. An alterations order
sitting at Fitting has its Cutting/Pinning milestone rendered `Completed` in the
Notion calendar, because Cutting/Pinning is earlier in the global list.

- It is **display-only and atelier-facing**: nothing in the app reads either
  formula, and the customer's timeline is driven by the pipeline and is correct.
- Rhinestoning and repairs are subsequences **in superset order**, so they are
  unaffected. Keep new pipelines that way unless the reorder is worth this.
- The real fix is a per-service index in the formulas (or moving milestone state
  into the app), which belongs with the roadmap's "advance an order's stage from
  the dashboard" card, not here.

## Atelier setup

**None.** Every declared stage already exists as a `Stage` option, so nothing is
added, renamed or reordered in Notion, and no env var is involved. Orders placed
before the `Service` property existed carry no service, resolve to the bespoke
commission, and keep exactly the stage list they have always been shown.

Renaming a `Stage` option the atelier uses in a pipeline silently drops that step
from that service's timeline (point 3) — the same class of breakage a rename
already causes for `MEASUREMENT_LOCK_FROM_STAGE`. Update `pipeline` in
`lib/service-catalog.ts` when renaming one.
