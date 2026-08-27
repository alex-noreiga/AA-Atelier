// Order status-change notification use-case, independent of HTTP.
//
// Custom-order stage changes happen inside Notion, and there's no Notion->app
// trigger — so a Notion database automation ("when Stage changes, send webhook")
// calls the notify endpoint with the order number, which hands off to here. This
// reads the order back from Notion (the source of truth — never trust the webhook
// payload's own copy of the stage) and emails the customer a status update with a
// pipeline graphic. The email is a best-effort side effect, like every other
// customer mail in the app: a Resend failure is logged-and-swallowed and never
// turns the webhook into an error.
//
// Forward-only: the email is sent only when the order has moved FORWARD past the
// stage the customer was last emailed about (the `Last Notified Stage` marker on
// the order). A backward stage edit (a correction/rework) or a re-fire of the
// same stage is skipped, so the customer is never emailed about moving backward.
// The Notion webhook payload doesn't carry the previous stage, so this marker is
// the only way to tell a forward move from a backward one. The marker tracks the
// high-water mark (it only ever advances), so re-traversing already-notified
// stages after a rework doesn't re-email either. After a send, the marker is
// advanced to the current stage (best-effort — a marker-write hiccup at worst
// risks one duplicate on a later double-fire, never a wrong-direction email).
//
// The on-demand `/run` link may pass `force` to bypass the forward-only gate (a
// manual "notify now" / resend); forcing still never moves the marker backward.

