// Record a payment that arrived outside Stripe — cash handed over at a fitting,
// a check, a bank transfer.
//
// WHY THIS EXISTS. `services/payment-ledger.service.ts` captures every payment
// Stripe touches, which leaves a hole exactly the shape of how a local skater
// actually pays: money that never went near a card. Until now the atelier
// recorded that by ticking `First Deposit Paid` in Notion — which records THAT
// the stage was settled and, like every checkbox, says nothing about when or how
// much. So the very payments the ledger was built to date were the ones it
// could never see, and any figure drawn from it would have quietly understated
// a month by however much of it came in cash.
//
// It is also the one place the ledger is WRITTEN TO rather than merely mirrored,
// so two rules hold that don't apply to the Stripe paths:
//
//   1. **It fails loudly.** The Stripe writes are best-effort because the
//      payment succeeded either way and a throw would cost more than the missing
//      row. Here the row IS the work: with nowhere to write it there is nothing
//      to report but the failure.
//   2. **The order must exist.** A typo'd order number on a Stripe path is
//      impossible (the number came from the session); here it is a hand-typed
//      field, and a payment filed against a number nobody holds is money the
//      studio believes it has and cannot find.
//
// What it deliberately does NOT do: refunds. Money going back out is issued
// through Stripe by the two refund tools, which record themselves. A cash refund
// handed over in person has no tool yet — it would need its own, with its own
// confirmation, rather than a sign toggle hidden in this one.

import { findOrderByNumber } from "../lib/notion/orders.repository.js";
import { findShopOrderByNumber } from "../lib/notion/shop-orders.repository.js";
import {
  findInvoice,
  listInvoiceLineItems,
  markInvoicePaid,
} from "../lib/notion/invoice.repository.js";
import { buildInvoiceView } from "./invoice.service.js";
import { labelDeposits } from "./payment-labels.js";
import { resolveStoredOrderService } from "../lib/service-catalog.js";
import { postgresConfigured } from "../lib/db/client.js";
import {
  recordPaymentEntry,
  listOrderPayments,
  type PaymentMethod,
  type PaymentOrderKind,
} from "../lib/db/payments.repository.js";
import type { PaymentStage } from "../lib/notion/invoice.schema.js";
import { appointmentTimezone } from "../lib/appointments/settings.js";
import {
  zonedWallClockToInstant,
  dateInZone,
} from "../lib/appointments/time.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** The largest payment the tool will record, as a guard against a stray digit.
 * The same reasoning (and the same number) as the quote tool's ceiling: not a
 * business limit, just the one input error that matters when a hand-typed figure
 * becomes part of what a customer is said to have paid. */
const MAX_PAYMENT = 100_000;

/** A stage counts as settled once the ledger covers it to within half a cent —
 * below that a rounding tail is not an outstanding balance. */
const SETTLED_EPSILON = 0.005;

/** Midday, in minutes. A bare `YYYY-MM-DD` is anchored here rather than at
 * midnight so the instant sits safely inside the day in every timezone it might
 * later be read back in — the same date-only trap `orderedOn` documents, where
 * `2026-09-01` parsed as UTC midnight and read in `America/Chicago` lands on
 * August 31 and silently moves a payment into the previous month. */
const MIDDAY_MINUTES = 12 * 60;

export interface RecordPaymentInput {
  orderNumber: string;
  /** Dollars. Must be finite and above zero. */
  amount: number;
  method: PaymentMethod;
  /** `YYYY-MM-DD` in the studio's timezone. Omitted ⇒ today. */
  paidOn?: string;
  /** Which staged payment this covers. Required for a custom order that has an
   * invoice; meaningless for a shop order. */
  stage?: PaymentStage;
  /** An internal note kept on the row — the customer never sees it. */
  note?: string;
  /** The staff member recording it. Supplied by the route from the verified
   * session, never from the request body. */
  recordedBy?: string;
}

export interface RecordPaymentResult {
  orderNumber: string;
  orderKind: PaymentOrderKind;
  amount: number;
  method: PaymentMethod;
  /** The instant the money was recorded as arriving. */
  paidAt: Date;
  /** What the stage is called on this order ("Deposit" on a repair paid in one
   * go, "First deposit" on a staged commission). Absent when no stage applies. */
  stageLabel?: string;
  /** False when this exact row was already in the ledger (nothing was written). */
  written: boolean;
  /** The stage was marked paid on the Notion invoice by this run. */
  stageMarkedPaid: boolean;
  /** What the stage still needs after this payment, in dollars; 0 when settled
   * and undefined when there is no stage or no amount to compare against. */
  stageOutstanding?: number;
  /** Every payment now on the order, oldest first, as display lines. */
  history: string[];
}

/** Dollars → the two-decimal string used throughout the summary. */
function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Resolve the calendar date the money arrived into an instant.
 *
 * Rejects a future date rather than accepting it: a payment cannot have arrived
 * tomorrow, so it is always a typo — and it is the one typo that would put money
 * in a month that hasn't happened, where nobody would think to look for it.
 */
