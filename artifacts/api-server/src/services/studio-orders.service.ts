// Advancing an order's stage from the studio dashboard, HTTP-agnostic.
//
// Until this, a custom order moved along its pipeline exactly one way: someone
// opened Notion and changed the `Stage` select by hand. Everything the app does
// about a stage change is downstream of that one fact — a Notion database
// automation watches the property, posts a webhook, and the webhook re-reads the
// order and emails the customer. That machinery exists *because* the change
// happens somewhere the app can't see it.
//
// Here the change happens where the app can see it, so the email rides the
// action: the atelier presses "advance", the stage is written, and the customer
// is told in the same request.
//
// Three decisions carry this module:
//
//  1. **It does not send the email itself.** It calls the same
//     `notifyOrderStageChange` the webhook calls, located by **page id** so the
//     re-read is a direct page fetch rather than a database query (a query is
//     the one read that might not yet see a property written a moment ago).
//     One notifier means one forward-only gate, one `Last Notified Stage`
//     marker, and one piece of email copy. It also means the two paths compose:
//     if the Notion automation is still wired, this write fires it, and it finds
//     the marker already at the new stage and sends nothing. Neither path has to
//     know about the other.
//  2. **It writes a stage, not "the next one".** The dashboard's button says
//     "advance", but the primitive is "put this order at that stage", because
//     the other half of what sends the atelier back to Notion is fixing a
//     mis-click. A backward move is allowed and simply doesn't email — the
//     notifier's forward-only rule already says so, and there is no reason for a
//     second rule here that could disagree with it.
//  3. **The target is validated against the order's OWN pipeline.** Not the live
//     superset: a repair does not walk `Sketching`, and offering it would put a
//     stage on that customer's timeline their garment will never reach. It is
//     also a hard requirement of the write — `Stage` is a Notion `status`
//     property, and unlike a select Notion will not create a missing option, so
//     an unvalidated name is a 400 from Notion rather than a stage change.

import {
  findOrderForStageNotification,
  listOrdersForStageBoard,
  updateLastNotifiedStage,
  updateOrderStage,
  type OrderStageNotification,
} from "../lib/notion/orders.repository.js";
import {
  isForwardStageChange,
  notifyOrderStageChange,
  stagesIncludingCurrent,
} from "./order-notification.service.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** One order's position in its pipeline, as the dashboard reads it. Mirrors the
 * contract's `StudioOrderStage` — note the customer's email is deliberately not
 * on it, only whether there is one. */
export interface StudioOrderStageView {
  orderNumber: string;
  orderName: string;
  currentStage: string;
  stages: string[];
  nextStage?: string;
  lastNotifiedStage?: string;
  service?: string;
  dueDate?: string;
  notifiable: boolean;
}

/** What one stage change did. Mirrors the contract's `OrderStageChange`. */
export interface OrderStageChangeResult {
  order: StudioOrderStageView;
  previousStage: string;
  changed: boolean;
  notification: "sent" | "skipped" | "suppressed";
  notificationReason?: string;
}

/** The stage change asked for. `notify` defaults to true at the schema. */
export interface OrderStageInput {
  stage: string;
  notify?: boolean;
}

/** The stage after `currentStage`, or undefined at the end of the pipeline (and
 * when the current stage isn't in the list at all, which the caller's fixup
 * makes impossible for a stage that is actually set). */
function nextStageAfter(
  stages: string[],
  currentStage: string,
): string | undefined {
  const index = stages.indexOf(currentStage);
  if (index === -1) return undefined;
  return stages[index + 1];
}

/**
 * Map a repository record to the board's view of it, dropping the email to a
 * boolean. `stages` carries the fixup so a renamed stage is still somewhere on
 * the order's own timeline — otherwise the board would offer no "advance" for an
 * order whose current stage the atelier had just renamed, which is exactly when
 * they would reach for it.
 */
function toView(order: OrderStageNotification): StudioOrderStageView {
  const stages = stagesIncludingCurrent(order.stages, order.currentStage);
  const next = nextStageAfter(stages, order.currentStage);
  return {
    orderNumber: order.orderNumber,
    orderName: order.orderName,
    currentStage: order.currentStage,
    stages,
    ...(next !== undefined ? { nextStage: next } : {}),
    ...(order.lastNotifiedStage
      ? { lastNotifiedStage: order.lastNotifiedStage }
      : {}),
    ...(order.service !== undefined ? { service: order.service } : {}),
    ...(order.estimatedCompletion !== undefined
      ? { dueDate: order.estimatedCompletion }
      : {}),
    notifiable: Boolean(order.email),
  };
}

