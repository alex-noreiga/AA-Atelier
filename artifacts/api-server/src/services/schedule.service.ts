// Production-schedule reconciliation, independent of HTTP.
//
// Notion can't push the app when the atelier sets an order's due date (there's
// no Notion -> app trigger), so we reconcile on a schedule instead: find orders
// that have a due date but no milestones yet, and generate one dated milestone
// per remaining stage in the Production Schedule. The `Milestones Generated`
// checkbox on the order (plus an existing-milestones lookup) guards against
// duplicates, mirroring the shop-orders webhook's idempotency.

import { logger } from "../lib/logger.js";
import {
  findOrdersNeedingMilestones,
  markMilestonesGenerated,
  type PendingMilestoneOrder,
} from "../lib/notion/orders.repository.js";
import {
  createMilestone,
  orderHasMilestones,
} from "../lib/notion/production-schedule.repository.js";
import type { StageMilestone } from "../lib/notion/production-schedule.blocks.js";

// StageMilestone now lives with the other Production Schedule domain types in
// production-schedule.blocks.ts (so the milestone reader and writer share it);
// re-export it here to keep this module's existing import path working.
export type { StageMilestone } from "../lib/notion/production-schedule.blocks.js";

export interface MilestoneGenerationResult {
  ordersProcessed: number;
  milestonesCreated: number;
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

/** The client's name for the milestone row, derived from the order name
 * (`"{fullName} – Custom Dress"`). Falls back to the full order name. */
function clientNameFromOrder(orderName: string): string {
  const [name] = orderName.split(" – ");
  return name?.trim() || orderName;
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
  const clientName = clientNameFromOrder(order.orderName);

  for (const milestone of schedule) {
    await createMilestone({
      orderPageId: order.pageId,
      projectName: `${order.orderName} — ${milestone.stage}`,
      clientName,
      stage: milestone.stage,
      targetDate: milestone.targetDate,
      dueDate: order.dueDate,
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
      logger.error(
        { err, orderNumber: order.orderNumber },
        "Failed to generate milestones for order; will retry next run",
      );
    }
  }

  return { ordersProcessed, milestonesCreated };
}
