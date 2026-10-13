// Price and date formatting, shared with the printed documents. The two live in
// `@workspace/documents` so the on-screen invoice, the customer's PDF download
// and the server-rendered copy of the same PDF all format a figure identically;
// re-exported here so the rest of the app keeps importing them from `@/lib`.
export { formatPrice, formatDate } from "@workspace/documents/format";
