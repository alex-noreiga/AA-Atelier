import type { CheckoutSessionStatus } from "@workspace/api-client-react";
import { formatPrice } from "@/lib/format";
import { PdfDocument, fileSafe } from "./document";
import { STUDIO_CONTACT_LINES } from "./studio";

/** The download filename for a session's receipt PDF. */
export function receiptFilename(session: CheckoutSessionStatus): string {
  const suffix = session.orderNumber ? `-${fileSafe(session.orderNumber)}` : "";
  return `AA-Atelier-Receipt${suffix}.pdf`;
}

/**
 * Lay out a branded PDF receipt from a completed checkout session. Mirrors the
 * on-screen receipt on the shop-success page and works for both a shop-cart
 * order and a custom-order payment (deposit or balance), whichever
 * `getCheckoutSession` returned — the itemized totals come straight off it.
 */
export function buildReceiptDoc(session: CheckoutSessionStatus): PdfDocument {
  const pdf = new PdfDocument();

  const meta: string[] = [];
  if (session.orderNumber) meta.push(`Order ${session.orderNumber}`);
  meta.push(session.status === "paid" ? "Paid" : session.status || "");

  pdf.masthead("Receipt", meta.filter(Boolean));

  pdf.title(
    "Order confirmed",
    session.email ? `Receipt for ${session.email}` : undefined,
  );

  const lineItems = session.lineItems ?? [];
  if (lineItems.length > 0) {
    pdf.sectionLabel("Items");
    for (const item of lineItems) {
      pdf.row(
        `${item.quantity} × ${item.description}`,
        formatPrice(item.amount),
      );
    }
    pdf.divider();
  }

  pdf.row("Subtotal", formatPrice(session.amountSubtotal ?? 0), {
    muted: true,
  });
  if (session.amountShipping) {
    pdf.row("Shipping", formatPrice(session.amountShipping), { muted: true });
  }
  if (session.amountTax) {
    pdf.row("Tax", formatPrice(session.amountTax), { muted: true });
  }
  pdf.total("Total", formatPrice(session.amountTotal ?? 0));

  pdf.footer([
    "Thank you for your order with A.A Atelier.",
    STUDIO_CONTACT_LINES.join("   ·   "),
  ]);

  return pdf;
}

/** Build and download a branded PDF receipt from a completed checkout session. */
export function downloadReceiptPdf(session: CheckoutSessionStatus) {
  buildReceiptDoc(session).save(receiptFilename(session));
}