/**
 * Order the board the way the atelier works it: by due date, soonest first,
 * with the undated orders after the dated ones (an order nobody has promised a
 * date for is not more urgent than one that is due on Friday), then by order
 * number so the sequence is stable between loads.
 */
function byUrgency(a: StudioOrderStageView, b: StudioOrderStageView): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    // Both ISO-8601 date strings, so one string comparison orders them.
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.orderNumber.localeCompare(b.orderNumber);
}

/** Every custom order still being made, nearest due date first. */
export async function getOrderStageBoard(): Promise<{
  orders: StudioOrderStageView[];
}> {
  const rows = await listOrdersForStageBoard();
  return { orders: rows.map(toView).sort(byUrgency) };
}

/**
 * Move one order to a stage and, unless asked not to, email the customer.
 *
 * Refuses (rather than writes) three states: an order that doesn't exist, one
 * that is cancelled, and a stage that isn't on the order's own pipeline. An
 * order already at the requested stage is a no-op reported as such — nothing is
 * written and nothing is sent, so a double press costs a request and nothing
 * else.
 */
export async function setOrderStage(
  orderNumber: string,
  input: OrderStageInput,
): Promise<OrderStageChangeResult> {
  const order = await findOrderForStageNotification(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  if (order.cancelled) {
    throw new ConflictError(
      "That order is cancelled, so its stage can't be moved. Its tracking page shows a cancelled banner rather than a timeline.",
    );
  }

  const stages = stagesIncludingCurrent(order.stages, order.currentStage);
  const target = input.stage.trim();
  if (!target) {
    throw new BadRequestError("Choose a stage to move this order to.");
  }
  if (!stages.includes(target)) {
    // Naming the pipeline is the useful half: the reason a stage is refused is
    // almost always that it belongs to a different service, and the list says so
    // better than "invalid stage" ever could.
    throw new BadRequestError(
      `"${target}" isn't a stage this order goes through. It walks: ${stages.join(", ")}.`,
    );
  }

  const previousStage = order.currentStage;
  if (target === previousStage) {
    return {
      order: toView(order),
      previousStage,
      changed: false,
      notification: "skipped",
      notificationReason: "The order was already at that stage.",
    };
  }

  await updateOrderStage(order.pageId, target);

  const notify = input.notify !== false;
  const forward = isForwardStageChange(order.lastNotifiedStage, target, stages);

  let notification: OrderStageChangeResult["notification"] = "suppressed";
  let notificationReason: string | undefined;
  // What the customer has now been told, which the response reports back so the
  // panel doesn't have to guess whether the marker moved.
  let lastNotifiedStage = order.lastNotifiedStage;

  if (notify) {
    // Located by PAGE ID on purpose: the notifier re-reads the order (it never
    // trusts a caller's copy of the stage), and a page fetch reads back what we
    // just wrote where a database query might still be a moment behind.
    const result = await notifyOrderStageChange({ pageId: order.pageId });
    if (result.status === "sent") {
      notification = "sent";
      if (forward) lastNotifiedStage = target;
    } else {
      notification = "skipped";
      notificationReason =
        result.status === "not_found"
          ? "The order couldn't be read back after the stage was written."
          : (result.reason ?? "The customer wasn't emailed.");
    }
  } else if (forward) {
    // A quiet advance has to be quiet everywhere, so the marker moves as though
    // the customer had been told. Without this the Notion automation — which
    // fires on the write above whether or not we asked it to — would email the
    // very stage the atelier chose not to announce. It only ever advances, so a
    // backward quiet move leaves the high-water mark where it was.
    try {
      await updateLastNotifiedStage(order.pageId, target);
      lastNotifiedStage = target;
    } catch (err) {
      logger.warn(
        { err, orderNumber: order.orderNumber, stage: target },
        "Advanced a stage quietly but failed to advance the Last Notified Stage marker",
      );
    }
    notificationReason =
      "The customer wasn't emailed about this stage. They'll still hear about the next one.";
  } else {
    notificationReason = "The customer wasn't emailed about this stage.";
  }

  logger.info(
    {
      orderNumber: order.orderNumber,
      from: previousStage,
      to: target,
      notification,
    },
    "Advanced an order's stage from the dashboard",
  );

  return {
    order: toView({
      ...order,
      currentStage: target,
      stages,
      lastNotifiedStage,
    }),
    previousStage,
    changed: true,
    notification,
    ...(notificationReason !== undefined ? { notificationReason } : {}),
  };
}
