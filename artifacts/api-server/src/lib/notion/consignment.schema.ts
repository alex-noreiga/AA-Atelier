// Read-side mapping for the Notion "consignment" database — the finished pieces
// the studio leaves at the skate shop to sell, and what came back.
//
// The app only ever READS this database. A placement is created and settled by
// hand: the atelier delivers a few soakers, the shop sells what it sells, and at
// the next visit the two of them count the shelf and settle up. Nothing here
// writes any of that back.
//
// WHY THIS IS A SEPARATE DATABASE FROM SHOP ORDERS, and so a separate reader.
// A consignment sale is not an order. Nobody knows a piece sold until the
// placement is settled, there is no customer, no email and no Stripe session,
// and the money that arrives is the studio's HALF of a shelf price rather than
// the price itself. Filing these as shop orders would have made every one of
// those facts a lie in a column that already means something else.
//
// Three things about the shape are load-bearing:
//
//  1. **Units are ours to derive; the money is the atelier's formula.** Whether
//     a piece is still on the shelf is arithmetic anyone can do — delivered,
//     less returned, less sold, and nothing once the placement is settled. What
//     the studio is PAID for a sale is a commercial term (currently half of
//     retail) that lives in the `Your Payout` formula and can be renegotiated
//     without anybody telling this code. So the units are computed here and the
//     payout is read, never re-derived from a split rate invented in the app.
//  2. **A formula's value is readable per row even where it can't be filtered
//     on.** Same as the materials database's `Restock Alert` and the production
//     schedule's `Milestone Status`: a `formula: {…}` FILTER on one derived from
//     rollups 400s through the API. Reading the number back off a scanned row is
//     fine, which is what this does — see `.agents/memory/phase2-workspace-cards.md`.
//  3. **An absent number is not a zero.** `Qty Sold` is blank until settlement
//     (its own Notion description says it is "derived at settlement"), so an
//     unsettled placement has genuinely UNKNOWN sales rather than none. Reading
//     it as zero would report the whole shelf as still sitting there.

/** Live-schema property names (a Notion rename is a one-line change here). */
export const CONSIGNMENT_PLACEMENT_PROPERTY = "Placement"; // title
export const CONSIGNMENT_ITEM_PROPERTY = "Item"; // relation -> inventory
export const CONSIGNMENT_DELIVERED_QTY_PROPERTY = "Qty Delivered"; // number
export const CONSIGNMENT_RETURNED_QTY_PROPERTY = "Qty Returned"; // number
export const CONSIGNMENT_SOLD_QTY_PROPERTY = "Qty Sold"; // number
export const CONSIGNMENT_SETTLED_PROPERTY = "Settled"; // checkbox
export const CONSIGNMENT_SETTLED_ON_PROPERTY = "Settled On"; // date
export const CONSIGNMENT_DELIVERED_ON_PROPERTY = "Date Delivered"; // date
export const CONSIGNMENT_RETAIL_PRICE_PROPERTY = "Shop Retail Price"; // number
/** The studio's share of what sold. A formula, and the one number here that is
 * a commercial term rather than arithmetic — read, never re-derived. */
export const CONSIGNMENT_PAYOUT_PROPERTY = "Your Payout"; // formula (number)

/** One consignment placement, as the studio dashboard reads it. */
export interface ConsignmentRecord {
  /** The Notion page id. */
  id: string;
  /** The placement's own title, e.g. "August drop — soakers". */
  placement: string;
  /** The inventory page id of the piece placed. Absent when the row's `Item`
   * relation is empty, which leaves the units countable but nameless. */
  itemId?: string;
  /** Units handed over. `null` when unset — a placement nobody has filled in. */
  delivered: number | null;
  /** Units brought back unsold. `null` until the placement is counted. */
  returned: number | null;
  /** Units the shop sold. `null` until settlement, which is NOT zero (see 3). */
  sold: number | null;
  /** Ticked once the placement has been counted and paid out. */
  settled: boolean;
  /** The visit that closed the placement (`YYYY-MM-DD` or an instant). Empty
   * when unset — including on a settled placement, which then contributes its
   * payout to no month. */
  settledOn: string;
  /** When the pieces were dropped off. Empty when unset. */
  deliveredOn: string;
  /** The shelf price at the shop. `null` when unset. */
  retailPrice: number | null;
  /** The studio's share of what sold, read off the atelier's own formula.
   * `null` when the formula is absent or produced nothing — the units are still
   * reported, the money simply isn't claimed. */
  payout: number | null;
}

