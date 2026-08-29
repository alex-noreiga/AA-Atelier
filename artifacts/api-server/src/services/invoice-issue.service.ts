// Issuing an invoice — turning a set of editable Notion rows into a document.
//
// WHY THIS EXISTS. `Invoice Ready` was a checkbox, not an event. Ticking it
// published an invoice whose line items stayed fully editable afterwards, so the
// charges could move under a customer who had already been shown them — and
// already paid a deposit against them — with nothing recording what the document
// used to say. It also carried no number and no date of its own: `Invoice ID` is
// the order's `ORD-` number and is display-only.
//
// Issuing snapshots the charges into `issued_invoices`, once, and ticks the
// gate. From then on the customer's invoice page, its PDF and the balance
// checkout all read the snapshot rather than recomputing from live Notion, so
// what was shown is what is charged.
//
// The line the design draws:
//
//   FROZEN — the lines and their subtotal. A charge that moves after the
//   customer has seen it is the whole defect.
//
//   LIVE — which deposits have been paid, and so the balance due. Paying a
//   deposit legitimately reduces what is owed; that is the invoice working, not
//   drifting. The deposit schedule is snapshotted for the record, but the live
//   invoice head still decides what is payable, because deposits are payable
//   before an invoice is itemized at all.
//
// What this deliberately does NOT do is put a tax figure on the document. Stripe
// computes tax from an address collected at checkout, and the invoice has no
// address at issue time, so the amount genuinely cannot be known here. The
// snapshot records only THAT the balance is taxed, so the document can say so
// rather than silently showing a total the customer won't be charged.

