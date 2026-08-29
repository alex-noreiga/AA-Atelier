// Crediting an issued invoice.
//
// WHY THIS EXISTS. Issuing (6b) made an invoice's charges immutable, which is
// what stops them moving under a customer who has already been shown them — and
// deliberately left no way to re-issue. That is right, and it left the atelier
// with no way to reduce an invoice at all: one issued for too much, work that
// was dropped, a goodwill discount. A credit note is the answer invoicing has
// always used — a second document against the first, rather than an edit to a
// document somebody already has.
//
// THE DISTINCTION THAT MATTERS MOST: a credit note reduces what is OWED. It is
// not a refund. If the customer has already paid, moving money back is a
// separate act with its own tools (`cancellation-refund` / `return-refund`),
// which go through Stripe and record themselves in the payment ledger. Crediting
// a settled invoice leaves the customer owed money and SAYS so; it never quietly
// sends any.

import { findOrderByNumber } from "../lib/notion/orders.repository.js";
import { findInvoice } from "../lib/notion/invoice.repository.js";
import { postgresConfigured } from "../lib/db/client.js";
import {
  createCreditNote,
  listCreditNotes,
  type CreditNote,
} from "../lib/db/credit-notes.repository.js";
import { readIssuedInvoice } from "./invoice-issue.service.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** The largest single credit the tool will write, as a guard against a stray
 * digit — the same reasoning and the same ceiling as the quote and the
 * hand-recorded payment. The invoice's own value bounds it far tighter in
 * practice; this catches a typo on an invoice that happens to be large. */
const MAX_CREDIT = 100_000;

function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export interface CreditNoteResult {
  orderNumber: string;
  creditNumber: string;
  issuedAt: Date;
  /** This credit, in dollars. */
  amount: number;
  reason: string;
  /** What the issued invoice charges. */
  invoiceSubtotal: number;
  /** Every credit against it now, including this one. */
  creditedTotal: number;
  /** What the invoice charges after credits. */
  remaining: number;
  /** The customer has already settled the balance, so this credit is money they
   * are owed rather than money they no longer have to send. */
  alreadyPaid: boolean;
  /** Each credit note on the invoice, oldest first, as display lines. */
  history: string[];
}

/**
 * Write a credit note against an order's issued invoice.
 *
 * Requires the invoice to have been ISSUED: a credit note credits a document,
 * and an invoice that was never issued has no document to credit — its lines are
 * still editable, so the atelier changes them and issues it. That refusal is the
 * feature, not a gap.
 */