function resolvePaidAt(paidOn: string | undefined): Date {
  const timeZone = appointmentTimezone();
  const today = dateInZone(new Date(), timeZone);
  const date = paidOn?.trim() || today;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestError("Enter the payment date as YYYY-MM-DD.");
  }
  if (date > today) {
    throw new BadRequestError(
      "That payment date is in the future — check the date.",
    );
  }
  return zonedWallClockToInstant(date, MIDDAY_MINUTES, timeZone);
}

/** Validate the hand-typed figure before anything is written. The generated
 * schema promises only a non-negative number, so `0`, `NaN` and `Infinity` all
 * reach here — each a way to record a payment that isn't one. */
function resolveAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestError("Enter how much was paid.");
  }
  if (amount > MAX_PAYMENT) {
    throw new BadRequestError(
      `${money(amount)} looks like a typo — the most this will record at once is ${money(MAX_PAYMENT)}.`,
    );
  }
  return Math.round(amount * 100) / 100;
}

/** What one ledger row reads as in the run's summary. */
function historyLine(
  paidAt: Date,
  amountCents: number,
  method: string,
  stage: string,
  timeZone: string,
): string {
  const signed = amountCents / 100;
  const label = signed < 0 ? "refunded" : "paid";
  const parts = [
    dateInZone(paidAt, timeZone),
    `${money(Math.abs(signed))} ${label}`,
    method,
  ];
  if (stage) parts.push(stage.replace(/_/g, " "));
  return parts.join(" · ");
}

/**
 * Record a payment taken outside Stripe against an order.
 *
 * For a custom order it also settles the stage on the Notion invoice — but only
 * once the ledger actually covers the stage's amount. That condition is the
 * point: the atelier can take a deposit as two piles of cash a fortnight apart,
 * each recorded as its own row, and the checkbox flips when the second one lands
 * rather than on the first. A checkbox ticked by hand could never express the
 * halfway state, which is exactly how a part-paid deposit came to read as
 * settled.
 */
export async function recordOfflinePayment(
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const orderNumber = input.orderNumber.trim();
  if (!orderNumber) {
    throw new BadRequestError("Enter an order number.");
  }
  if (!postgresConfigured()) {
    // Unlike every other Postgres caller this cannot degrade: the ledger row is
    // the entire output. Reported by the tool as `attention` with the fix.
    throw new BadRequestError(
      "The payment ledger isn't configured — set POSTGRES_URL and run the migrations, then record this again.",
    );
  }

  const amount = resolveAmount(input.amount);
  const paidAt = resolvePaidAt(input.paidOn);
  const timeZone = appointmentTimezone();
  const isShop = orderNumber.toUpperCase().startsWith("SHP-");

  return isShop
    ? recordAgainstShopOrder(orderNumber, amount, paidAt, timeZone, input)
    : recordAgainstCustomOrder(orderNumber, amount, paidAt, timeZone, input);
}

async function recordAgainstShopOrder(
  orderNumber: string,
  amount: number,
  paidAt: Date,
  timeZone: string,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const order = await findShopOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find a shop order with that number.");
  }

  // No stage and no checkbox to settle: a shop order's money is a single sum,
  // and the row is the whole record.
  const written = await writeRow(orderNumber, "shop", amount, paidAt, input);
  return {
    orderNumber,
    orderKind: "shop",
    amount,
    method: input.method,
    paidAt,
    written,
    stageMarkedPaid: false,
    history: await readHistory(orderNumber, timeZone),
  };
}