import {
  findInvoice,
  listInvoiceLineItems,
  setInvoiceReady,
} from "../lib/notion/invoice.repository.js";
import {
  findOrderByNumber,
  findOrderForStageNotification,
} from "../lib/notion/orders.repository.js";
import {
  chargedLines,
  invoiceChargedTotal,
  type InvoiceRecord,
  type InvoiceLineItemRecord,
} from "../lib/notion/invoice.schema.js";
import { resolveStoredOrderService } from "../lib/service-catalog.js";
import { labelDeposits } from "./payment-labels.js";
import { postgresConfigured } from "../lib/db/client.js";
import {
  issueInvoice,
  findIssuedInvoice,
  type IssuedInvoice,
} from "../lib/db/issued-invoices.repository.js";
import { issuedInvoiceEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** Dollars → integer cents, the conversion used everywhere money is stored. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export interface IssueInvoiceResult {
  orderNumber: string;
  invoiceNumber: string;
  issuedAt: Date;
  subtotal: number;
  lineCount: number;
  /** The invoice had already been issued, so nothing was written. */
  alreadyIssued: boolean;
  /** The `Invoice Ready` gate was flipped by this run. */
  markedReady: boolean;
  /** The customer was emailed their invoice. */
  emailed: boolean;
  /** Why they weren't, when they weren't — for the atelier's summary. */
  emailSkipped?: string;
}

/**
 * Snapshot an order's invoice and open it for payment.
 *
 * Idempotent by the database: `issued_invoices.invoice_page_id` is unique, so a
 * second press reports the number and date already on file rather than writing
 * a second document. There is deliberately no re-issue — the point of the record
 * is that it cannot be rewritten, and an invoice that genuinely needs to change
 * after being shown to a customer is a credit note, not an edit.
 */
export async function issueOrderInvoice(input: {
  orderNumber: string;
  issuedBy?: string;
}): Promise<IssueInvoiceResult> {
  const orderNumber = input.orderNumber.trim();
  if (!orderNumber) {
    throw new BadRequestError("Enter an order number.");
  }
  if (!postgresConfigured()) {
    // Unlike the ledger's best-effort writes this cannot degrade: the snapshot
    // IS the issued invoice, and ticking the gate without one would publish
    // exactly the mutable document this replaces.
    throw new BadRequestError(
      "Issuing needs the database — set POSTGRES_URL and run the migrations, then issue this again.",
    );
  }

  const order = await findOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  if (!order.invoicePageId) {
    throw new BadRequestError(
      "There's no invoice for this order yet. Create one in Notion and link it to the order first.",
    );
  }

  const invoice = await findInvoice(order.invoicePageId);
  if (!invoice) {
    throw new BadRequestError("There's no invoice for this order yet.");
  }

  const lineItems = await listInvoiceLineItems(invoice.pageId);
  const charged = chargedLines(lineItems);
  if (charged.length === 0) {
    // An invoice with nothing on it is not a document. Itemize it from the
    // costing, or quote it a flat price, first.
    throw new BadRequestError(
      "This invoice has no line items yet, so there's nothing to issue. Itemize it or quote a price first.",
    );
  }

  const { payment } = resolveStoredOrderService(order.service);
  const deposits = labelDeposits(invoice.deposits, payment);

  const { issued, alreadyIssued } = await issueInvoice({
    invoicePageId: invoice.pageId,
    orderNumber: order.orderNumber,
    subtotalCents: toCents(invoiceChargedTotal(charged)),
    // Only the final balance is taxed (deposits are partial pre-payments and
    // stay untaxed) — see `createPaymentCheckout`.
    taxed: true,
    lines: charged.map((line) => ({
      name: line.name,
      type: line.type,
      amountCents: toCents(line.amount),
    })),
    deposits: deposits.map((deposit) => ({
      stage: deposit.stage,
      label: deposit.label,
      amountCents: toCents(deposit.amount),
    })),
    ...(input.issuedBy ? { issuedBy: input.issuedBy } : {}),
  });

  // Tick the gate LAST, and only after the snapshot exists, so a failure
  // part-way through can never publish an invoice with no document behind it.
  // Already-ready is not re-written: the flag is the customer-facing gate and
  // setting it twice says nothing new.
  let markedReady = false;
  if (!invoice.ready) {
    try {
      await setInvoiceReady(invoice.pageId, true);
      markedReady = true;
    } catch (err) {
      // The document is issued and immutable; the gate is a Notion checkbox the
      // atelier can tick by hand. Report it rather than throwing, so a Notion
      // hiccup doesn't read as a failed issue and invite a re-press that would
      // only find the invoice already issued.
      logger.error(
        { err, orderNumber, invoicePageId: invoice.pageId },
        "Issued the invoice but could not tick Invoice Ready",
      );
    }
  }

  // Send the customer their invoice — but only when this run actually issued
  // one. A re-press changed nothing, and a second copy of the same document
  // reads as a chase rather than a delivery. Best-effort, like every other
  // customer email: the document is written either way.
  const delivery = alreadyIssued
    ? { emailed: false, emailSkipped: "already issued — no email sent" }
    : await sendIssuedInvoiceEmail(order.orderNumber, invoice, issued);

  return {
    orderNumber: order.orderNumber,
    invoiceNumber: issued.invoiceNumber,
    issuedAt: issued.issuedAt,
    subtotal: issued.subtotalCents / 100,
    lineCount: issued.lines.length,
    alreadyIssued,
    markedReady,
    ...delivery,
  };
}

/**
 * Email the customer their newly issued invoice.
 *
 * Resolves the address through `findOrderForStageNotification` — one extra
 * Notion read, and the established way the app gets a customer's email, since
 * `findOrderByNumber` deliberately doesn't carry one (the tracking lookup is
 * gated by order number alone, so it must not echo an address back).
 *
 * Never throws, and reports why it didn't send: this runs after an immutable
 * document has been written, so a Resend hiccup must not read as a failed issue
 * and invite a re-press that could only find the invoice already issued.
 */
async function sendIssuedInvoiceEmail(
  orderNumber: string,
  invoice: InvoiceRecord,
  issued: IssuedInvoice,
): Promise<{ emailed: boolean; emailSkipped?: string }> {
  try {
    const notify = await findOrderForStageNotification(orderNumber);
    if (!notify?.email?.trim()) {
      return {
        emailed: false,
        emailSkipped: "this order has no email address on file",
      };
    }

    // The balance as it stands right now. Deposits already paid are credited
    // live, exactly as the invoice page credits them; CREDIT NOTES cannot exist
    // yet, because crediting requires an issued invoice and this one has only
    // just become one.
    const subtotal = issued.subtotalCents / 100;
    const depositsPaid = invoice.deposits.reduce(
      (sum, deposit) => (deposit.paid ? sum + deposit.amount : sum),
      0,
    );
    const balanceDue = Math.max(
      0,
      Math.round((subtotal - depositsPaid) * 100) / 100,
    );

    // Read defensively rather than through `siteBaseUrl()`, which THROWS when
    // PUBLIC_BASE_URL is unset — that would take the whole send down over a
    // missing link. Every other customer email omits its CTA the same way (see
    // `schedule.service`'s reminder links), and this one's copy already falls
    // back to "look up your order number".
    const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");

    await sendEmailBestEffort({
      ...issuedInvoiceEmail({
        email: notify.email,
        orderNumber,
        orderName: notify.orderName,
        invoiceNumber: issued.invoiceNumber,
        issuedAt: issued.issuedAt.toISOString(),
        lines: issued.lines.map((line) => ({
          name: line.name,
          amount: line.amountCents / 100,
        })),
        subtotal,
        deposits: invoice.deposits.map((deposit) => ({
          label: deposit.label,
          amount: deposit.amount,
          paid: deposit.paid,
        })),
        balanceDue,
        taxed: issued.taxed,
        ...(invoice.paymentDeadline
          ? { paymentDeadline: invoice.paymentDeadline }
          : {}),
        ...(base ? { invoiceUrl: `${base}/invoice/${orderNumber}` } : {}),
      }),
      from: fromAddress("orders"),
    });
    return { emailed: true };
  } catch (err) {
    logger.error(
      { err, orderNumber },
      "Issued the invoice but could not email it to the customer",
    );
    return { emailed: false, emailSkipped: "the email could not be sent" };
  }
}

/**
 * The issued snapshot for an invoice, or null when it was never issued.
 *
 * BEST-EFFORT: an unconfigured or unreachable database answers null, which falls
 * every reader back to computing from live Notion — exactly the behaviour before
 * issuing existed. A customer must be able to see and pay their invoice during a
 * Postgres outage; the cost of that is the pre-6b mutability, not a dead page.
 */
export async function readIssuedInvoice(
  invoicePageId: string,
): Promise<IssuedInvoice | null> {
  if (!postgresConfigured()) return null;
  try {
    return await findIssuedInvoice(invoicePageId);
  } catch (err) {
    logger.warn(
      { err, invoicePageId },
      "Could not read the issued invoice; falling back to the live line items",
    );
    return null;
  }
}

/**
 * The charged lines an invoice should be READ and PRICED from: the issued
 * snapshot where there is one, else the live Notion rows.
 *
 * This is the single place the fallback is decided, so the customer's invoice
 * page, its PDF and the balance checkout can never disagree about which document
 * they are looking at — being shown one total and charged another is the sharpest
 * form of the bug this whole card is about.
 */
export function chargedLinesOf(
  issued: IssuedInvoice | null,
  liveLineItems: InvoiceLineItemRecord[],
): InvoiceLineItemRecord[] {
  if (!issued) return chargedLines(liveLineItems);
  return issued.lines.map((line) => ({
    name: line.name,
    type: line.type,
    amount: line.amountCents / 100,
  }));
}

/** Whether this invoice is one the reader should treat as issued. Kept next to
 * `chargedLinesOf` so the two are read together. */
export function issuedIdentity(
  issued: IssuedInvoice | null,
): { invoiceNumber: string; issuedAt: string } | null {
  if (!issued) return null;
  return {
    invoiceNumber: issued.invoiceNumber,
    issuedAt: issued.issuedAt.toISOString(),
  };
}

/** Re-exported so callers don't reach past this service into the repository. */
export type { IssuedInvoice, InvoiceRecord };
