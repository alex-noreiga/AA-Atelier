// The studio's printed documents — the invoice (and the receipt's layout
// helper) — as ONE implementation shared by the browser and the server.
//
// The customer downloads their invoice from `/invoice/:orderNumber`, where the
// web app lays it out with jsPDF. The atelier wants to see that same document on
// the studio dashboard and to keep a copy on the invoice's Notion page, and the
// only way for "the PDF the customer is shown" to mean exactly that is for the
// server to run the same code — not a second layout that drifts a line at a
// time. jsPDF is isomorphic (it has a Node build), so the layout, the palette,
// the grouping of line items and the studio's own contact line live here, and
// both `artifacts/web-app` and `artifacts/api-server` import them.
//
// Nothing here prices anything. The invoice view (`Invoice` + `InvoiceDeposit`,
// typed against the generated contract) arrives already computed by the server,
// and this package only draws it.
//
// The root export pulls in jsPDF. The pieces the web app needs on EVERY page —
// price/date formatting, the line-item grouping, the studio's contact details —
// are also published as sub-paths (`@workspace/documents/format`,
// `/invoice-format`, `/studio`) that import none of it, so the app's main
// bundle can keep jsPDF code-split behind the download button rather than
// loading half a megabyte of PDF renderer to format a shop price.

export { PdfDocument, fileSafe } from "./document";
export {
  STUDIO_NAME,
  STUDIO_WEBSITE,
  STUDIO_EMAIL,
  STUDIO_LOCATION,
  STUDIO_CONTACT_LINES,
} from "./studio";
export { formatPrice, formatDate } from "./format";
export {
  TYPE_HEADINGS,
  TYPE_ORDER,
  groupLineItems,
  type LineItemGroup,
} from "./invoice-format";
export {
  buildInvoiceDoc,
  invoiceFilename,
  type InvoicePdfInput,
} from "./invoice-pdf";
