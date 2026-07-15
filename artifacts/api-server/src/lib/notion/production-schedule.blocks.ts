// Builds the Notion page `properties` for a single per-stage production
// milestone in the "📅 Production Schedule" database. Kept separate from the
// HTTP/Notion request layer so the domain -> Notion mapping is independently
// testable (same split as `blocks.ts` / `shop-orders.blocks.ts`).
//
// Property *types* here must match the live Production Schedule schema, not the
// property name (same lesson as `.agents/memory/notion-status-filters.md`). Two
// properties are new and must be added to that database (the atelier does this
// once): `Stage` (select) and `Order` (relation -> Order Tracking Pipeline).

// Live-schema property names (a Notion rename is a one-line change here).
export const PS_TITLE_PROPERTY = "Project / Dress Name"; // title
export const PS_CLIENT_NAME_PROPERTY = "Client Name"; // rich_text ("text")
export const PS_STATUS_PROPERTY = "Status"; // status
export const PS_STAGE_PROPERTY = "Stage"; // select (new)
export const PS_TARGET_DATE_PROPERTY = "Target Completion Date"; // date
export const PS_COMPETITION_DATE_PROPERTY = "Competition/Test Date"; // date
export const PS_ORDER_RELATION_PROPERTY = "Order"; // relation -> orders (new)

/**
 * The "Status" option a freshly-generated milestone lands in. Must be one of the
 * live options on the Production Schedule "Status" property (Not Started /
 * In Progress / Completed). "Not Started" is where a new milestone begins; the
 * atelier advances it as work progresses. This names a value, not the list —
 * rename the option in Notion and you must update it here too (a deliberate,
 * targeted business rule, like SHOP_ORDER_PAID_STATUS).
 */
export const PRODUCTION_SCHEDULE_INITIAL_STATUS = "Not Started";

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
  /** The client's name, for the "Client Name" column (may be empty). */
  clientName: string;
  /** The stage this milestone represents (a live "Stage" option name). */
  stage: string;
  /** The stage's target completion date, ISO `yyyy-mm-dd`. */
  targetDate: string;
  /** The order's overall due date, ISO `yyyy-mm-dd` (Competition/Test Date). */
  dueDate?: string;
}

/** Notion page `properties` for one per-stage production milestone. */
export function buildMilestoneProperties(
  input: MilestoneInput,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
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

  if (input.clientName) {
    properties[PS_CLIENT_NAME_PROPERTY] = {
      rich_text: [{ text: { content: input.clientName } }],
    };
  }
  if (input.dueDate) {
    properties[PS_COMPETITION_DATE_PROPERTY] = {
      date: { start: input.dueDate },
    };
  }

  return properties;
}
