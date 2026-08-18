// The atelier's internal actions, run from the signed-in studio dashboard.
//
// Nothing here is new work. Each tool calls the same service the atelier used to
// trigger by opening a link out of Notion that carried `CRON_SECRET` in its query
// string — milestone reconciliation, invoice line-item generation, an order
// status-change email, a cancellation refund, a return refund. What changed is
// who is allowed to press it: the routes above this are gated by `requireStaff`
// (a Supabase session on the staff allowlist), so the shared secret no longer has
// to be pasted into a Notion formula property, sit in browser history, or be
// re-pasted every time a new button is added. See the roadmap's "Staff
// authentication for internal tools" / "Retire the copy-a-secret buttons".
//
// Three things are deliberate:
//
//  1. **This layer owns the wording.** The retired `/run` links each rendered an
//     HTML confirmation page composed from their result; that composition moved
//     here verbatim, so the dashboard renders one shape (`title` / `message` /
//     `details`) instead of five, and the atelier reads the same sentences it
//     always did. The per-tool result types stay in their own services.
//  2. **Idempotence is reported, not hidden.** Every underlying action is safe to
//     repeat, and a repeat that found nothing to do returns `noop` rather than a
//     success that implies work happened. `attention` is the third state: the run
//     completed but left something for a human — a refund Stripe rejected, which
//     leaves the order uncancelled precisely so a re-run can retry it.
//  3. **Failures the tool couldn't start are thrown, not returned.** A missing
//     order number, an unknown order, an invoice that isn't ready — those are
//     `BadRequestError` / `NotFoundError`, so the central error handler renders
//     them as a 400/404 with their own message. The result shape is for runs that
//     actually happened.

import { reconcileMilestones } from "./schedule.service.js";
import { generateInvoiceLineItems } from "./invoice-generator.service.js";
import {
  notifyOrderStageChange,
  type StageChangeNotificationResult,
} from "./order-notification.service.js";
import {
  processCancellation,
  type CancellationResult,
} from "./order-cancellation.service.js";
import {
  processReturnRefund,
  parseRefundTarget,
  type ReturnRefundResult,
} from "./return-refund.service.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** The tools the dashboard can run. Mirrors the `StudioTool` enum in the spec. */
export type StudioToolName =
  | "milestones"
  | "invoice-lines"
  | "status-email"
  | "cancellation-refund"
  | "return-refund";

/** What a run did. See the spec's `StudioToolRun.status` for the contract. */
export type StudioToolStatus = "ok" | "noop" | "attention";

/** The arguments a run may carry. Each tool uses the subset it needs and
 * rejects a run that is missing it — the union is flat because the wire body is
 * (the generated zod schema can't express "required for these tools only"). */
export interface StudioToolArgs {
  orderNumber?: string;
  force?: boolean;
  amount?: number;
}

/** One run's outcome, already composed for display. */
export interface StudioToolRunResult {
  tool: StudioToolName;
  status: StudioToolStatus;
  title: string;
  message: string;
  details: string[];
}

/** The order number the tool acts on, or a 400 naming what's missing. Trimmed,
 * because it arrives from a text field the atelier pastes into. */
function requireOrderNumber(args: StudioToolArgs): string {
  const orderNumber = args.orderNumber?.trim() ?? "";
  if (!orderNumber) {
    throw new BadRequestError("Enter an order number to run this tool.");
  }
  return orderNumber;
}

