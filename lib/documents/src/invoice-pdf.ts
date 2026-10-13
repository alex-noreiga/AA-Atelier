import type { Invoice, InvoiceDeposit } from "@workspace/api-zod";
import { formatPrice, formatDate } from "./format";
import { groupLineItems } from "./invoice-format";
import { PdfDocument } from "./document";
import { STUDIO_CONTACT_LINES } from "./studio";

export { invoiceFilename } from "./filenames";

export interface InvoicePdfInput {
  orderNumber: string;
  orderName: string;
  invoice: Invoice;
  deposits: InvoiceDeposit[];
}

/**
 * Lay out a branded PDF of a custom order's invoice. It renders the same
 * itemized data the on-screen invoice shows (grouped via the shared
 * `groupLineItems`), so the document and the page can't disagree — no pricing
 * logic lives here. The browser builds it for the customer's download; the
 * server builds the identical document for the studio dashboard and for the
 * copy kept on the invoice's Notion page.
 */
export function buildInvoiceDoc({
  orderNumber,
  orderName,
  invoice,
  deposits,
}: InvoicePdfInput): PdfDocument {
  const pdf = new PdfDocument();

  const meta = [
    `Invoice ${invoice.invoiceId || orderNumber}`,
    `Order ${orderNumber}`,
  ];
  if (invoice.paymentDeadline) {
    meta.push(
      `Due ${formatDate(invoice.paymentDeadline) || invoice.paymentDeadline}`,
    );
  }
  pdf.masthead("Invoice", meta);

  pdf.title(orderName);

  for (const group of groupLineItems(invoice.lineItems)) {
    pdf.sectionLabel(group.heading);
    for (const item of group.items) {
      pdf.row(item.name, formatPrice(item.amount));
    }
    pdf.spacer(6);
  }

  pdf.divider();
  pdf.row("Subtotal", formatPrice(invoice.subtotal), { muted: true });
  for (const deposit of deposits) {
    const label = deposit.paid ? deposit.label : `${deposit.label} (unpaid)`;
    const value = deposit.paid
      ? `−${formatPrice(deposit.amount)}`
      : formatPrice(0);
    pdf.row(label, value, { muted: true });
  }
  pdf.total("Balance due", formatPrice(invoice.balanceDue));

  if (invoice.paid) pdf.note("Balance paid");

  pdf.footer([
    "Thank you for your custom order with A.A Atelier.",
    STUDIO_CONTACT_LINES.join("   ·   "),
  ]);

  return pdf;
}
