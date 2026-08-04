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
  fittingReminderLeadDays,
  fittingReminderStages,
  reminderCutoffDate,
} from "./fitting-reminder.js";
import {
  isPaymentOverdue,
  paymentReminderLeadDays,
} from "./payment-reminder.js";
import {
  findInvoicesNeedingPaymentReminder,
  markPaymentStageReminded,
} from "../lib/notion/invoice.repository.js";
import {
  findOrderForStageNotificationByPageId,
  findOrdersNeedingMilestones,
  findOrdersWithMilestones,
  markMilestonesGenerated,
  type PendingMilestoneOrder,
} from "../lib/notion/orders.repository.js";
import {
  createMilestone,
  findMilestonesNeedingFittingReminder,
  listOrderMilestonePages,
  markFittingReminderSent,
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
import {
  fittingReminderEmail,
  paymentReminderEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";

export interface MilestoneGenerationResult {
  ordersProcessed: number;
  milestonesCreated: number;
}

/** The full reconciliation result: generation counts, how many existing
 * milestones the status sync advanced, how many fitting reminders were sent, and
 * how many payment (deposit/balance) due reminders were sent. */
export interface MilestoneReconcileResult extends MilestoneGenerationResult {
  milestonesUpdated: number;
  remindersSent: number;
  paymentRemindersSent: number;
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

/** The booking-page deep link that preselects the fitting flow, when
 * PUBLIC_BASE_URL is configured (omitted otherwise, so the email still sends
 * without a broken link). Mirrors `trackingUrl` in order-notification.service.
 * `fitting` is the appointment type id in lib/appointments/catalog.ts. */
function bookingUrl(): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/appointments?type=fitting`;
}

/**
 * Email customers whose fitting milestone is approaching, nudging them to book (or
 * confirm) their fitting. Finds milestones whose `Production Stage` is a configured
 * fitting stage, aren't completed, are due within the lead window, and haven't been
 * reminded yet (services/fitting-reminder.ts + the `Reminder Sent` marker). The
 * milestone rows don't carry the customer email, so each order is resolved back
 * from its `Order` relation. Each reminder is best-effort mail (a Resend failure is
 * logged-and-swallowed, like every other customer email) and the milestone is
 * marked reminded whether or not a mail actually went out — a legacy order with no
 * email can't be reached, and marking it stops the nightly cron from re-checking it
 * forever. If the order lookup itself throws, the milestone is left unmarked so the
 * next run retries it; per-milestone failures are logged and skipped, mirroring the
 * generation/sync passes. Returns the number of reminder emails sent.
 */
export async function sendDueFittingReminders(
  now: Date = new Date(),
): Promise<number> {
  const stages = fittingReminderStages();
  const onOrBefore = reminderCutoffDate(now, fittingReminderLeadDays());

  let milestones;
  try {
    milestones = await findMilestonesNeedingFittingReminder({
      stages,
      onOrBefore,
    });
  } catch (err) {
    await reportError(
      { err },
      "Failed to query fitting-reminder milestones; will retry next run",
    );
    return 0;
  }

  const link = bookingUrl();
  let remindersSent = 0;
  for (const milestone of milestones) {
    try {
      const order = await findOrderForStageNotificationByPageId(
        milestone.orderPageId,
      );
      if (order?.email) {
        await sendEmailBestEffort({
          ...fittingReminderEmail({
            email: order.email,
            orderNumber: order.orderNumber,
            targetDate: milestone.targetDate,
            ...(link ? { bookingUrl: link } : {}),
          }),
          from: fromAddress("appointments"),
        });
        remindersSent += 1;
      }
      // Mark handled even when there was no email to send, so an unreachable
      // (legacy, email-less) order isn't re-checked every night.
      await markFittingReminderSent(milestone.pageId);
    } catch (err) {
      await reportError(
        { err },
        "Failed to send fitting reminder for milestone; will retry next run",
      );
    }
  }

  return remindersSent;
}

/** The customer's order/payment page (`/track?orderNumber=…`) where the deposit +
 * balance pay buttons live, when PUBLIC_BASE_URL is configured (omitted otherwise,
 * so the reminder still sends without a broken link). Mirrors `bookingUrl` above. */
function paymentUrl(orderNumber: string): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/track?orderNumber=${encodeURIComponent(orderNumber)}`;
}

/**
 * Email customers whose deposit or final balance is coming due — or is already
 * overdue — using the due dates on their invoice. Finds invoices with an unpaid
 * stage due within the lead window (services/payment-reminder.ts + the per-stage
 * `Reminded` markers), resolves the customer email off the invoice's `Order`
 * relation, and sends one reminder per due stage. The order is resolved once per
 * invoice, then each due stage is emailed + its marker flipped, so a re-run never
 * re-sends. Each reminder is best-effort mail (a Resend failure is logged-and-
 * swallowed, like every other customer email); a stage's marker is flipped whether
 * or not a mail went out (a legacy order with no email can't be reached, and
 * marking it stops the nightly cron re-checking it forever). If resolving the
 * order throws, the invoice's stages are left unmarked so the next run retries
 * them; per-invoice failures are logged and skipped, mirroring the other passes.
 * Returns the number of reminder emails sent.
 */
export async function sendDuePaymentReminders(
  now: Date = new Date(),
): Promise<number> {
  const onOrBefore = reminderCutoffDate(now, paymentReminderLeadDays());

  let invoices;
  try {
    invoices = await findInvoicesNeedingPaymentReminder({ onOrBefore });
  } catch (err) {
    await reportError(
      { err },
      "Failed to query payment-reminder invoices; will retry next run",
    );
    return 0;
  }

  const todayIso = toIsoDate(now);
  let remindersSent = 0;
  for (const invoice of invoices) {
    // Re-derive which stages qualify (the query filtered by the same conditions;
    // this is belt-and-suspenders and shields against a widened filter).
    const dueStages = invoice.stages.filter(
      (s) => !s.paid && !s.reminded && s.dueDate <= onOrBefore,
    );
    if (dueStages.length === 0) continue;

    try {
      const order = invoice.orderPageId
        ? await findOrderForStageNotificationByPageId(invoice.orderPageId)
        : null;
      const link = order ? paymentUrl(order.orderNumber) : undefined;

      for (const stage of dueStages) {
        if (order?.email) {
          await sendEmailBestEffort({
            ...paymentReminderEmail({
              email: order.email,
              orderNumber: order.orderNumber,
              stageLabel: stage.label,
              dueDate: stage.dueDate,
              overdue: isPaymentOverdue(stage.dueDate, todayIso),
              ...(stage.amount !== undefined ? { amount: stage.amount } : {}),
              ...(link ? { payUrl: link } : {}),
            }),
            from: fromAddress("orders"),
          });
          remindersSent += 1;
        }
        // Mark handled even when there was no email to send, so an unreachable
        // (legacy, email-less) order isn't re-checked every night.
        await markPaymentStageReminded(invoice.pageId, stage.stage);
      }
    } catch (err) {
      await reportError(
        { err },
        "Failed to send payment reminders for invoice; will retry next run",
      );
    }
  }

  return remindersSent;
}

/**
 * The full nightly reconciliation the cron and on-demand button run: generate
 * milestones for orders that just got a due date, re-sync the status of every
 * existing milestone so the "Coming Up" calendar reflects real progress, then
 * email customers whose fitting is approaching and whose deposit/balance is coming
 * due. Generation runs first, so a just-generated order is picked up by the sync
 * in the same pass (its current stage becomes In Progress immediately).
 */
export async function reconcileMilestones(
  now: Date = new Date(),
): Promise<MilestoneReconcileResult> {
  const generation = await generatePendingMilestones(now);
  const milestonesUpdated = await syncMilestoneStatuses();
  const remindersSent = await sendDueFittingReminders(now);
  const paymentRemindersSent = await sendDuePaymentReminders(now);
  return {
    ...generation,
    milestonesUpdated,
    remindersSent,
    paymentRemindersSent,
  };
}
