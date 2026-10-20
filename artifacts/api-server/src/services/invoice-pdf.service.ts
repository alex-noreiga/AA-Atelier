// The customer's invoice PDF, rendered on the server for the atelier.
//
// A customer downloads their invoice from `/invoice/:orderNumber`, where the
// browser lays it out with jsPDF. The atelier wants to see that document too —
// on the studio dashboard, and as a copy kept on the invoice's own Notion page —
// and the only honest way to show "the PDF the customer is shown" is to run the
// same layout code. So `@workspace/documents` holds that code once, and this
// service feeds it exactly what `GET /orders/:n` feeds the customer: the invoice
// view and the labelled deposits from `invoicePaymentInfoFor`. There is no
// second template to drift, and nothing here prices anything.
//
// Two things are deliberate:
//
//  1. **It renders what the customer can see, and nothing earlier.** An invoice
//     that isn't `Invoice Ready` has no customer-facing PDF — the tracking page
//     shows nothing to pay — so asking for one is answered with WHY rather than
//     with a draft the customer couldn't have downloaded. The dashboard's
//     itemize → review → tick-ready flow is unchanged.
//  2. **The copy in Notion is a snapshot, and says so.** The customer's download
//     is always built live; the Notion file is the invoice as it stood when the
//     atelier pressed Save. Re-saving replaces it (on the `Invoice PDF`
//     property) rather than piling up versions — the row should carry the
//     current rendering, and Notion's own page history keeps the rest.

import { findOrderByNumber } from "../lib/notion/orders.repository.js";
import {
  findInvoice,
  attachInvoicePdf,
  type InvoicePdfPlacement,
} from "../lib/notion/invoice.repository.js";
import { uploadFileToNotion } from "../lib/notion/file-uploads.repository.js";
import { invoicePaymentInfoFor } from "./invoice.service.js";
import { buildInvoiceDoc, invoiceFilename } from "@workspace/documents";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const INVOICE_PDF_CONTENT_TYPE = "application/pdf";

/** A rendered invoice PDF plus what it says, for a result sentence. */
export interface InvoicePdfRender {
  orderNumber: string;
  orderName: string;
  /** The atelier's invoice identifier (its Notion title). */
  invoiceId: string;
  /** The download filename, the same one the customer's download uses. */
  filename: string;
  contentType: typeof INVOICE_PDF_CONTENT_TYPE;
  bytes: Buffer;
  /** How many charged lines the invoice carries. */
  lineCount: number;
  /** The balance the document shows as due, in dollars. */
  balanceDue: number;
  /** Whether the document is stamped "Balance paid". */
  paid: boolean;
}

/** A render plus the invoice page it came from, for the save path. */
interface ResolvedInvoicePdf {
  render: InvoicePdfRender;
  invoicePageId: string;
}

async function resolveInvoicePdf(
  orderNumber: string,
): Promise<ResolvedInvoicePdf> {
  const order = await findOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }
  if (!order.invoicePageId) {
    throw new BadRequestError(
      "There's no invoice for this order yet. Create one in Notion and link it to the order first.",
    );
  }
  const head = await findInvoice(order.invoicePageId);
  if (!head) {
    throw new BadRequestError(
      "This order's Invoices relation points at an invoice page that no longer exists. Link the order to its invoice in Notion first.",
    );
  }
  const { deposits, invoice } = await invoicePaymentInfoFor(order, head);
  if (!invoice) {
    throw new BadRequestError(
      `Invoice ${head.invoiceId || order.orderNumber} isn't marked ready yet, so the customer can't see it and there's no PDF to show. Tick Invoice Ready in Notion once it's itemized (a flat quote ticks it for you).`,
    );
  }

  const doc = buildInvoiceDoc({
    orderNumber: order.orderNumber,
    orderName: order.orderName,
    invoice,
    deposits,
  });

  return {
    invoicePageId: order.invoicePageId,
    render: {
      orderNumber: order.orderNumber,
      orderName: order.orderName,
      invoiceId: invoice.invoiceId,
      filename: invoiceFilename(order.orderNumber),
      contentType: INVOICE_PDF_CONTENT_TYPE,
      bytes: Buffer.from(doc.bytes()),
      lineCount: invoice.lineItems.length,
      balanceDue: invoice.balanceDue,
      paid: invoice.paid,
    },
  };
}

/**
 * Render an order's invoice exactly as the customer downloads it.
 *
 * Throws a `NotFoundError` for an unknown order and a `BadRequestError` — with
 * the reason, written for the atelier — when the order has no invoice yet or
 * the invoice isn't marked ready, since in both cases the customer has no PDF
 * either.
 */
export async function renderInvoicePdf(
  orderNumber: string,
): Promise<InvoicePdfRender> {
  return (await resolveInvoicePdf(orderNumber)).render;
}

/** What saving the PDF to Notion did. */
export interface InvoicePdfSaveResult extends InvoicePdfRender {
  /** `property` — on the invoice's `Invoice PDF` files property (replacing the
   * previous copy); `page` — appended to the invoice page body because the
   * database has no such property yet. */
  placement: InvoicePdfPlacement;
}

/**
 * Render the invoice PDF and keep a copy on the invoice's Notion page.
 *
 * Not idempotent in the strict sense — every press uploads a fresh rendering —
 * but a repeat is harmless: on the files property it replaces the previous
 * copy, and on the page body it adds one more block the atelier can delete.
 */
export async function saveInvoicePdfToNotion(
  orderNumber: string,
): Promise<InvoicePdfSaveResult> {
  const { render, invoicePageId } = await resolveInvoicePdf(orderNumber);

  const fileUploadId = await uploadFileToNotion({
    data: render.bytes,
    filename: render.filename,
    contentType: render.contentType,
  });
  const placement = await attachInvoicePdf(invoicePageId, {
    fileUploadId,
    filename: render.filename,
  });

  logger.info(
    {
      orderNumber: render.orderNumber,
      invoicePageId,
      placement,
      bytes: render.bytes.length,
    },
    "Invoice PDF saved to Notion",
  );

  return { ...render, placement };
}
