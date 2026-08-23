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

**One superset in Notion, widened; the catalog declares each service's share.**

The superset was the eleven commission stages, so the other three services could
only be described in a commission's vocabulary — a torn seam moving through
"Sewing/Construction", which reads to the customer as their garment being built
from scratch. It now also carries the three stages a piece the customer already
owns needs: **`Piece Received`**, **`Alteration/Adjustment`**,
**`Repair/Restoration`**.

- `lib/service-catalog.ts` — `OrderServiceDef.pipeline?: ServicePipeline`, one of
  `{ kind: "select", stages }` or `{ kind: "exclude", stages }`.
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
   live-read.

2. **The commission EXCLUDES; the other three SELECT — and that asymmetry is the
   point.** Once the superset holds stages no commission walks, "declare nothing
   and inherit the live list" stops being right for bespoke: it would put
   `Repair/Restoration` on a commission's tracking page. The obvious fix — give
   bespoke a select-list of its eleven — would have silently cost the property
   the repo cares most about, that the atelier can **add, rename or reorder a
   commission stage in Notion and see it with no deploy**. An exclusion keeps
   it: bespoke is "everything Notion says, minus the three piece-in-hand
   stages", so a twelfth commission stage flows straight through.
   `test/unit/order-pipeline.test.ts` pins both halves (a new stage is adopted;
   the three never appear).

3. **`PIECE_IN_HAND_STAGES` is named once and guarded by a test.** The exclusion
   list and the three selections could drift — a fourth service stage added to
   one and not the other would put it on every commission timeline, with no
   error anywhere. The drift guard asserts every stage any service _selects_ is
   either walked or excluded by the commission, so that mistake fails CI.

4. **The catalog owns the ORDER of a selection.** `resolveOrderPipeline` emits
   the declared sequence, not the superset's — an alteration is pinned at a
   fitting _before_ the work is done on it. See the ordering note below, which
   is why the recommended superset order makes every current pipeline agree with
   it anyway.

5. **Degrades in three steps, always toward the widest list.** No declared
   pipeline ⇒ the live list (the floor for a service that can't be resolved). A
   _partial_ select match ⇒ honoured, so one Notion rename costs one step off
   one service's timeline. _No_ match (or an exclusion that removes everything)
   ⇒ the live list again, never `[]`: an empty list would report the order as
   never delivered (`orderDelivered` fails closed on `[]`), strand its
   milestones, and render a timeline with no steps.

   This is also what makes the Notion setup **non-blocking**: until the three
   options are added, a repair's own stages simply aren't matched and its
   customer sees a shorter but still correct timeline. Adding the options
   completes it with no deploy.

6. **The order's `Service` property is now READ, and it stores the display
   name.** `buildOrderProperties` writes `service.name` ("Fittings &
   Alterations") because the atelier filters that column — while the contract,
   deep links and the catalog's own lookups use the `id` ("alterations"). So
   `resolveStoredOrderService` accepts **either**, matching names case- and
   whitespace-insensitively. Resolving by id alone would have missed every
   stored order and made the whole feature a silent no-op.

7. **Analytics classify per order, count per superset.** `OrderAnalyticsRecord`
   carries an optional `pipeline`; `buildPipeline` uses `record.pipeline ?? list`
   for the lifecycle state (so a repair is completed at the end of _its_ six
   stages) and `list` for the per-stage buckets. Optional so a record built
   without a live list — and every existing test fixture — falls back to the
   superset rather than being classified against nothing.

8. **The pipeline stays off the `GET /services` contract.** Like `orderLabel`
   and `emailIntro`, it is stripped by `getServiceOptions`: the intake form asks
   what to make, and the stage list reaches the customer on `OrderStatus.stages`
   once there is an order to track.

## The declared pipelines

Over the recommended superset order (Consultation → **Piece Received** →
Sketching → Sourcing → Pattern Design → Cutting/Pinning → Sewing/Construction →
Assembly → Fitting → **Alteration/Adjustment** → **Repair/Restoration** →
Rhinestoning/Detailing → Ready for delivery/pickup → Delivered):

| Service          | Pipeline                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| **bespoke**      | _excludes the three piece-in-hand stages_ ⇒ the original eleven, unchanged                                |
| **alterations**  | Consultation → Piece Received → Fitting → Alteration/Adjustment → Ready for delivery/pickup → Delivered   |
| **rhinestoning** | Consultation → Piece Received → Sourcing → Rhinestoning/Detailing → Ready for delivery/pickup → Delivered |
| **repairs**      | Consultation → Piece Received → Sourcing → Repair/Restoration → Ready for delivery/pickup → Delivered     |

## Stage ORDER in Notion is load-bearing — put the three new options in the right place

The Production Schedule's **`Milestone Status`** formula and the Custom Orders
**`Stage Index Sys`** formula both index against the **superset's** order (see
`phase2-workspace-cards.md`). A pipeline that **reorders** relative to it makes
those formulas render a milestone's state wrongly for that order — display-only
and atelier-facing (nothing in the app reads them, and the customer's timeline
is driven by the pipeline), but wrong.

**In the order above, every pipeline is a straight subsequence of the superset,
so the problem does not arise.** That is exactly why `Alteration/Adjustment`
goes _after_ `Fitting`: alterations are fitted before they are adjusted, and
giving the work its own stage in that position is what let the customer-facing
sequence be right _and_ stay in superset order. `test/unit/order-pipeline.test.ts`
asserts this property, so a future pipeline that breaks it fails CI.

Put the options somewhere else and the caveat comes back for whichever pipeline
now disagrees.

## Atelier setup

**Three `Stage` options to add**, on the **Custom Orders** (Order Tracking
Pipeline) database, positioned as above:

1. **`Piece Received`** — immediately after `Consultation`.
2. **`Alteration/Adjustment`** — immediately after `Fitting`.
3. **`Repair/Restoration`** — immediately after `Alteration/Adjustment`.

Nothing else: no env var, no new property, no new database. The deploy is safe
before this is done (point 5) and completes itself the moment the options exist,
since the stage list is read live.

**Then update the two formulas**, or milestones sitting on the new stages read
blank. `Stage Index Sys` on Custom Orders maps the live `Stage` → its index and
currently enumerates 11 options; it needs the three new ones at their new
positions (so the list runs 0–13), and `Milestone Status` on Production Schedule
needs the matching literals. Both already degrade to blank for an option they
don't know, so the failure mode is a blank calendar cell rather than a wrong one
— but it is worth doing in the same pass. Watch the DDL gotchas in
`phase2-workspace-cards.md` (drop and re-add a formula in **separate** calls, and
no parens in a column name).

Orders placed before the `Service` property existed carry no service, resolve to
the bespoke commission, and keep exactly the stage list they have always been
shown.

Renaming a `Stage` option a pipeline selects silently drops that step from that
service's timeline (point 5) — the same class of breakage a rename already causes
for `MEASUREMENT_LOCK_FROM_STAGE`. Update `pipeline` in `lib/service-catalog.ts`
when renaming one.

## Customer-facing copy added with the stages

Timeline (`web-app/src/lib/stage-descriptions.ts`) and status email
(`lib/resend/emails.ts`, phrased to follow "We're now …"):

| Stage                 | Timeline                                                                 | Email                                                            |
| --------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Piece Received        | "Your piece has arrived safely at the atelier and is booked in with us." | "booking your piece in."                                         |
| Alteration/Adjustment | "We're making the adjustments we pinned at your fitting."                | "making the adjustments we pinned at your fitting."              |
| Repair/Restoration    | "We're carefully mending your piece and bringing it back to its best."   | "carefully mending your piece and bringing it back to its best." |