/** Pluralize `count` of `noun` — "1 milestone" / "2 milestones". */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Join clauses as a readable list: "a, b and c". */
function listPhrase(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Dollars, for a summary sentence. */
function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// --- The tools ---

/** Milestone reconciliation: the same nightly sweep Vercel Cron runs, on demand.
 * Generation plus the fitting and payment reminder passes. */
async function runMilestones(): Promise<StudioToolRunResult> {
  const result = await reconcileMilestones();
  const {
    ordersProcessed,
    milestonesCreated,
    remindersSent,
    paymentRemindersSent,
  } = result;

  const details: string[] = [];
  if (remindersSent > 0) {
    details.push(`Sent ${plural(remindersSent, "fitting reminder")}.`);
  }
  if (paymentRemindersSent > 0) {
    details.push(`Sent ${plural(paymentRemindersSent, "payment reminder")}.`);
  }

  const didSomething =
    milestonesCreated > 0 || remindersSent > 0 || paymentRemindersSent > 0;

  return {
    tool: "milestones",
    status: didSomething ? "ok" : "noop",
    title: didSomething ? "Milestones reconciled" : "Nothing to reconcile",
    message:
      milestonesCreated === 0
        ? "Every order with a due date already has its milestones."
        : `Generated ${plural(milestonesCreated, "milestone")} across ${plural(ordersProcessed, "order")}.`,
    details,
  };
}

/** Itemize a custom order's invoice from its costing. */
async function runInvoiceLines(
  args: StudioToolArgs,
): Promise<StudioToolRunResult> {
  const result = await generateInvoiceLineItems(requireOrderNumber(args));

  if (result.alreadyPresent) {
    return {
      tool: "invoice-lines",
      status: "noop",
      title: "Nothing to generate",
      message: `Invoice ${result.orderNumber} already has line items, so nothing was added.`,
      details: [
        "To rebuild it, delete the existing lines in Notion and run this again.",
      ],
    };
  }

  const parts: string[] = [
    plural(result.materialLinesCreated, "material line"),
  ];
  if (result.laborLineCreated) parts.push("a labor line");
  if (result.adjustmentLineCreated) parts.push("a design & finishing line");
  if (result.rushSurcharge > 0) {
    parts.push(`a rush surcharge of ${money(result.rushSurcharge)}`);
  }

  return {
    tool: "invoice-lines",
    status: "ok",
    title: "Invoice itemized",
    message: `Added ${listPhrase(parts)} to invoice ${result.orderNumber}, totalling ${money(result.invoiceTotal)}.`,
    details: [],
  };
}

/** Send (or resend) one order's status-change email. */
async function runStatusEmail(
  args: StudioToolArgs,
): Promise<StudioToolRunResult> {
  const orderNumber = requireOrderNumber(args);
  const result: StageChangeNotificationResult = await notifyOrderStageChange(
    { orderNumber },
    { force: args.force === true },
  );

  // The service reports a miss rather than throwing, because the Notion
  // automation posts page ids it would rather see logged than error on. From the
  // dashboard an unknown order number is a plain 404, like every other lookup.
  if (result.status === "not_found") {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  if (result.status === "skipped") {
    return {
      tool: "status-email",
      status: "noop",
      title: "Nothing sent",
      message: `No update was sent for order ${result.orderNumber}.`,
      details: [
        result.reason ??
          "The order hasn't moved forward since the customer was last emailed.",
        "Tick “resend anyway” to send it regardless.",
      ],
    };
  }

  return {
    tool: "status-email",
    status: "ok",
    title: "Status update sent",
    message: `A status update for order ${result.orderNumber}${
      result.currentStage ? ` (now at ${result.currentStage})` : ""
    } is on its way.`,
    details: [],
  };
}

/** Refund every paid payment on a custom or shop order and mark it cancelled. */
async function runCancellationRefund(
  args: StudioToolArgs,
): Promise<StudioToolRunResult> {
  const result: CancellationResult = await processCancellation(
    requireOrderNumber(args),
  );

  // A refund failure leaves the order uncancelled on purpose, so it can be
  // retried once Stripe is happy. Say so rather than reporting success.
  if (result.hadError) {
    return {
      tool: "cancellation-refund",
      status: "attention",
      title: "Refund needs attention",
      message: `Order ${result.orderNumber} could not be fully refunded, so it was left uncancelled.`,
      details: [
        ...result.skipped,
        "Fix the issue in Stripe and run this again — refunds already issued won't repeat.",
      ],
    };
  }

  const parts: string[] = [];
  if (result.refundsIssued > 0) {
    parts.push(
      `refunded ${plural(result.refundsIssued, "payment")} totalling ${money(result.totalRefunded)}`,
    );
  } else {
    parts.push("no new refunds were needed");
  }
  if (result.alreadyCancelled) {
    parts.push("the order was already cancelled");
  } else if (result.cancelledNow) {
    parts.push("the order is now marked cancelled");
  }

  const didSomething = result.refundsIssued > 0 || result.cancelledNow;

  return {
    tool: "cancellation-refund",
    status: didSomething ? "ok" : "noop",
    title: didSomething ? "Cancellation processed" : "Nothing to refund",
    message: `Order ${result.orderNumber}: ${parts.join(", ")}.`,
    details: result.skipped,
  };
}

/** Refund a shop order up to a target total, for a return or exchange. */
async function runReturnRefund(
  args: StudioToolArgs,
): Promise<StudioToolRunResult> {
  const orderNumber = requireOrderNumber(args);
  // Reuse the link parser so the "a typo must not move money" validation lives in
  // one place — the wire type is a number, but the rejection rules are identical.
  const target = parseRefundTarget(
    args.amount === undefined ? undefined : String(args.amount),
  );
  const result: ReturnRefundResult = await processReturnRefund(
    orderNumber,
    target,
  );

  if (result.status === "error") {
    return {
      tool: "return-refund",
      status: "attention",
      title: "Refund needs attention",
      message: `Order ${result.orderNumber} could not be refunded.`,
      details: [
        ...result.notes,
        "Fix the issue in Stripe and run this again — the target is recomputed from Stripe each time.",
      ],
    };
  }

  if (result.status !== "refunded") {
    return {
      tool: "return-refund",
      status: "noop",
      title: "No refund issued",
      message: `Order ${result.orderNumber}: nothing was refunded this run.`,
      details: result.notes,
    };
  }

  const parts = [`refunded ${money(result.refunded)}`];
  if (result.totalRefunded > result.refunded) {
    parts.push(
      `${money(result.totalRefunded)} refunded on this order in total`,
    );
  }
  parts.push(
    result.fullyRefunded
      ? "the order is now fully refunded"
      : `${money(result.captured - result.totalRefunded)} of the original payment remains`,
  );

  return {
    tool: "return-refund",
    status: "ok",
    title: "Refund processed",
    message: `Order ${result.orderNumber}: ${parts.join(", ")}.`,
    details: result.notes,
  };
}

/**
 * Run one internal tool and compose its result.
 *
 * The caller has already been authorized (`requireStaff`) and the arguments
 * schema-validated; what's left is the per-tool requirement check, which lives
 * inside each runner because only it knows what it needs.
 */
export async function runStudioTool(
  tool: StudioToolName,
  args: StudioToolArgs = {},
): Promise<StudioToolRunResult> {
  const result = await dispatch(tool, args);
  logger.info(
    { tool, status: result.status, orderNumber: args.orderNumber },
    "Studio tool run",
  );
  return result;
}

function dispatch(
  tool: StudioToolName,
  args: StudioToolArgs,
): Promise<StudioToolRunResult> {
  switch (tool) {
    case "milestones":
      return runMilestones();
    case "invoice-lines":
      return runInvoiceLines(args);
    case "status-email":
      return runStatusEmail(args);
    case "cancellation-refund":
      return runCancellationRefund(args);
    case "return-refund":
      return runReturnRefund(args);
  }
}
