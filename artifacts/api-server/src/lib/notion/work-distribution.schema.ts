// Read-side mapping for the Notion "work distribution" database — who did which
// part of making each item, and whether they have been paid for it.
//
// One row per physical item ("Knight of Midnight Dress"), carrying its sale
// price, how many of it the row covers, the product category it belongs to, and
// five `… by` selects naming who did each stage of the work. The atelier has
// kept this by hand since long before the app existed; nothing here writes to it.
//
// Five decisions shape everything below:
//
//  1. **The roster is DATA, not two names in code.** Notion carries an
//     `Alexandra owed` and an `Alayna owed` formula on this database, and the
//     obvious implementation is to read those two numbers the way the
//     consignment reader reads `Your Payout`. It is rejected here: those
//     property names hardcode the two people who happen to work in the studio
//     today, so a third maker would need two Notion formulas, two new
//     properties AND a code change before the app could see a penny of their
//     pay. Reading the assignee out of each select instead means a name the
//     atelier types is a person the dashboard reports on. What is read rather
//     than invented is the thing that actually is a commercial term — the
//     category's pay splits. See `pay-splits.schema.ts`.
//
//     The cost is a duplicated rule: the owed arithmetic now exists both in
//     those Notion formulas and in `services/production-pay.service.ts`.
//     CHANGE ONE AND CHANGE THE OTHER — the same standing cost as
//     `classifyMaterials` against the `Restock Alert` formula.
//  2. **Settlement is read the same way — by prefix, not by name.** A row is
//     settled per person, with a `Paid Alexandra` / `Paid Alayna` checkbox each.
//     Rather than naming those two, every checkbox called `Paid <something>` is
//     read as that person's settlement marker. A maker with no such property
//     reads as UNPAID, which is the safe direction: the panel can overstate
//     what is still owed, never hide it.
//  3. **`Split` is an assignee, not a person.** It is one of the three options
//     on each of the five selects and means the two of them shared that stage.
//     It is resolved in the service, against the roster, because who "both of
//     us" refers to is a question about the roster rather than about this row.
//     A targeted business rule naming one live option value, like
//     `STATUS_IN_STOCK`: rename it in Notion and this must change too.
//  4. **A blank `Units` is ONE item, not none.** The title property's own
//     description is "One physical item being made", and `Units` says how many
//     matching items a row covers — so a priced row that never had a count
//     typed into it is one piece. Folding it to zero would silently value real
//     work at nothing, which is the one way this panel must not be wrong.
//     Contrast `Sale price`, where blank genuinely IS unknown: there is no
//     sensible default for what a piece sold for, so such a row is reported as
//     needing attention rather than guessed at.
//  5. **The order relation is carried but never followed for money.** `Order`
//     and its `Order Stage` rollup are read so the panel can say which
//     commission a row belongs to and how far along it is. The app does NOT
//     gate pay on the stage: whether work is owed for a half-sewn dress is the
//     atelier's call, recorded by ticking the paid checkbox, and inventing an
//     earned-at-delivery rule here would contradict a table they already keep.

/** Live-schema property names (a Notion rename is a one-line change here). */
export const WORK_ITEM_PROPERTY = "Production item"; // title
export const WORK_PRODUCT_PROPERTY = "Product"; // rich_text
export const WORK_SALE_PRICE_PROPERTY = "Sale price"; // number
export const WORK_UNITS_PROPERTY = "Units"; // number
export const WORK_CATEGORY_PROPERTY = "Category"; // relation -> Category Pay Splits
export const WORK_ORDER_PROPERTY = "Order"; // relation -> Custom Orders
export const WORK_ORDER_STAGE_PROPERTY = "Order Stage"; // rollup (status)
export const WORK_NOTES_PROPERTY = "Notes"; // rich_text

/**
 * The prefix marking a per-person settlement checkbox (`Paid Alexandra`).
 *
 * Read as a prefix rather than as a list of names so the roster stays data —
 * see decision 2 in the header.
 */
export const WORK_PAID_PROPERTY_PREFIX = "Paid ";

