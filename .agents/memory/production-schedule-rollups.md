# Production Schedule — "read, not copy" rollups

Phase-2 Workspace roadmap card **"Let the schedule read, not copy"**: the
Production Schedule stored each milestone's stage/order details as its own copy
that a nightly job re-syncs; move it toward relations + rollups that read the
order directly.

## What was already true (so this was smaller than it reads)

The milestone rows were already lean. The `Order` relation
(`PS_ORDER_RELATION_PROPERTY = "Order"`) has existed since the feature shipped, and
the order's **due date, email, and client name were never copied** — they're
resolved through the relation at read time
(`findOrderForStageNotificationByPageId` in `orders.repository.ts`, used by the
fitting/payment reminder passes). The only order-derived data on a row is the
`Production Stage` label (a select) and the order name embedded in the row title
`"{orderName} — {stage}"`.

## What was applied (live, via the Notion connector)

Three **read-only rollups** added to the Production Schedule data source
(`collection://1cf6166a-e1bc-4e36-8417-d6db98d5501e`), each reading the linked
order (Custom Orders, `collection://944a7e5a-b47f-40e4-87d2-f4743f08428f`) through
the existing `Order` relation:

| Rollup property  | Order source property | target type |
| ---------------- | --------------------- | ----------- |
| `Order Number`   | `Order Number`        | text        |
| `Order Due Date` | `Due Date`            | date        |
| `Customer`       | `Order Name` (title)  | title       |

(`Customer` rolls up the order's title, which always exists — the `Client` CRM
relation was the alternative but isn't always set.) All three surfaced on the
`Timeline View`, `Calendar View`, and `The Truth` table views so the schedule
identifies a milestone's order without opening it.

## The one thing that stays app-written (and why)

`syncMilestoneStatuses` (`schedule.service.ts`) and the `Production Stage` write
are **kept**. The milestone `Status` (Not Started / In Progress / Completed) is a
_positional_ completion state — `milestoneStatusFor` compares the milestone's
stage against the order's live `Stage` in the live pipeline order. A Notion rollup
can't compute that without hardcoding the stage ordering in a formula, which the
"never hardcode a Notion option list" rule (`notion-status-filters.md`) forbids. So
the card is a "move _toward_", not a "retire the sync": the rollups cover order
context; the app keeps the one field Notion can't derive. `Production Stage` also
can't become a rollup — the fitting-reminder query filters it as a `select`
(`findMilestonesNeedingFittingReminder`), and orders' `Stage` is a `status`.

## Load-bearing

- The rollups are **display-only and unread by code** — additive, safe (the app
  reads/writes Production Schedule by exact property name and touches none of them).
- **No code/logic change** was made: `schedule.service.ts`,
  `production-schedule.{blocks,repository}.ts`, and the row title are untouched. No
  new env var, no migration, no OpenAPI/contract change (this DB is outside the
  contract). Docs updated: this note, `CLAUDE.md` (Production schedule section),
  `.env.example`.
