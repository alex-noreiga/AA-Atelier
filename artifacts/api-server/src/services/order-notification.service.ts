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
// There is deliberately no stored "last notified stage" marker: the Notion
// automation fires precisely on a Stage change, so each call is one genuine
// transition. (Adding a marker would buy dedupe + forward-only detection at the
// cost of a new Notion property — see CLAUDE.md.)

import { findOrderForStageNotification } from "../lib/notion/orders.repository.js";
import { orderStageChangeEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

/** The outcome of a status-change notification attempt, for the caller's response. */
export interface StageChangeNotificationResult {
  orderNumber: string;
  status: "sent" | "not_found" | "skipped";
  currentStage?: string;
  /** Why the send was skipped (no email / no stage), for the skipped status. */
  reason?: string;
}

/** The tracking-page URL, when PUBLIC_BASE_URL is set (same base Stripe uses). */
function trackingUrl(): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/track`;
}

/**
 * Send the customer a status-change email for the given order number. Reads the
 * order (with its email) from Notion, skips gracefully when there's no recipient
 * or no stage set, and otherwise dispatches a best-effort email from the orders
 * sender (`orders@…`). Only Notion read failures throw; the email never does.
 */
export async function notifyOrderStageChange(
  orderNumber: string,
): Promise<StageChangeNotificationResult> {
  const order = await findOrderForStageNotification(orderNumber);
  if (!order) {
    return { orderNumber: orderNumber.trim(), status: "not_found" };
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
  const stages = order.stages.includes(order.currentStage)
    ? order.stages
    : [...order.stages, order.currentStage];

  const link = trackingUrl();
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

  logger.info(
    { orderNumber: order.orderNumber, stage: order.currentStage },
    "Sent order status-change email",
  );
  return {
    orderNumber: order.orderNumber,
    status: "sent",
    currentStage: order.currentStage,
  };
}