/**
 * The five stages of making a piece, and the property naming who did each.
 *
 * The ids are the app's own and are what the contract carries; the `assignedBy`
 * strings are live Notion property names, and `split` names the matching column
 * on the Category Pay Splits database. The three are listed together precisely
 * so a Notion rename is one line rather than a hunt across three files.
 *
 * A targeted business rule in code, like `lib/appointments/catalog.ts`: the
 * stages are the studio's own division of the work and the dashboard renders
 * them, so they are coupled to the app rather than read live.
 */
export const PRODUCTION_STAGES = [
  {
    id: "consult",
    label: "Consult & sketch",
    assignedBy: "Consult & sketch by",
  },
  { id: "sourcing", label: "Sourcing", assignedBy: "Sourcing materials by" },
  {
    id: "cutting",
    label: "Cutting & pinning",
    assignedBy: "Cutting & pinning fabric by",
  },
  { id: "sewing", label: "Sewing", assignedBy: "Sewing by" },
  { id: "detailing", label: "Detailing", assignedBy: "Detailing by" },
] as const;

/** One stage of making a piece. */
export type ProductionStageId = (typeof PRODUCTION_STAGES)[number]["id"];

/**
 * The `… by` value meaning both makers shared the stage.
 *
 * A targeted business rule naming one live Notion option value — rename this
 * option in Notion and it must change here too, or every shared stage silently
 * becomes a person nobody can find and its pay goes unattributed.
 */
export const SPLIT_ASSIGNEE = "Split";

/** One item being made, as the production-pay service reads it. */
export interface WorkDistributionRecord {
  /** The Notion page id. */
  id: string;
  /** The item's own title, e.g. "Knight of Midnight Dress". */
  item: string;
  /** Size / colour / variation, when the atelier noted one. */
  product: string;
  /** What the piece sold for, per item. `null` when unset — genuinely unknown,
   * never folded to zero (see decision 4). */
  salePrice: number | null;
  /** How many matching items the row covers. Blank reads as one. */
  units: number;
  /** The Category Pay Splits page id this row's splits come from. Absent when
   * the `Category` relation is empty, which leaves the row unattributable. */
  categoryId?: string;
  /** The custom order page id, when the row is part of a commission. */
  orderId?: string;
  /** The order's current stage, read through the rollup. Empty for a row with
   * no order (a shop piece) or an order with no stage set. Reported, never
   * used to decide whether pay is owed — see decision 5. */
  orderStage: string;
  /** Who did each stage. A value is a person's name, {@link SPLIT_ASSIGNEE}, or
   * empty where the atelier hasn't recorded it yet. */
  assignees: Record<ProductionStageId, string>;
  /** Whose settlement checkbox is ticked, keyed by the name after
   * `Paid `. A name absent from this map reads as unpaid. */
  paid: Record<string, boolean>;
  /** The atelier's own note on the row — production, fit, material or pay. */
  notes: string;
}

// Raw Notion property shapes we read back (only the types we touch).
type NotionReadProperty =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "number"; number: number | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "select"; select: { name: string } | null }
  | { type: "relation"; relation: Array<{ id: string }> }
  | {
      type: "rollup";
      rollup: {
        type?: string;
        array?: Array<{ status?: { name?: string } | null }>;
        status?: { name?: string } | null;
      };
    };

export interface NotionWorkDistributionPage {
  id: string;
  properties: Record<string, NotionReadProperty | undefined>;
}

function readTitle(page: NotionWorkDistributionPage, name: string): string {
  const prop = page.properties[name];
  if (prop?.type !== "title") return "";
  return prop.title
    .map((part) => part.plain_text)
    .join("")
    .trim();
}

function readText(page: NotionWorkDistributionPage, name: string): string {
  const prop = page.properties[name];
  if (prop?.type !== "rich_text") return "";
  return prop.rich_text
    .map((part) => part.plain_text)
    .join("")
    .trim();
}

/** A number property, or `null` when unset. */
function readNumber(
  page: NotionWorkDistributionPage,
  name: string,
): number | null {
  const prop = page.properties[name];
  if (prop?.type !== "number") return null;
  return typeof prop.number === "number" && Number.isFinite(prop.number)
    ? prop.number
    : null;
}

function readSelect(page: NotionWorkDistributionPage, name: string): string {
  const prop = page.properties[name];
  if (prop?.type !== "select") return "";
  return (prop.select?.name ?? "").trim();
}

