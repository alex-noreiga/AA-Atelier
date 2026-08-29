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
// `restock-alert` is the first tool that never had a link to retire: it landed
// here directly, because adding a sixth `?secret=` Notion formula property would
// have been adding to the very thing this page replaced. Its scheduled twin is a
// pass in the nightly reconciliation cron — so between the two, back-in-stock
// alerts need nothing configured in Notion at all.
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
import { quoteOrder } from "./quote.service.js";
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
import {
  notifyRestock,
  type RestockNotificationResult,
} from "./restock-notification.service.js";
import {
  recordOfflinePayment,
  type RecordPaymentResult,
} from "./payment-record.service.js";
import { issueOrderInvoice } from "./invoice-issue.service.js";
import { creditOrderInvoice } from "./credit-note.service.js";
import type { PaymentMethod } from "../lib/db/payments.repository.js";
import type { PaymentStage } from "../lib/notion/invoice.schema.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** The tools the dashboard can run. Mirrors the `StudioTool` enum in the spec. */
export type StudioToolName =
  | "milestones"
  | "invoice-lines"
  | "quote"
  | "status-email"
  | "cancellation-refund"
  | "return-refund"
  | "restock-alert"
  | "record-payment"
  | "issue-invoice"
  | "credit-note";

/** What a run did. See the spec's `StudioToolRun.status` for the contract. */
export type StudioToolStatus = "ok" | "noop" | "attention";

/** The arguments a run may carry. Each tool uses the subset it needs and
 * rejects a run that is missing it — the union is flat because the wire body is
 * (the generated zod schema can't express "required for these tools only"). */
