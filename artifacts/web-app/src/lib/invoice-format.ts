// How an invoice's line items are grouped and headed on screen. The rule lives
// in `@workspace/documents` — the on-screen invoice (`pages/invoice.tsx`) and
// the PDF (browser download and the server-rendered copy alike) all read it from
// there, so no two renderings can group or order the lines differently. This
// module keeps the `@/lib/invoice-format` import working for the page.
export {
  TYPE_HEADINGS,
  TYPE_ORDER,
  groupLineItems,
  type LineItemGroup,
} from "@workspace/documents/invoice-format";