function readFirstRelationId(
  page: NotionWorkDistributionPage,
  name: string,
): string | undefined {
  const prop = page.properties[name];
  if (prop?.type !== "relation") return undefined;
  // Both relations are limit-1 in Notion; the first is the answer either way.
  return prop.relation[0]?.id;
}

/**
 * The order's stage, read through the `Order Stage` rollup.
 *
 * A rollup over a relation answers as an ARRAY of the related rows' values even
 * when the relation holds one row, so both shapes are accepted — the array form
 * is what Notion actually sends, and the bare form is cheap insurance against a
 * rollup the atelier reconfigures to `show_original`.
 */
function readRollupStatus(
  page: NotionWorkDistributionPage,
  name: string,
): string {
  const prop = page.properties[name];
  if (prop?.type !== "rollup") return "";
  const direct = prop.rollup.status?.name;
  if (direct) return direct.trim();
  for (const entry of prop.rollup.array ?? []) {
    const value = entry?.status?.name;
    if (value) return value.trim();
  }
  return "";
}

/**
 * Every `Paid <name>` checkbox on the row, keyed by the name.
 *
 * Read by prefix so settlement covers whoever the atelier has a column for,
 * rather than the two people this was written next to (decision 2).
 */
function readPaidMarkers(
  page: NotionWorkDistributionPage,
): Record<string, boolean> {
  const paid: Record<string, boolean> = {};
  for (const [property, value] of Object.entries(page.properties)) {
    if (!property.startsWith(WORK_PAID_PROPERTY_PREFIX)) continue;
    if (value?.type !== "checkbox") continue;
    const name = property.slice(WORK_PAID_PROPERTY_PREFIX.length).trim();
    if (name) paid[name] = value.checkbox;
  }
  return paid;
}

/**
 * How many items this row covers.
 *
 * Blank, zero and negative all read as one piece — the row itself is an item,
 * and a count nobody typed must not value real work at nothing (decision 4).
 */
function readUnits(page: NotionWorkDistributionPage): number {
  const units = readNumber(page, WORK_UNITS_PROPERTY);
  if (units === null || units < 1) return 1;
  return Math.floor(units);
}

/** Map a scanned Notion page to a {@link WorkDistributionRecord}. Pure. */
export function extractWorkDistribution(
  page: NotionWorkDistributionPage,
): WorkDistributionRecord {
  const categoryId = readFirstRelationId(page, WORK_CATEGORY_PROPERTY);
  const orderId = readFirstRelationId(page, WORK_ORDER_PROPERTY);

  const assignees = {} as Record<ProductionStageId, string>;
  for (const stage of PRODUCTION_STAGES) {
    assignees[stage.id] = readSelect(page, stage.assignedBy);
  }

  return {
    id: page.id,
    item: readTitle(page, WORK_ITEM_PROPERTY),
    product: readText(page, WORK_PRODUCT_PROPERTY),
    salePrice: readNumber(page, WORK_SALE_PRICE_PROPERTY),
    units: readUnits(page),
    ...(categoryId ? { categoryId } : {}),
    ...(orderId ? { orderId } : {}),
    orderStage: readRollupStatus(page, WORK_ORDER_STAGE_PROPERTY),
    assignees,
    paid: readPaidMarkers(page),
    notes: readText(page, WORK_NOTES_PROPERTY),
  };
}

/**
 * The makers named by the five `… by` select options on the live database
 * schema, {@link SPLIT_ASSIGNEE} removed.
 *
 * Read from the schema rather than from the rows so a maker who has not been
 * assigned anything yet still appears — at nought, which is a true and useful
 * thing for the panel to say. Shaped to take the `properties` map of a
 * `GET /v1/databases/{id}` response.
 */
export function extractMakerRoster(
  properties: Record<
    string,
    | { type?: string; select?: { options?: Array<{ name?: string }> } }
    | undefined
  >,
): string[] {
  const seen = new Set<string>();
  for (const stage of PRODUCTION_STAGES) {
    const prop = properties[stage.assignedBy];
    if (prop?.type !== "select") continue;
    for (const option of prop.select?.options ?? []) {
      const name = (option?.name ?? "").trim();
      if (!name || name === SPLIT_ASSIGNEE) continue;
      seen.add(name);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
