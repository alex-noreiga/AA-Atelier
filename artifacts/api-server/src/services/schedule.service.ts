// Production-schedule reconciliation, independent of HTTP.
//
// Notion can't push the app when the atelier sets an order's due date (there's
// no Notion -> app trigger), so we reconcile on a schedule instead: find orders
// that have a due date but no milestones yet, and generate one dated milestone
// per remaining stage in the Production Schedule. The `Milestones Generated`
// checkbox on the order (plus an existing-milestones lookup) guards against
// duplicates, mirroring the shop-orders webhook's idempotency.

import { reportError } from "./alert.service.js";
import {
  findOrdersNeedingMilestones,
  findOrdersWithMilestones,
  markMilestonesGenerated,
  type PendingMilestoneOrder,
} from "../lib/notion/orders.repository.js";
import {
  createMilestone,
  listOrderMilestonePages,
  orderHasMilestones,
  updateMilestoneStatus,
} from "../lib/notion/production-schedule.repository.js";
import {
  MILESTONE_STATUS_COMPLETED,
  MILESTONE_STATUS_IN_PROGRESS,
  MILESTONE_STATUS_NOT_STARTED,
  type MilestoneStatus,
  type StageMilestone,
} from "../lib/notion/production-schedule.blocks.js";

// StageMilestone now lives with the other Production Schedule domain types in
// production-schedule.blocks.ts (so the milestone reader and writer share it);
// re-export it here to keep this module's existing import path working.
export type { StageMilestone } from "../lib/notion/production-schedule.blocks.js";

export interface MilestoneGenerationResult {
  ordersProcessed: number;
  milestonesCreated: number;
}

/** The full reconciliation result: generation counts plus how many existing
 * milestones the status sync advanced. */
export interface MilestoneReconcileResult extends MilestoneGenerationResult {
  milestonesUpdated: number;
}