async function recordAgainstCustomOrder(
  orderNumber: string,
  amount: number,
  paidAt: Date,
  timeZone: string,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const order = await findOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  const invoice = order.invoicePageId
    ? await findInvoice(order.invoicePageId)
    : null;

  // No invoice yet ⇒ there is no stage to settle, but the money still arrived.
  // Record it rather than refusing it, so the date isn't lost while the atelier
  // gets to building the invoice — keeping whatever stage they named, so the row
  // is already attributed when the invoice does appear.
  if (!invoice) {
    const written = await writeRow(
      orderNumber,
      "custom",
      amount,
      paidAt,
      input,
      input.stage,
    );
    return {
      orderNumber,
      orderKind: "custom",
      amount,
      method: input.method,
      paidAt,
      written,
      stageMarkedPaid: false,
      history: await readHistory(orderNumber, timeZone),
    };
  }

  const stage = input.stage;
  if (!stage) {
    throw new BadRequestError(
      "Choose which payment this covers — a deposit or the balance.",
    );
  }

  // The stage's customer-facing name, resolved exactly as the tracking page and
  // the Stripe line resolve it, so a repair paid in one go reads "Deposit"
  // rather than promising a second instalment nobody intended.
  const { payment } = resolveStoredOrderService(order.service);
  const deposits = labelDeposits(invoice.deposits, payment);
  const stageLabel =
    stage === "balance"
      ? "Balance"
      : (deposits.find((d) => d.stage === stage)?.label ?? "Deposit");

  const written = await writeRow(
    orderNumber,
    "custom",
    amount,
    paidAt,
    input,
    stage,
  );

  const expected = await expectedStageAmount(invoice, stage);
  const alreadyPaid =
    stage === "balance"
      ? invoice.balancePaid
      : (deposits.find((d) => d.stage === stage)?.paid ?? false);

  let stageMarkedPaid = false;
  let stageOutstanding: number | undefined;

  // `covered` is undefined when the ledger couldn't be read back. That is a
  // "can't tell", not a zero: the row is already written by this point, so
  // throwing here would report a recorded payment as a failure and invite the
  // atelier to record it a second time. Leaving the stage unsettled is the
  // recoverable direction — the next payment, or a re-run, re-evaluates it.
  const covered =
    expected === undefined
      ? undefined
      : await ledgerTotalForStage(orderNumber, stage);

  if (expected !== undefined && covered !== undefined) {
    stageOutstanding = Math.max(
      0,
      Math.round((expected - covered) * 100) / 100,
    );

    if (!alreadyPaid && covered + SETTLED_EPSILON >= expected) {
      // Settle it on the invoice, with a BLANK session id. That blank is the
      // established encoding for "paid outside Stripe" — `refundCheckoutSession`
      // already reads a paid stage with no session id as "refund manually"
      // rather than trying to refund a card that was never charged.
      try {
        await markInvoicePaid(invoice.pageId, stage, "");
        stageMarkedPaid = true;
        stageOutstanding = 0;
      } catch (err) {
        // The money is recorded either way; the checkbox is the atelier's own
        // view of it. Surfaced in the result rather than thrown, so a Notion
        // hiccup doesn't read as a lost payment.
        logger.error(
          { err, orderNumber, stage },
          "Recorded the payment but could not mark the invoice stage paid",
        );
      }
    }
  }

  return {
    orderNumber,
    orderKind: "custom",
    amount,
    method: input.method,
    paidAt,
    stageLabel,
    written,
    stageMarkedPaid,
    ...(stageOutstanding !== undefined ? { stageOutstanding } : {}),
    history: await readHistory(orderNumber, timeZone),
  };
}

/** What the stage is owed in dollars, or undefined when it can't be derived
 * (an unready invoice has no itemized balance to compare against yet). */
async function expectedStageAmount(
  invoice: Awaited<ReturnType<typeof findInvoice>>,
  stage: PaymentStage,
): Promise<number | undefined> {
  if (!invoice) return undefined;
  if (stage !== "balance") {
    return invoice.deposits.find((d) => d.stage === stage)?.amount;
  }
  if (!invoice.ready) return undefined;
  const lineItems = await listInvoiceLineItems(invoice.pageId);
  return buildInvoiceView(invoice, lineItems).balanceDue;
}

/**
 * What the ledger says has been paid toward one stage, in dollars — or undefined
 * when it couldn't be read.
 *
 * Sums every row, the Stripe charge for that stage as readily as the cash, so a
 * deposit part-paid by card and finished in person settles correctly. The
 * undefined case is load-bearing: this runs AFTER the new row is written, so a
 * read failure must degrade rather than throw. See the caller.
 */
async function ledgerTotalForStage(
  orderNumber: string,
  stage: PaymentStage,
): Promise<number | undefined> {
  try {
    const rows = await listOrderPayments(orderNumber);
    const cents = rows
      .filter((row) => row.stage === stage)
      .reduce((sum, row) => sum + row.amountCents, 0);
    return Math.round(cents) / 100;
  } catch (err) {
    logger.error(
      { err, orderNumber, stage },
      "Recorded the payment but could not read the ledger back to settle the stage",
    );
    return undefined;
  }
}

async function writeRow(
  orderNumber: string,
  orderKind: PaymentOrderKind,
  amount: number,
  paidAt: Date,
  input: RecordPaymentInput,
  stage?: PaymentStage,
): Promise<boolean> {
  return recordPaymentEntry({
    orderNumber,
    orderKind,
    ...(stage ? { stage } : {}),
    kind: "charge",
    amountCents: Math.round(amount * 100),
    method: input.method,
    paidAt,
    // No `externalId`: this payment has no Stripe object behind it, which is
    // also what exempts it from the ledger's unique index — so a deposit paid as
    // two identical piles of cash records as two rows rather than being
    // swallowed as a duplicate.
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.recordedBy?.trim()
      ? { recordedBy: input.recordedBy.trim() }
      : {}),
  });
}

/** The order's payments as display lines, oldest first. Read back after the
 * write so the atelier sees what the ledger now holds rather than what this one
 * run put in it — which is how a double press shows itself. */
async function readHistory(
  orderNumber: string,
  timeZone: string,
): Promise<string[]> {
  try {
    const rows = await listOrderPayments(orderNumber);
    return rows.map((row) =>
      historyLine(row.paidAt, row.amountCents, row.method, row.stage, timeZone),
    );
  } catch (err) {
    // The payment is recorded; failing to read the history back is a display
    // problem, not a reason to report the write as failed.
    logger.warn(
      { err, orderNumber },
      "Could not read the payment history back",
    );
    return [];
  }
}
