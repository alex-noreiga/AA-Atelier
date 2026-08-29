// Production-schedule reconciliation, independent of HTTP.
//
// Notion can't push the app when the atelier sets an order's due date (there's
// no Notion -> app trigger), so we reconcile on a schedule instead: find orders
// that have a due date but no milestones yet, and generate one dated milestone
// per remaining stage in the Production Schedule. The `Milestones Generated`
// checkbox on the order (plus an existing-milestones lookup) guards against
// duplicates, mirroring the shop-orders webhook's idempotency.

import { reportError } from "./alert.service.js";
import { logger } from "../lib/logger.js";
import { notifyRestock } from "./restock-notification.service.js";
import { sendWeeklyMaterialsDigest } from "./materials-digest.service.js";
import { notifyUpcomingAppointments } from "./appointment-reminder.service.js";
import { refreshInstagramToken } from "../lib/instagram/token.js";
import { paymentStageLabel } from "./payment-labels.js";
import { resolveStoredOrderService } from "../lib/service-catalog.js";
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
  markMilestonesGenerated,
  type PendingMilestoneOrder,
} from "../lib/notion/orders.repository.js";
import {
  createMilestone,
  findMilestonesNeedingFittingReminder,
  markFittingReminderSent,
  orderHasMilestones,
} from "../lib/notion/production-schedule.repository.js";
import { type StageMilestone } from "../lib/notion/production-schedule.blocks.js";
import {
  fittingReminderEmail,
  paymentReminderEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { paymentDueSms } from "../lib/twilio/messages.js";
import { textCustomer } from "./sms.service.js";
import { fromAddress } from "../lib/resend/config.js";

export interface MilestoneGenerationResult {
  ordersProcessed: number;
  milestonesCreated: number;
}

/** The full reconciliation result: generation counts, plus what each notification
 * pass sent — fitting reminders, payment (deposit/balance) due reminders,
 * back-in-stock alerts, and day-before appointment reminders.
 * (Milestone completion state is now a live Notion formula — `Milestone Status`,
 * derived from the order's stage — so there is no status-sync pass to count.) */
export interface MilestoneReconcileResult extends MilestoneGenerationResult {
  remindersSent: number;
  paymentRemindersSent: number;
  restockAlertsSent: number;
  appointmentRemindersSent: number;
  /** Materials listed in the weekly digest; 0 on the six days it doesn't run. */
  materialsDigestItems: number;
  /** Whether tonight's run renewed the Instagram access token. False on the
   * ~46 nights out of every 60 when it isn't yet near expiry, and on a run that
   * couldn't renew it (which alerts). */
  instagramTokenRefreshed: boolean;
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

// Milestone completion state is no longer computed or written here: the
// Production Schedule's `Milestone Status` is a Notion formula derived live from
// the order's Stage (via an `Order Stage Index` rollup), so a milestone reflects
// the order's real progress with no nightly sync. The old `milestoneStatusFor` +
// `syncMilestoneStatuses` pass (and its `updateMilestoneStatus` writes) were
// retired with that change — see `.agents/memory/phase2-workspace-cards.md`.

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
  let textsSent = 0;
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
          // Both channels are told the same thing from the same values — the
          // stage's label, its date and its amount are resolved once here, so a
          // customer can't be emailed one figure and texted another.
          const stageLabel = paymentStageLabel(
            stage.stage,
            resolveStoredOrderService(order.service).payment,
            stage.label,
            { soleDeposit: invoice.depositCount === 1 },
          );
          const overdue = isPaymentOverdue(stage.dueDate, todayIso);

          await sendEmailBestEffort({
            ...paymentReminderEmail({
              email: order.email,
              orderNumber: order.orderNumber,
              stageLabel,
              dueDate: stage.dueDate,
              overdue,
              ...(stage.amount !== undefined ? { amount: stage.amount } : {}),
              ...(link ? { payUrl: link } : {}),
            }),
            from: fromAddress("orders"),
          });
          remindersSent += 1;

          // And a text, for the customers who asked for one. No marker of its
          // own: the stage's existing `Reminded` checkbox already gates this
          // whole block, so the two channels share one "told them once" record
          // — which is right here, because unlike an appointment there is no
          // reschedule that could make the same stage worth saying twice.
          // Best-effort and unreported: the email above is the reminder, the
          // text is a nudge toward it.
          if (
            (await textCustomer(order.email, (to) =>
              paymentDueSms({
                to,
                orderNumber: order.orderNumber,
                stageLabel,
                dueDate: stage.dueDate,
                overdue,
                ...(stage.amount !== undefined ? { amount: stage.amount } : {}),
                ...(link ? { payUrl: link } : {}),
              }),
            )) === "sent"
          ) {
            textsSent += 1;
          }
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

  if (textsSent > 0) {
    logger.info({ textsSent }, "Sent payment-reminder texts");
  }
  return remindersSent;
}

/**
 * Alert everyone waiting on a shop piece that has come back in stock.
 *
 * A restock is an edit inside Notion with no trigger to hang off, so — like the
 * fitting and payment reminders above — it rides this nightly run rather than
 * asking the atelier to wire a webhook. `notifyRestock` reads live inventory
 * itself and claims each request in Postgres, so this pass is just the schedule:
 * it neither decides what is in stock nor tracks who has been told. The atelier's
 * "now, not tonight" path is the studio dashboard's own tool, which calls the
 * same function.
 *
 * Swallows its own failure (alerting instead) so one bad sweep can't fail the
 * whole reconciliation — the next run retries, and nothing was marked sent.
 */
export async function sendDueRestockAlerts(): Promise<number> {
  try {
    const result = await notifyRestock();
    return result.notified;
  } catch (err) {
    await reportError(
      { err },
      "Failed to send back-in-stock alerts; will retry next run",
    );
    return 0;
  }
}

/**
 * Remind customers whose appointment is coming up tomorrow.
 *
 * Like the passes above this rides the nightly run rather than asking for a cron
 * of its own: the reminder wants to go out in the small hours of the day before,
 * which is exactly when this already fires. `notifyUpcomingAppointments` reads
 * the window from Google Calendar and marks each event it has answered, so this
 * is only the schedule — it neither decides who is due nor tracks who was told.
 *
 * Swallows its own failure (alerting instead) so a Google outage can't fail the
 * whole reconciliation — the next run retries, and nothing was marked reminded.
 */
export async function sendDueAppointmentReminders(
  now: Date = new Date(),
): Promise<number> {
  try {
    const result = await notifyUpcomingAppointments(now);
    return result.sent;
  } catch (err) {
    await reportError(
      { err },
      "Failed to send appointment reminders; will retry next run",
    );
    return 0;
  }
}

/**
 * The full nightly reconciliation the cron and the dashboard's tool run: generate
 * milestones for orders that just got a due date, then email customers whose
 * fitting is approaching, whose deposit/balance is coming due, who is waiting on
 * a shop piece that has come back in stock, and who has an appointment tomorrow.
 * Milestone completion state needs
 * no pass here — it's the live `Milestone Status` Notion formula, derived from
 * the order's stage, so the "Coming Up" calendar reflects real progress on its own.
 */
export async function reconcileMilestones(
  now: Date = new Date(),
): Promise<MilestoneReconcileResult> {
  const generation = await generatePendingMilestones(now);
  const remindersSent = await sendDueFittingReminders(now);
  const paymentRemindersSent = await sendDuePaymentReminders(now);
  const restockAlertsSent = await sendDueRestockAlerts();
  const appointmentRemindersSent = await sendDueAppointmentReminders(now);
  const materialsDigestItems = await sendDueMaterialsDigest(now);
  const instagramTokenRefreshed = await refreshDueInstagramToken();
  return {
    ...generation,
    remindersSent,
    paymentRemindersSent,
    restockAlertsSent,
    appointmentRemindersSent,
    materialsDigestItems,
    instagramTokenRefreshed,
  };
}

/**
 * Renew the Instagram access token before it expires.
 *
 * The odd one out among these passes: it emails nobody and reconciles nothing,
 * it keeps a credential alive. It rides this run because the alternative is a
 * feature that works for exactly 60 days and then stops with no error anywhere
 * — an expired token degrades to an empty feed, which is indistinguishable from
 * a studio that never set Instagram up (see `lib/instagram/token.ts`).
 *
 * Idempotent and mostly a no-op: the token is only renewed inside its last
 * fortnight, so this skips on roughly 46 nights in every 60.
 *
 * A failure is ALERTED rather than logged, unlike the swallowed failures above.
 * Those all retry against data that is still sitting there; this one is racing
 * an expiry, and a run of failed nights is the only warning anyone gets before
 * the feed dies silently. It still can't fail the reconciliation — the alert is
 * awaited and the pass returns.
 */
export async function refreshDueInstagramToken(): Promise<boolean> {
  try {
    const result = await refreshInstagramToken();
    if (result.status === "failed") {
      await reportError(
        { detail: result.detail },
        "Could not refresh the Instagram access token; the feed will stop when it expires",
      );
      return false;
    }
    if (result.status === "refreshed") {
      logger.info(
        { detail: result.detail },
        "Refreshed the Instagram access token",
      );
    }
    return result.status === "refreshed";
  } catch (err) {
    await reportError(
      { err },
      "Could not refresh the Instagram access token; the feed will stop when it expires",
    );
    return false;
  }
}

/**
 * Email the atelier its weekly materials shopping list.
 *
 * Rides this run like the passes above, and is a no-op on the six days that
 * aren't its weekday — the schedule lives in `sendWeeklyMaterialsDigest`, which
 * also decides whether there is anything worth sending. Unlike the reminders
 * this one is safe to repeat, because it reports current state rather than
 * announcing an event.
 *
 * Swallows its own failure (alerting instead) so a Notion blip can't fail the
 * whole reconciliation.
 */
export async function sendDueMaterialsDigest(now: Date): Promise<number> {
  try {
    return await sendWeeklyMaterialsDigest(now);
  } catch (err) {
    await reportError(
      { err },
      "Failed to send the weekly materials digest; will retry next run",
    );
    return 0;
  }
}
