// The customer's invoice download. The document itself is laid out by
// `@workspace/documents` — shared with the server, which renders the identical
// PDF for the studio dashboard and for the copy it keeps on the invoice's
// Notion page — so this module only adds the browser half: the download.
import {
  buildInvoiceDoc,
  invoiceFilename,
  type InvoicePdfInput,
} from "@workspace/documents";

export { buildInvoiceDoc, invoiceFilename, type InvoicePdfInput };

/** Build and download a branded PDF of a custom order's invoice. */
export function downloadInvoicePdf(input: InvoicePdfInput) {
  buildInvoiceDoc(input).save(invoiceFilename(input.orderNumber));
}