export interface StudioToolArgs {
  orderNumber?: string;
  force?: boolean;
  amount?: number;
  item?: string;
  description?: string;
  method?: PaymentMethod;
  paidOn?: string;
  stage?: PaymentStage;
  /** Who is running the tool. Set by the ROUTE from the verified staff session,
   * never read off the request body — otherwise a caller could sign somebody
   * else's name to a payment they recorded. Not on the wire contract. */
  recordedBy?: string;
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
 * Generation plus the fitting, payment, back-in-stock and appointment-reminder
 * passes, and the weekly materials digest (which only sends on its weekday). */
async function runMilestones(): Promise<StudioToolRunResult> {
  const result = await reconcileMilestones();
  const {
    ordersProcessed,
    milestonesCreated,
    remindersSent,
    paymentRemindersSent,
    restockAlertsSent,
    appointmentRemindersSent,
    materialsDigestItems,
  } = result;

  const details: string[] = [];
  if (remindersSent > 0) {
    details.push(`Sent ${plural(remindersSent, "fitting reminder")}.`);
  }
  if (paymentRemindersSent > 0) {
    details.push(`Sent ${plural(paymentRemindersSent, "payment reminder")}.`);
  }
  if (restockAlertsSent > 0) {
    details.push(`Sent ${plural(restockAlertsSent, "back-in-stock alert")}.`);
  }
  if (appointmentRemindersSent > 0) {
    details.push(
      `Sent ${plural(appointmentRemindersSent, "appointment reminder")}.`,
    );
  }

  if (materialsDigestItems > 0) {
    details.push(
      `Emailed the weekly materials digest — ${plural(materialsDigestItems, "material")} to reorder.`,
    );
  }

  const didSomething =
    milestonesCreated > 0 ||
    remindersSent > 0 ||
    paymentRemindersSent > 0 ||
    restockAlertsSent > 0 ||
    appointmentRemindersSent > 0 ||
    materialsDigestItems > 0;

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

/** Quote a flat price for work with no costing behind it — a repair, a stoning
 * job, an alteration. Writes one priced line to the order's invoice and ticks
 * `Invoice Ready`, which is what makes the order payable online at all. */
async function runQuote(args: StudioToolArgs): Promise<StudioToolRunResult> {
  const result = await quoteOrder({
    orderNumber: requireOrderNumber(args),
    // A quote issues the invoice it writes, so the issuer records who did it.
    ...(args.recordedBy ? { issuedBy: args.recordedBy } : {}),
    // `amount` is optional on the shared request body (each tool takes a
    // different subset), so an omitted price arrives here as NaN and the
    // service rejects it with the message the atelier needs to read.
    amount: args.amount ?? Number.NaN,
    ...(args.description !== undefined
      ? { description: args.description }
      : {}),
  });

  if (result.alreadyPresent) {
    return {
      tool: "quote",
      status: "noop",
      title: "Already quoted",
      message: `Invoice ${result.orderNumber} already has line items, so nothing was added.`,
      details: [
        "To re-quote it, delete the existing lines in Notion and run this again.",
      ],
    };
  }

  const details = [
    `The customer can now pay ${money(result.invoiceTotal)} from their tracking page.`,
  ];
  if (result.rushSurcharge > 0) {
    details.push(
      `This is a rush order, so a surcharge of ${money(result.rushSurcharge)} was added on top of the quote — the same fee they acknowledged at intake.`,
    );
  }

  return {
    tool: "quote",
    status: "ok",
    title: "Quote sent",
    message: `Priced "${result.lineName}" at ${money(result.amount)} on invoice ${result.orderNumber} and marked it ready to pay.`,
    details,
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

/** Alert everyone waiting on a piece that has come back in stock — the same sweep
 * the nightly reconciliation runs, for when the atelier would rather not wait for
 * it. With no item name it covers everything currently in stock. */
async function runRestockAlert(
  args: StudioToolArgs,
): Promise<StudioToolRunResult> {
  const item = args.item?.trim();
  const result: RestockNotificationResult = await notifyRestock(
    item ? { item } : {},
  );

  // The sweep reports a miss rather than throwing, because the nightly run would
  // rather log it. From the dashboard a name that matches nothing is a plain 404,
  // like an unknown order number.
  if (result.status === "not_found") {
    throw new NotFoundError(
      "We couldn't find a shop piece with that name. It must match the Item Name in Notion exactly.",
    );
  }

  // Not a failure of this run, but nothing will ever send until it's fixed.
  if (result.status === "unconfigured") {
    return {
      tool: "restock-alert",
      status: "attention",
      title: "Alerts aren't configured",
      message: "No back-in-stock alerts can be sent yet.",
      details: [
        result.reason ?? "The database connection isn't configured.",
        "Set POSTGRES_URL and run the database migrations, then try again.",
      ],
    };
  }

  const notes: string[] = [];
  if (result.alreadyAlerted > 0) {
    notes.push(
      `${plural(result.alreadyAlerted, "request")} had already been answered.`,
    );
  }
  if (result.unmatched > 0) {
    notes.push(
      `${plural(result.unmatched, "request")} still waiting — they asked about a size that isn't back yet.`,
    );
  }

  if (result.status === "skipped") {
    return {
      tool: "restock-alert",
      status: "noop",
      title: "Nothing sent",
      message: item ? `No alerts went out for ${item}.` : "No alerts went out.",
      details: [result.reason ?? "There was nobody to tell.", ...notes],
    };
  }

  return {
    tool: "restock-alert",
    status: "ok",
    title: "Back-in-stock alerts sent",
    message: `Emailed ${plural(result.notified, "customer")} across ${plural(result.items.length, "piece")}.`,
    details: [
      ...result.items.map(
        (entry) => `${entry.item}: ${plural(entry.notified, "customer")}.`,
      ),
      ...notes,
    ],
  };
}

/**
 * Run one internal tool and compose its result.
 *
 * The caller has already been authorized (`requireStaff`) and the arguments
 * schema-validated; what's left is the per-tool requirement check, which lives
 * inside each runner because only it knows what it needs.
 */
/** Record a payment that arrived outside Stripe — cash at a fitting, a check, a
 * transfer. The one tool that WRITES to the payment ledger rather than mirroring
 * Stripe into it, and so the only one whose whole output is a row. */
async function runRecordPayment(
  args: StudioToolArgs,
): Promise<StudioToolRunResult> {
  const orderNumber = requireOrderNumber(args);
  const method = args.method;
  if (!method) {
    throw new BadRequestError("Choose how the payment was made.");
  }

  let result: RecordPaymentResult;
  try {
    result = await recordOfflinePayment({
      orderNumber,
      // `amount` is optional on the shared request body, so an omitted figure
      // arrives as NaN and the service rejects it with its own wording — the
      // same handling as the quote tool.
      amount: args.amount ?? Number.NaN,
      method,
      ...(args.paidOn ? { paidOn: args.paidOn } : {}),
      ...(args.stage ? { stage: args.stage } : {}),
      ...(args.description ? { note: args.description } : {}),
      ...(args.recordedBy ? { recordedBy: args.recordedBy } : {}),
    });
  } catch (err) {
    // The ledger being unconfigured is the one failure worth reporting as a run
    // rather than a 400: nothing is wrong with what the atelier typed, and the
    // fix is a deployment setting they need to see named.
    if (
      err instanceof BadRequestError &&
      err.message.includes("payment ledger isn't configured")
    ) {
      return {
        tool: "record-payment",
        status: "attention",
        title: "Nothing to record it in",
        message: err.message,
        details: [],
      };
    }
    throw err;
  }

  const where =
    result.stageLabel !== undefined
      ? ` against the ${result.stageLabel.toLowerCase()}`
      : "";

  const details: string[] = [];
  if (result.stageMarkedPaid) {
    details.push(`Marked the ${result.stageLabel} paid on the invoice.`);
  } else if (
    result.stageOutstanding !== undefined &&
    result.stageOutstanding > 0
  ) {
    details.push(
      `${money(result.stageOutstanding)} of the ${result.stageLabel?.toLowerCase() ?? "stage"} is still outstanding, so it stays unpaid on the invoice.`,
    );
  }
  if (result.orderKind === "shop") {
    details.push(
      "A shop order has no payment stages, so this was recorded against the order itself.",
    );
  }
  if (result.history.length > 0) {
    details.push(`Payments on this order: ${result.history.join("; ")}.`);
  }

  return {
    tool: "record-payment",
    status: "ok",
    title: "Payment recorded",
    message: `Recorded ${money(result.amount)} paid by ${method} on ${result.orderNumber}${where}.`,
    details,
  };
}

/** Issue an invoice: freeze its charges into a numbered, dated document and open
 * it for payment. The one tool whose whole point is that its output can never be
 * rewritten — so a re-press reports what already stands rather than doing it
 * again. */
async function runIssueInvoice(
  args: StudioToolArgs,
): Promise<StudioToolRunResult> {
  const orderNumber = requireOrderNumber(args);
  const result = await issueOrderInvoice({
    orderNumber,
    ...(args.recordedBy ? { issuedBy: args.recordedBy } : {}),
  });

  const issuedOn = result.issuedAt.toISOString().slice(0, 10);

  if (result.alreadyIssued) {
    return {
      tool: "issue-invoice",
      status: "noop",
      title: "Already issued",
      message: `${result.orderNumber} was issued as ${result.invoiceNumber} on ${issuedOn}, so nothing changed.`,
      details: [
        "An issued invoice can't be re-issued — that's what makes it the document the customer was shown. To change what is charged, raise a credit note or a new invoice.",
        ...(result.markedReady
          ? ["Ticked Invoice Ready, which had been left unset."]
          : []),
      ],
    };
  }

  return {
    tool: "issue-invoice",
    // The document is written either way, but an invoice the customer was never
    // sent is half an outcome — say so rather than reporting a clean success.
    status: result.emailed ? "ok" : "attention",
    title: "Invoice issued",
    message: `${result.orderNumber} is issued as ${result.invoiceNumber} — ${plural(result.lineCount, "line")} totalling ${money(result.subtotal)}.`,
    details: [
      result.emailed
        ? "Emailed the invoice to the customer."
        : `The invoice was NOT emailed — ${result.emailSkipped ?? "no reason given"}. Send it by hand, or add an email to the order and issue the next one.`,
      "The charges are now frozen: the customer's invoice, its PDF and the balance checkout all read this document rather than the Notion rows, so editing a line won't change what they were shown or what they're charged.",
      ...(result.markedReady
        ? ["Ticked Invoice Ready, so the customer can pay the balance."]
        : ["Invoice Ready was already set."]),
      "Tax on the balance is calculated by Stripe at checkout, from the address collected there — so it isn't on the document.",
    ],
  };
}

/** Credit an issued invoice: the way a document that can never be rewritten
 * changes. Reduces what is OWED — it moves no money, which is the distinction
 * the result is careful to make when the balance has already been settled. */
async function runCreditNote(
  args: StudioToolArgs,
): Promise<StudioToolRunResult> {
  const orderNumber = requireOrderNumber(args);
  const result = await creditOrderInvoice({
    orderNumber,
    // `amount` is optional on the shared body, so an omitted figure arrives as
    // NaN and the service rejects it with its own wording.
    amount: args.amount ?? Number.NaN,
    reason: args.description ?? "",
    ...(args.recordedBy ? { issuedBy: args.recordedBy } : {}),
  });

  const details: string[] = [];
  if (result.alreadyPaid) {
    // The one thing that must not be misread: a credit is not a refund.
    details.push(
      `This balance was already paid, so ${money(result.amount)} is now owed back to the customer — a credit note doesn't move any money. Use "Refund a return" or "Cancel & refund an order" to send it.`,
    );
  }
  details.push(
    result.remaining > 0
      ? `${money(result.remaining)} of the ${money(result.invoiceSubtotal)} invoice is left to charge.`
      : "The invoice is now fully credited — there's nothing left to charge.",
  );
  if (result.history.length > 1) {
    details.push(`Credit notes on this invoice: ${result.history.join("; ")}.`);
  }

  return {
    tool: "credit-note",
    status: "ok",
    title: "Credit note raised",
    message: `${result.creditNumber} credits ${money(result.amount)} against ${result.orderNumber} — ${result.reason}.`,
    details,
  };
}

export async function runStudioTool(
  tool: StudioToolName,
  args: StudioToolArgs = {},
): Promise<StudioToolRunResult> {
  const result = await dispatch(tool, args);
  logger.info(
    {
      tool,
      status: result.status,
      orderNumber: args.orderNumber,
      item: args.item,
    },
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
    case "quote":
      return runQuote(args);
    case "status-email":
      return runStatusEmail(args);
    case "cancellation-refund":
      return runCancellationRefund(args);
    case "return-refund":
      return runReturnRefund(args);
    case "restock-alert":
      return runRestockAlert(args);
    case "record-payment":
      return runRecordPayment(args);
    case "issue-invoice":
      return runIssueInvoice(args);
    case "credit-note":
      return runCreditNote(args);
  }
}