/** Format a Date as an ISO calendar date (`yyyy-mm-dd`), in UTC. */
function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * The stages that still need a milestone: from the order's current stage forward
 * to the end of the live ordered list (so completed stages don't get deadlines).
 * If the current stage isn't in the list — e.g. it was renamed in Notion — fall
 * back to scheduling the whole list rather than nothing.
 */
export function remainingStages(
  stages: string[],
  currentStage: string,
): string[] {
  const index = stages.indexOf(currentStage);
  return index >= 0 ? stages.slice(index) : stages;
}

/**
 * Spread `stagesToSchedule` evenly across the window `[from, dueDate]`, so the
 * final stage lands on the due date and earlier stages are spaced back from it.
 * If the window is non-positive (the due date is today or already past), every
 * milestone clamps to the due date. Even-split keeps the scheduler agnostic to
 * the stage names, so it adapts automatically to the live Notion stage list.
 */
export function computeMilestoneSchedule(
  dueDate: Date,
  stagesToSchedule: string[],
  from: Date,
): StageMilestone[] {
  const count = stagesToSchedule.length;
  if (count === 0) return [];

  const windowMs = dueDate.getTime() - from.getTime();
  return stagesToSchedule.map((stage, i) => {
    if (windowMs <= 0) {
      return { stage, targetDate: toIsoDate(dueDate) };
    }
    const offsetMs = Math.round((windowMs * (i + 1)) / count);
    return {
      stage,
      targetDate: toIsoDate(new Date(from.getTime() + offsetMs)),
    };
  });
}

async function generateForOrder(
  order: PendingMilestoneOrder,
  now: Date,
): Promise<number> {
  // Belt-and-suspenders idempotency: if rows already exist for this order (a
  // prior run created them but the checkbox didn't stick), don't duplicate —
  // just flip the marker.
  if (await orderHasMilestones(order.pageId)) {
    await markMilestonesGenerated(order.pageId);
    return 0;
  }

  const stages = remainingStages(order.stages, order.currentStage);
  const schedule = computeMilestoneSchedule(
    new Date(order.dueDate),
    stages,
    now,
  );
  for (const milestone of schedule) {
    await createMilestone({
      orderPageId: order.pageId,
      projectName: `${order.orderName} — ${milestone.stage}`,
      stage: milestone.stage,
      targetDate: milestone.targetDate,
    });
  }

  // Only mark generated after every row is written, so a mid-batch failure
  // leaves the checkbox unchecked and the next cron run retries the order.
  await markMilestonesGenerated(order.pageId);
  return schedule.length;
}

/**
 * Reconcile all orders that need milestones. Each order is processed
 * independently: one order's failure is logged and skipped (its checkbox stays
 * unchecked, so the next run retries it) rather than aborting the whole batch —
 * the same resilience posture as the shipping-rate handling in checkout.service.
 */
export async function generatePendingMilestones(
  now: Date = new Date(),
): Promise<MilestoneGenerationResult> {
  const orders = await findOrdersNeedingMilestones();

  let ordersProcessed = 0;
  let milestonesCreated = 0;

  for (const order of orders) {
    try {
      milestonesCreated += await generateForOrder(order, now);
      ordersProcessed += 1;
    } catch (err) {
      await reportError(
        { err, orderNumber: order.orderNumber },
        "Failed to generate milestones for order; will retry next run",
      );
    }
  }

  return { ordersProcessed, milestonesCreated };
}

/**
 * The completion status a milestone *should* have, given where its order is now.
 * Positions the milestone's stage against the order's current stage in the live
 * ordered list:
 *   - a stage the order has moved past  → Completed
 *   - the stage the order is working now → In Progress (Completed if it's the
 *     final stage, i.e. the order is delivered — nothing is "in progress" then)
 *   - a stage still ahead                → Not Started
 * If either stage isn't in the live list (e.g. a milestone whose stage was
 * renamed, or a blank Production Stage), it falls back to Not Started rather than
 * guessing — the caller skips blank-stage rows entirely. Ordering comes from the
 * live Notion stage list, so no stage names are baked in here.
 */
export function milestoneStatusFor(
  orderedStages: string[],
  currentStage: string,
  milestoneStage: string,
): MilestoneStatus {
  const current = orderedStages.indexOf(currentStage);
  const mine = orderedStages.indexOf(milestoneStage);
  if (current < 0 || mine < 0) return MILESTONE_STATUS_NOT_STARTED;
  if (mine < current) return MILESTONE_STATUS_COMPLETED;
  if (mine > current) return MILESTONE_STATUS_NOT_STARTED;
  // The order is at this exact stage: in progress, unless it's the last stage
  // (the order is delivered/complete), in which case the milestone is done.
  return current === orderedStages.length - 1
    ? MILESTONE_STATUS_COMPLETED
    : MILESTONE_STATUS_IN_PROGRESS;
}

/**
 * Bring every existing milestone's `Status` back in line with its order's live
 * stage, so a schedule generated weeks ago doesn't sit frozen at "Not Started".
 * For each order that has milestones, only rows whose status actually changed are
 * PATCHed (blank-stage rows are left alone). Per-order failures are logged and
 * skipped — one order can't abort the batch — mirroring the generation pass.
 */
export async function syncMilestoneStatuses(): Promise<number> {
  const orders = await findOrdersWithMilestones();

  let milestonesUpdated = 0;
  for (const order of orders) {
    try {
      const pages = await listOrderMilestonePages(order.pageId);
      for (const page of pages) {
        if (!page.stage) continue; // can't place a stageless row — leave it
        const desired = milestoneStatusFor(
          order.stages,
          order.currentStage,
          page.stage,
        );
        if (desired !== page.status) {
          await updateMilestoneStatus(page.pageId, desired);
          milestonesUpdated += 1;
        }
      }
    } catch (err) {
      await reportError(
        { err, orderNumber: order.orderNumber },
        "Failed to sync milestone statuses for order; will retry next run",
      );
    }
  }

  return milestonesUpdated;
}

/**
 * The full nightly reconciliation the cron and on-demand button run: generate
 * milestones for orders that just got a due date, then re-sync the status of
 * every existing milestone so the "Coming Up" calendar reflects real progress.
 * Generation runs first, so a just-generated order is picked up by the sync in
 * the same pass (its current stage becomes In Progress immediately).
 */
export async function reconcileMilestones(
  now: Date = new Date(),
): Promise<MilestoneReconcileResult> {
  const generation = await generatePendingMilestones(now);
  const milestonesUpdated = await syncMilestoneStatuses();
  return { ...generation, milestonesUpdated };
}
