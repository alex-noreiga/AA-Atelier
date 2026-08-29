// Quote a flat price for one custom order, and make it payable.
//
// WHY THIS EXISTS. The other way onto an invoice — `invoice-generator.service.ts`
// — itemizes from the atelier's *costing* system, which is built around a whole
// garment: a costing item with material usage lines, a labor formula and a
// margin-loaded `Suggested Price`. That is the right model for a bespoke
// commission and the wrong one for the three services performed on a piece the
// customer already owns. Nobody builds a costing to re-stone a bodice; the price
// is quoted in a sentence. So the generator refuses those orders outright
// ("This order has no costing items to itemize"), which left them with no line
// items, a `balanceDue` of $0, and a balance checkout that refused to open — a
// repair simply could not be paid for online.
//
// This closes that without inventing a second source of truth. The invoice stays
// the only place money lives: the atelier's typed figure is written to Notion as
// one priced `Invoice Line Item`, and every downstream reader — the tracking
// page, the balance checkout, the payment reminders, the refunds, the studio
// analytics — sees an ordinary invoice and needs no knowledge that a human typed
// the number rather than a formula deriving it.
//
// It is deliberately NOT restricted to those three services. An order is a
// candidate for a flat quote because it has no costing, not because of what it
// says on its `Service` property — and a commission the atelier chooses to quote
// as one figure is their business, not ours to refuse.

import { findOrderByNumber } from "../lib/notion/orders.repository.js";
import {
  listInvoiceLineItems,
  createInvoiceLineItem,
  setInvoiceTitle,
  setInvoiceReady,
} from "../lib/notion/invoice.repository.js";
import {
  LINE_TYPE_SERVICE,
  LINE_TYPE_SURCHARGE,
} from "../lib/notion/invoice-line-items.blocks.js";
import { resolveStoredOrderService } from "../lib/service-catalog.js";
import { rushSurchargeRate, rushSurchargeLineName } from "./rush.js";
import { issueOrderInvoice } from "./invoice-issue.service.js";
import { logger } from "../lib/logger.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";

/** Round a dollar amount to whole cents, killing float noise from the rate. */
function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Below half a cent a surcharge is not worth a line of its own. */
const SURCHARGE_EPSILON = 0.005;

/** The largest quote the tool will write, as a guard against a typo (a stray
 * digit on a hand-typed figure is the one input error that matters here, since
 * the number becomes what a customer is charged). Not a business limit — an
 * order genuinely worth more than this is itemized from a costing. */
const MAX_QUOTE = 100_000;

export interface QuoteResult {
  orderNumber: string;
  /** The invoice already had line items, so nothing was written (the title was
   * still reconciled). Mirrors the generator's own idempotency report. */
  alreadyPresent: boolean;
  /** The line's customer-facing name, as written. */
  lineName: string;
  /** The quoted price, before any rush surcharge. */
  amount: number;
  /** The rush surcharge in dollars, when the order is a rush and a line was
   * written (0 otherwise). */
  rushSurcharge: number;
  /** What the customer will owe: the quote plus any surcharge. */
  invoiceTotal: number;
}

export interface QuoteInput {
  orderNumber: string;
  /** The staff member quoting, carried through to the issued invoice. */
  issuedBy?: string;
  /** Dollars. Must be a finite number above zero. */
  amount: number;
  /** What the work is, as the customer reads it. Blank ⇒ the order's service
   * name ("Repair", "Rhinestoning", "Alterations"). */
  description?: string;
}

/**
 * Write a one-line quote to an order's invoice and mark it ready to pay.
 *
 * Idempotent by the same rule as the costing generator: an invoice that already
 * has line items is left alone and reported as a no-op, so a double press can't
 * bill a customer twice. Re-quoting means deleting the line in Notion first —
 * which is the right amount of friction for changing a price somebody may
 * already have been shown.
 */
export async function quoteOrder(input: QuoteInput): Promise<QuoteResult> {
  const { amount, description } = input;

  // Validate the money before touching Notion — the generated zod schema only
  // guarantees a non-negative number, and $0 / NaN / Infinity are each a way to
  // produce an invoice nobody can pay.
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestError("Enter the price of the work, in dollars.");
  }
  if (amount > MAX_QUOTE) {
    throw new BadRequestError(
      `That quote looks like a typo — ${MAX_QUOTE.toLocaleString("en-US")} dollars is the most this tool will write.`,
    );
  }
  const quoted = roundCents(amount);

  const order = await findOrderByNumber(input.orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  if (!order.invoicePageId) {
    throw new BadRequestError(
      "There's no invoice for this order yet. Create one in Notion and link it to the order first.",
    );
  }
  const { invoicePageId } = order;

  // Name the invoice after the order number regardless of state, so a press
  // always reconciles the title — the same contract the generator keeps.
  await setInvoiceTitle(invoicePageId, order.orderNumber);

  // Idempotency guard: never add to an invoice that already has lines, whether
  // from a previous quote, the costing generator, or the atelier's own hand.
  const existing = await listInvoiceLineItems(invoicePageId);
  if (existing.length > 0) {
    return {
      orderNumber: order.orderNumber,
      alreadyPresent: true,
      lineName: "",
      amount: 0,
      rushSurcharge: 0,
      invoiceTotal: 0,
    };
  }

  // A blank description falls back to the service's own word for the work, so
  // the line always reads as something rather than as an empty title.
  const lineName =
    description?.trim() || resolveStoredOrderService(order.service).orderLabel;

  await createInvoiceLineItem({
    invoicePageId,
    name: lineName,
    lineType: LINE_TYPE_SERVICE,
    unitPrice: quoted,
  });

  // A rush order was shown the surcharge at intake and ticked a box to accept
  // it, so it is charged here for the same reason the costing generator charges
  // it: the invoice has to match what the customer was told. Priced off the
  // quote, written to Notion as its own line like every other charge.
  const rushRate = rushSurchargeRate();
  let rushSurcharge = 0;
  if (order.rush && rushRate > 0) {
    const surcharge = roundCents(quoted * rushRate);
    if (surcharge >= SURCHARGE_EPSILON) {
      await createInvoiceLineItem({
        invoicePageId,
        name: rushSurchargeLineName(rushRate),
        lineType: LINE_TYPE_SURCHARGE,
        unitPrice: surcharge,
      });
      rushSurcharge = surcharge;
    }
  }

  // A quote is a finished invoice by construction — there is nothing further to
  // itemize — so it is ISSUED here rather than leaving a step to forget: the
  // snapshot is written and the gate ticked in one go. Last, so a failure
  // part-way through never exposes a half-written invoice to pay.
  //
  // Best-effort on the ISSUING half only. The line is already written, so a
  // database outage must not lose the quote; it degrades to the pre-6b
  // behaviour — ready to pay, computed live, with no invoice number — and the
  // atelier can press "Issue an invoice" once the database is back.
  try {
    await issueOrderInvoice({
      orderNumber: order.orderNumber,
      ...(input.issuedBy ? { issuedBy: input.issuedBy } : {}),
    });
  } catch (err) {
    logger.error(
      { err, orderNumber: order.orderNumber },
      "Wrote the quote but could not issue the invoice; ticking Invoice Ready directly",
    );
    await setInvoiceReady(invoicePageId, true);
  }

  return {
    orderNumber: order.orderNumber,
    alreadyPresent: false,
    lineName,
    amount: quoted,
    rushSurcharge,
    invoiceTotal: roundCents(quoted + rushSurcharge),
  };
}
