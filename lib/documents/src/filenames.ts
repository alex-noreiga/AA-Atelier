import { fileSafe } from "./file-safe";

/** The download filename for an order's invoice PDF. */
export function invoiceFilename(orderNumber: string): string {
  return `AA-Atelier-Invoice-${fileSafe(orderNumber) || "order"}.pdf`;
}