import {
  findOrderForStageNotification,
  findOrderForStageNotificationByPageId,
  updateLastNotifiedStage,
  type OrderStageNotification,
} from "../lib/notion/orders.repository.js";
import { orderStageChangeEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

/** The outcome of a status-change notification attempt, for the caller's response. */
export interface StageChangeNotificationResult {
  orderNumber: string;
  status: "sent" | "not_found" | "skipped";
  currentStage?: string;
  /** Why the send was skipped (no email / no stage / not forward). */
  reason?: string;
}

/** Options for a notification attempt. */
export interface NotifyOptions {
  /** Bypass the forward-only gate (a manual resend from the on-demand link). */
  force?: boolean;
}

/** How to find the order: by its human order number, or by its Notion page id
 * (what the Notion automation's default payload carries). A bare string is
 * treated as an order number. */
export type OrderLocator =
  string | { orderNumber: string } | { pageId: string };

/** The order number to echo back before the order is looked up (empty for a
 * page-id locator, which has no human number until resolved). */
function locatorLabel(locator: OrderLocator): string {
  if (typeof locator === "string") return locator.trim();
  if ("orderNumber" in locator) return locator.orderNumber.trim();
  return "";
}

function resolveOrder(
  locator: OrderLocator,
): Promise<OrderStageNotification | null> {
  if (typeof locator === "string") {
    return findOrderForStageNotification(locator);
  }
  if ("orderNumber" in locator) {
    return findOrderForStageNotification(locator.orderNumber);
  }
  return findOrderForStageNotificationByPageId(locator.pageId);
}

/**
 * Whether `currentStage` is strictly ahead of `lastNotifiedStage` in the ordered
 * pipeline — the gate for sending a status-change email. An empty marker (never
 * notified) counts as forward (the first genuine change should email). When
 * either stage isn't in the list we can't compare, so we do NOT treat it as
 * forward (fail toward not emailing on an ambiguous/backward move). `stages` is
 * expected to already include `currentStage` (the caller's timeline fixup).
 */
export function isForwardStageChange(
  lastNotifiedStage: string,
  currentStage: string,
  stages: string[],
): boolean {
  if (!lastNotifiedStage) return true;
  const oldIndex = stages.indexOf(lastNotifiedStage);
  const newIndex = stages.indexOf(currentStage);
  if (oldIndex === -1 || newIndex === -1) return false;
  return newIndex > oldIndex;
}

/**
 * The order's pipeline with its current stage guaranteed to be in it.
 *
 * A stage the atelier has since renamed or removed from the live options is
 * still what the order says it is at, and dropping it would leave the timeline
 * (and the forward-only comparison below) reasoning about a list the order isn't
 * in. Exported because the dashboard's stage board applies the same fixup, and
 * two copies of it would eventually disagree about whether a renamed stage can
 * be advanced from.
 */
export function stagesIncludingCurrent(
  stages: string[],
  currentStage: string,
): string[] {
  if (!currentStage || stages.includes(currentStage)) return stages;
  return [...stages, currentStage];
}

/** A direct link to this order's tracking page, when PUBLIC_BASE_URL is set (same
 * base Stripe uses). The track page reads `?orderNumber=` and looks it up on
 * arrival, so this deep-links straight to the customer's order. */
function trackingUrl(orderNumber: string): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/track?orderNumber=${encodeURIComponent(orderNumber)}`;
}

/**
 * Send the customer a status-change email for the given order (located by number
 * or Notion page id), unless the order hasn't moved forward. Reads the order
 * (with its email + last-notified marker) from Notion, skips gracefully when
 * there's no recipient, no stage, or the move isn't forward (unless `force`), and
 * otherwise dispatches a best-effort email from the orders sender (`orders@`) and
 * advances the marker. Only Notion read failures throw; the email and the marker
 * write never do.
 */
export async function notifyOrderStageChange(
  locator: OrderLocator,
  options: NotifyOptions = {},
): Promise<StageChangeNotificationResult> {
  const order = await resolveOrder(locator);
  if (!order) {
    return { orderNumber: locatorLabel(locator), status: "not_found" };
  }
  if (!order.email) {
    return {
      orderNumber: order.orderNumber,
      status: "skipped",
      reason: "no email on order",
    };
  }
  if (!order.currentStage) {
    return {
      orderNumber: order.orderNumber,
      status: "skipped",
      reason: "no stage set",
    };
  }

  // Ensure the current stage appears in the pipeline even if it was renamed or
  // removed from the live options — mirrors getOrderStatus's timeline fixup.
  const stages = stagesIncludingCurrent(order.stages, order.currentStage);

  const forward = isForwardStageChange(
    order.lastNotifiedStage,
    order.currentStage,
    stages,
  );
  if (!forward && !options.force) {
    // A backward edit or a re-fire of an already-notified stage — never email.
    return {
      orderNumber: order.orderNumber,
      status: "skipped",
      reason: "not a forward stage change",
      currentStage: order.currentStage,
    };
  }

  const link = trackingUrl(order.orderNumber);
  await sendEmailBestEffort({
    ...orderStageChangeEmail({
      email: order.email,
      orderName: order.orderName,
      orderNumber: order.orderNumber,
      stages,
      currentStage: order.currentStage,
      ...(order.estimatedCompletion
        ? { estimatedCompletion: order.estimatedCompletion }
        : {}),
      ...(link ? { trackingUrl: link } : {}),
    }),
    from: fromAddress("orders"),
  });

  // Advance the high-water marker only on genuine forward movement, so a forced
  // resend of an earlier/same stage never moves it backward (which would re-arm
  // an email for a stage the customer has already been told about). Best-effort:
  // a marker-write failure mustn't turn a sent email into a webhook error.
  if (forward) {
    try {
      await updateLastNotifiedStage(order.pageId, order.currentStage);
    } catch (err) {
      logger.warn(
        { err, orderNumber: order.orderNumber, stage: order.currentStage },
        "Sent status-change email but failed to advance the Last Notified Stage marker",
      );
    }
  }

  logger.info(
    {
      orderNumber: order.orderNumber,
      stage: order.currentStage,
      forced: !forward,
    },
    "Sent order status-change email",
  );
  return {
    orderNumber: order.orderNumber,
    status: "sent",
    currentStage: order.currentStage,
  };
}
