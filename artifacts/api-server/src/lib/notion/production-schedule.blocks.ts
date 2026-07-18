// Builds the Notion page `properties` for a single per-stage production
// milestone in the "📅 Production Schedule" database. Kept separate from the
// HTTP/Notion request layer so the domain -> Notion mapping is independently
// testable (same split as `blocks.ts` / `shop-orders.blocks.ts`).
//
// Property *types* here must match the live Production Schedule schema, not the
// property name (same lesson as `.agents/memory/notion-status-filters.md`). Two
// properties are new and must be added to that database (the atelier does this
// once): `Production Stage` (select) and `Order` (relation -> Order Tracking
// Pipeline). `Production Stage` is the milestone's stage label (Cutting, Fitting,
// …) and is named apart from `Status` (its completion state) on purpose.

// Live-schema property names (a Notion rename is a one-line change here). The
// milestone row is deliberately lean: the client name and the order's due date
// are reachable through the `Order` relation, so they aren't duplicated here.
export const PS_TITLE_PROPERTY = "Project / Dress Name"; // title
export const PS_STATUS_PROPERTY = "Status"; // status (completion)
export const PS_STAGE_PROPERTY = "Production Stage"; // select — the stage label
export const PS_TARGET_DATE_PROPERTY = "Target Completion Date"; // date
export const PS_ORDER_RELATION_PROPERTY = "Order"; // relation -> orders (new)

/**
 * The three live options on the Production Schedule "Status" property, in
 * workflow order. These name specific option values (not the list), coupling
 * them to code the same way SHOP_ORDER_PAID_STATUS does — rename an option in
 * Notion and you must update it here too. They're used both to seed a new
 * milestone and to keep an existing one in step with its order's live stage
 * (see `milestoneStatusFor` / `syncMilestoneStatuses` in schedule.service).
 */
export const MILESTONE_STATUS_NOT_STARTED = "Not Started";
export const MILESTONE_STATUS_IN_PROGRESS = "In Progress";
export const MILESTONE_STATUS_COMPLETED = "Completed";

export type MilestoneStatus =
  | typeof MILESTONE_STATUS_NOT_STARTED
  | typeof MILESTONE_STATUS_IN_PROGRESS
  | typeof MILESTONE_STATUS_COMPLETED;

/**
 * The "Status" a freshly-generated milestone lands in. "Not Started" is where a
 * new milestone begins; the reconciliation advances it as the order's stage
 * moves past it.
 */
export const PRODUCTION_SCHEDULE_INITIAL_STATUS: MilestoneStatus =
  MILESTONE_STATUS_NOT_STARTED;

/** One stage's target completion date — the unit both the schedule writer
 * (`computeMilestoneSchedule`) and the status-lookup reader
 * (`listOrderMilestones`) exchange, so a read round-trips with the write. */
export interface StageMilestone {
  stage: string;
  /** ISO `yyyy-mm-dd`. */
  targetDate: string;
}

/** Everything needed to write one milestone row. */
export interface MilestoneInput {
  /** Notion page id of the order in the Order Tracking Pipeline (the relation). */
  orderPageId: string;
  /** The row title, e.g. "Ada – Custom Dress — Fitting". */
  projectName: string;
  /** The stage this milestone represents (a live "Stage" option name). */
  stage: string;
  /** The stage's target completion date, ISO `yyyy-mm-dd`. */
  targetDate: string;
}

/** Notion page `properties` for one per-stage production milestone. */
export function buildMilestoneProperties(
  input: MilestoneInput,
): Record<string, unknown> {
  return {
    [PS_TITLE_PROPERTY]: {
      title: [{ text: { content: input.projectName } }],
    },
    // Notion auto-creates a select option the first time a value is written, so
    // we never hardcode the stage option list here — it tracks the live orders
    // "Stage" list the milestones were derived from.
    [PS_STAGE_PROPERTY]: {
      select: { name: input.stage },
    },
    [PS_TARGET_DATE_PROPERTY]: {
      date: { start: input.targetDate },
    },
    [PS_STATUS_PROPERTY]: {
      status: { name: PRODUCTION_SCHEDULE_INITIAL_STATUS },
    },
    [PS_ORDER_RELATION_PROPERTY]: {
      relation: [{ id: input.orderPageId }],
    },
  };
}

/**
 * The `properties` patch that sets *only* a milestone's completion `Status`,
 * used by the reconciliation to advance an existing row without touching its
 * stage, date, or order relation.
 */
export function buildMilestoneStatusUpdate(
  status: MilestoneStatus,
): Record<string, unknown> {
  return {
    [PS_STATUS_PROPERTY]: { status: { name: status } },
  };
}
