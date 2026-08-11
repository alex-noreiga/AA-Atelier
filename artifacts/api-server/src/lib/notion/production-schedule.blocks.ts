// Builds the Notion page `properties` for a single per-stage production
// milestone in the "📅 Production Schedule" database. Kept separate from the
// HTTP/Notion request layer so the domain -> Notion mapping is independently
// testable (same split as `blocks.ts` / `shop-orders.blocks.ts`).
//
// Property *types* here must match the live Production Schedule schema, not the
// property name (same lesson as `.agents/memory/notion-status-filters.md`).
// `Production Stage` (select) is the milestone's stage label (Cutting, Fitting,
// …); the milestone's *completion state* is the derived `Milestone Status`
// formula (see below), read live from the order's Stage rather than hand-synced.

// Live-schema property names (a Notion rename is a one-line change here). The
// milestone row is deliberately lean: the client name and the order's due date
// are reachable through the `Order` relation, so they aren't duplicated here.
export const PS_TITLE_PROPERTY = "Project / Dress Name"; // title
// Formula (string) — the milestone's completion state, DERIVED in Notion from the
// order's live Stage (via an `Order Stage Index` rollup) compared against this
// row's Production Stage over the fixed pipeline order. It replaces the old
// hand-synced `Status` status-property: the app no longer writes a completion
// state, so there is no nightly status-sync pass. The fitting-reminder query
// filters on it. See CLAUDE.md "Production schedule" +
// `.agents/memory/phase2-workspace-cards.md`.
export const PS_MILESTONE_STATUS_PROPERTY = "Milestone Status";
export const PS_STAGE_PROPERTY = "Production Stage"; // select — the stage label
export const PS_TARGET_DATE_PROPERTY = "Target Completion Date"; // date
export const PS_ORDER_RELATION_PROPERTY = "Order"; // relation -> orders
// checkbox — the fitting-reminder de-dupe marker (the atelier adds this once; the
// app flips it once a fitting reminder has been emailed, so the nightly cron never
// re-sends). An absent/unchecked box reads as false, which the query matches.
export const PS_REMINDER_SENT_PROPERTY = "Reminder Sent";

/**
 * Two of the three completion states the derived `Milestone Status` formula can
 * return, named here because the fitting-reminder query filters on them: a
 * milestone not yet done (`does_not_equal` "Completed") and one the order has
 * reached (`equals` "In Progress"). They must match the exact strings the Notion
 * formula emits — the same targeted-business-rule coupling as STATUS_IN_STOCK.
 */
export const MILESTONE_STATUS_IN_PROGRESS = "In Progress";
export const MILESTONE_STATUS_COMPLETED = "Completed";

/** One stage's target completion date — the unit both the schedule writer
 * (`computeMilestoneSchedule`) and the status-lookup reader
 * (`listOrderMilestones`) exchange, so a read round-trips with the write. */
export interface StageMilestone {
  stage: string;
  /** ISO `yyyy-mm-dd`. */
  targetDate: string;
}

/** A milestone that's due for a fitting reminder — the fields the reminder pass
 * needs: the page (to mark reminded), its stage + target date (for the email),
 * and the linked order's page id (to resolve the customer email). */
export interface FittingReminderMilestone {
  pageId: string;
  stage: string;
  /** ISO `yyyy-mm-dd`. */
  targetDate: string;
  /** Notion page id of the linked order (the `Order` relation). */
  orderPageId: string;
}

/** Everything needed to write one milestone row. */
export interface MilestoneInput {
  /** Notion page id of the order in the Order Tracking Pipeline (the relation). */
  orderPageId: string;
  /** The row title, e.g. "Ada – Custom Costume — Fitting". */
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
    // No completion state is written: `Milestone Status` is a Notion formula
    // derived from the order's live Stage, so a new milestone reflects the order
    // immediately with nothing to seed or sync.
    [PS_ORDER_RELATION_PROPERTY]: {
      relation: [{ id: input.orderPageId }],
    },
  };
}

/** The `properties` patch that marks a milestone's fitting reminder as sent, so
 * the nightly reconciliation doesn't email the customer about it again. */
export function buildReminderSentUpdate(): Record<string, unknown> {
  return {
    [PS_REMINDER_SENT_PROPERTY]: { checkbox: true },
  };
}