// Raw Notion property shapes we read back (only the types we touch).
type NotionReadProperty =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "number"; number: number | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "date"; date: { start: string | null } | null }
  | { type: "relation"; relation: Array<{ id: string }> }
  | { type: "formula"; formula: { number?: number | null } };

export interface NotionConsignmentPage {
  id: string;
  properties: Record<string, NotionReadProperty | undefined>;
}

function readTitle(page: NotionConsignmentPage, name: string): string {
  const prop = page.properties[name];
  if (prop?.type !== "title") return "";
  return prop.title
    .map((part) => part.plain_text)
    .join("")
    .trim();
}

/** A number property, or `null` when unset. Absent is never folded to zero —
 * see decision 3 in the header. */
function readNumber(page: NotionConsignmentPage, name: string): number | null {
  const prop = page.properties[name];
  if (prop?.type !== "number") return null;
  return typeof prop.number === "number" ? prop.number : null;
}

function readCheckbox(page: NotionConsignmentPage, name: string): boolean {
  const prop = page.properties[name];
  return prop?.type === "checkbox" ? prop.checkbox : false;
}

function readDateStart(page: NotionConsignmentPage, name: string): string {
  const prop = page.properties[name];
  if (prop?.type !== "date") return "";
  return (prop.date?.start ?? "").trim();
}

function readFirstRelationId(
  page: NotionConsignmentPage,
  name: string,
): string | undefined {
  const prop = page.properties[name];
  if (prop?.type !== "relation") return undefined;
  // A placement is one piece; if the atelier has related several, the first is
  // the one the quantities on this row are about.
  return prop.relation[0]?.id;
}

/** A formula's numeric result, or `null` when the property is missing, isn't a
 * formula, or produced no number (a text/date result, or an error). */
function readFormulaNumber(
  page: NotionConsignmentPage,
  name: string,
): number | null {
  const prop = page.properties[name];
  if (prop?.type !== "formula") return null;
  const value = prop.formula.number;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Map a scanned Notion page to a {@link ConsignmentRecord}. Pure. */
export function extractConsignment(
  page: NotionConsignmentPage,
): ConsignmentRecord {
  const itemId = readFirstRelationId(page, CONSIGNMENT_ITEM_PROPERTY);
  return {
    id: page.id,
    placement: readTitle(page, CONSIGNMENT_PLACEMENT_PROPERTY),
    ...(itemId ? { itemId } : {}),
    delivered: readNumber(page, CONSIGNMENT_DELIVERED_QTY_PROPERTY),
    returned: readNumber(page, CONSIGNMENT_RETURNED_QTY_PROPERTY),
    sold: readNumber(page, CONSIGNMENT_SOLD_QTY_PROPERTY),
    settled: readCheckbox(page, CONSIGNMENT_SETTLED_PROPERTY),
    settledOn: readDateStart(page, CONSIGNMENT_SETTLED_ON_PROPERTY),
    deliveredOn: readDateStart(page, CONSIGNMENT_DELIVERED_ON_PROPERTY),
    retailPrice: readNumber(page, CONSIGNMENT_RETAIL_PRICE_PROPERTY),
    payout: readFormulaNumber(page, CONSIGNMENT_PAYOUT_PROPERTY),
  };
}