export async function creditOrderInvoice(input: {
  orderNumber: string;
  amount: number;
  reason: string;
  issuedBy?: string;
}): Promise<CreditNoteResult> {
  const orderNumber = input.orderNumber.trim();
  if (!orderNumber) {
    throw new BadRequestError("Enter an order number.");
  }

  const reason = input.reason.trim();
  if (!reason) {
    // The reason is on the customer's invoice, not in an internal log. A credit
    // with no explanation is a number appearing on a document with nothing to
    // say for itself.
    throw new BadRequestError(
      "Say what the credit is for — the customer sees it on their invoice.",
    );
  }

  // The generated schema promises only a non-negative number, so $0, NaN and
  // Infinity all reach here — each a way to write a credit that isn't one.
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new BadRequestError("Enter how much to credit.");
  }
  if (input.amount > MAX_CREDIT) {
    throw new BadRequestError(
      `${money(input.amount)} looks like a typo — the most this will credit at once is ${money(MAX_CREDIT)}.`,
    );
  }

  if (!postgresConfigured()) {
    throw new BadRequestError(
      "Credit notes need the database — set POSTGRES_URL and run the migrations, then raise this again.",
    );
  }

  const order = await findOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  if (!order.invoicePageId) {
    throw new BadRequestError("There's no invoice for this order yet.");
  }

  const invoice = await findInvoice(order.invoicePageId);
  if (!invoice) {
    throw new BadRequestError("There's no invoice for this order yet.");
  }

  const issued = await readIssuedInvoice(invoice.pageId);
  if (!issued) {
    throw new BadRequestError(
      "This invoice hasn't been issued, so there's no document to credit. Edit its line items and issue it instead.",
    );
  }

  const amountCents = toCents(input.amount);
  const existing = await listCreditNotes(invoice.pageId);
  const alreadyCredited = existing.reduce(
    (sum, note) => sum + note.amountCents,
    0,
  );
  const headroom = issued.subtotalCents - alreadyCredited;

  // A document cannot be reduced below nothing. This is also the guard that
  // makes a double press bounded rather than unbounded: the second one is
  // refused outright once the two would exceed the invoice.
  if (amountCents > headroom) {
    throw new BadRequestError(
      headroom <= 0
        ? `${issued.invoiceNumber} is already fully credited (${money(alreadyCredited / 100)} of ${money(issued.subtotalCents / 100)}).`
        : `That's more than is left to credit on ${issued.invoiceNumber} — ${money(headroom / 100)} of ${money(issued.subtotalCents / 100)} remains after the credits already raised.`,
    );
  }

  const note = await createCreditNote({
    invoicePageId: invoice.pageId,
    orderNumber: order.orderNumber,
    amountCents,
    reason,
    ...(input.issuedBy ? { issuedBy: input.issuedBy } : {}),
  });

  const creditedTotal = alreadyCredited + amountCents;
  const notes = [...existing, note];

  return {
    orderNumber: order.orderNumber,
    creditNumber: note.creditNumber,
    issuedAt: note.issuedAt,
    amount: amountCents / 100,
    reason,
    invoiceSubtotal: issued.subtotalCents / 100,
    creditedTotal: creditedTotal / 100,
    remaining: (issued.subtotalCents - creditedTotal) / 100,
    // Read from the live invoice head, not from anything frozen: whether the
    // balance has been settled is exactly the kind of thing that changes after
    // a document is issued.
    alreadyPaid: invoice.balancePaid,
    history: notes.map(creditLine),
  };
}

/** One credit note as it reads in the run's summary. */
function creditLine(note: CreditNote): string {
  const on = note.issuedAt.toISOString().slice(0, 10);
  return `${note.creditNumber} · ${on} · ${money(note.amountCents / 100)} · ${note.reason}`;
}

/** The credit notes against an invoice, and whether we could actually ask. */
export interface CreditNoteRead {
  credits: CreditNote[];
  /** The database is configured but wouldn't answer. Distinct from "there are
   * none": one is a fact about the invoice, the other is a fact about us. */
  unavailable: boolean;
}

/**
 * The credit notes against an invoice, for the customer's own view.
 *
 * Three-valued rather than best-effort, and that is deliberate. Swallowing a
 * failure into an empty list would be indistinguishable from an uncredited
 * invoice — and an uncredited invoice is charged at its FULL amount, so a
 * transient database blip would take money from a customer who had been
 * credited. That is precisely the class of error this whole card is about, so
 * the failure is carried rather than flattened: the page still renders (a
 * display showing too high a balance is recoverable), while the balance
 * checkout refuses to price anything it cannot confirm — see
 * `createPaymentCheckout`.
 *
 * An UNCONFIGURED database is not a failure: credit notes cannot exist without
 * one, so an empty list is the true answer and `unavailable` stays false.
 */
export async function readCreditNotes(
  invoicePageId: string,
): Promise<CreditNoteRead> {
  if (!postgresConfigured()) return { credits: [], unavailable: false };
  try {
    return {
      credits: await listCreditNotes(invoicePageId),
      unavailable: false,
    };
  } catch (err) {
    logger.warn(
      { err, invoicePageId },
      "Could not read credit notes; the balance will not be priced from an unconfirmed invoice",
    );
    return { credits: [], unavailable: true };
  }
}

export type { CreditNote };
