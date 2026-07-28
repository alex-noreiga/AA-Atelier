import type { Invoice, InvoiceDeposit } from "@workspace/api-client-react";
import { formatPrice, formatDate } from "@/lib/format";
import { groupLineItems } from "@/lib/invoice-format";
import { PdfDocument, fileSafe } from "./document";
import { STUDIO_CONTACT_LINES } from "./studio";

export interface InvoicePdfInput {
  orderNumber: string;
  orderName: string;
  invoice: Invoice;
  deposits: InvoiceDeposit[];
}

/** The download filename for an order's invoice PDF. */
export function invoiceFilename(orderNumber: string): string {
  return `AA-Atelier-Invoice-${fileSafe(orderNumber) || "order"}.pdf`;
}

/**
 * Lay out a branded PDF of a custom order's invoice. It renders the same
 * itemized data the on-screen invoice shows (grouped via the shared
 * `groupLineItems`), so the document and the page can't disagree — no pricing
 * logic lives here.
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

/** Build and download a branded PDF of a custom order's invoice. */
export function downloadInvoicePdf(input: InvoicePdfInput) {
  buildInvoiceDoc(input).save(invoiceFilename(input.orderNumber));
}
