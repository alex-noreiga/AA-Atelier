// Read-side mapping for the Notion "materials inventory" database — the
// atelier's fabrics, appliqués, crystals, notions and packaging, with the
// reorder points they set against each one.
//
// The app only ever READS this database. Stock is maintained in Notion by
// intake and usage lines (both rollups feeding a `Stock on Hand` formula), and
// nothing here writes any of it back.
//
// THREE TRAPS LIVE IN THIS SCHEMA — all of them why this file exists rather
// than the property names being inlined at the call site:
//
//  1. **`Restock Alerts On/Off` is a SUPPRESSION checkbox, not an enable one.**
//     Its name reads like a switch you tick to turn alerts on; its Notion
//     description says the opposite — "Check this to suppress restock alerts for
//     fabrics or materials that do not need restocking". The live data agrees:
//     eight of the nine rows that have a reorder point set are UNticked. So
//     ticked ⇒ the atelier has muted this material, and the constant is named
//     for what it does rather than what it is called.
//  2. **`Stock on Hand` is a formula over two rollups**, so it can be genuinely
//     absent (a material with no intake lines yet). Absent is NOT zero — "we
//     have none" and "we have never recorded any" are different claims, and only
//     one of them is a reason to reorder. It maps to `null` and the service
//     declines to raise an alert on it.
//  3. **`Fabric Type` is a MULTI-select, not a select.** Its Notion description
//     says "use when Category is Fabric", so in practice it is empty on a
//     crystal or a box — but a fabric may legitimately carry several (a power
//     mesh that is also a lining). It maps to an ARRAY, and the dashboard groups
//     a material under the FIRST of them rather than repeating the row under
//     each: a shopping list you might count twice is worse than one where a
//     secondary type is only a label. Nothing here decides that — it just
//     preserves the atelier's own order, which is what they drag in Notion.

// TODO(material-usage): the atelier wants each material to say what it is
// typically USED FOR — "bodice lining", "skirt overlay", "soaker binding" — so
// the reorder list reads as what the studio would be unable to make, not just
// what has run low. That needs a new property on the materials inventory (a
// multi_select would group like `Fabric Type` does; a rich_text would read
// better but can only be a label), then a `usedFor` on the record, the two
// contract schemas, and a line on the dashboard row. Deliberately not guessed
// at here: the property doesn't exist in Notion yet, and reading one that isn't
// there is how a Notion query starts returning nothing useful.

// Live-schema property names (a Notion rename is a one-line change here).
export const MATERIAL_NAME_PROPERTY = "Item Name"; // title
export const MATERIAL_CATEGORY_PROPERTY = "Category"; // select
/** Which fabric it is, when the category is Fabric. MULTI-select: a material can
 * carry more than one (a power-mesh lining is both). See trap 3. */
export const MATERIAL_FABRIC_TYPE_PROPERTY = "Fabric Type"; // multi_select
export const MATERIAL_STOCK_ON_HAND_PROPERTY = "Stock on Hand"; // formula (number)
export const MATERIAL_MINIMUM_STOCK_PROPERTY = "Minimum Stock"; // number
/** Ticked ⇒ alerts SUPPRESSED for this material. See trap 1 above. */
export const MATERIAL_ALERTS_SUPPRESSED_PROPERTY = "Restock Alerts On/Off"; // checkbox
export const MATERIAL_LINK_PROPERTY = "Material Link"; // url
export const MATERIAL_PRICE_PROPERTY = "Price per Unit"; // number

/** One material row, as the dashboard and the digest read it. */
export interface MaterialRecord {
  /** The Notion page id. */
  id: string;
  name: string;
  /** Fabric / Applique / Crystal / Packaging / Notions. Absent when unset. */
  category?: string;
  /** The fabric(s) this is, in the atelier's own order. Absent when none are
   * tagged — which is every non-fabric material. See trap 3. */
  fabricTypes?: string[];
  /** Units remaining. `null` when the formula produced no number — unknown, not zero. */
  stockOnHand: number | null;
  /** The reorder point. `null` when the atelier hasn't set one. */
  minimumStock: number | null;
  /** True when the atelier has muted alerts for this material (see trap 1). */
  alertsSuppressed: boolean;
  /** Where to buy it again, when the atelier recorded a link. */
  link?: string;
  pricePerUnit?: number;
}

// Raw Notion property shapes we read back (only the types we touch).
type NotionReadProperty =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "multi_select"; multi_select: Array<{ name: string }> }
  | { type: "number"; number: number | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "url"; url: string | null }
  | { type: "formula"; formula: { number?: number | null } };

export interface NotionMaterialPage {
  id: string;
  properties: Record<string, NotionReadProperty | undefined>;
}

function readTitle(page: NotionMaterialPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function readSelect(page: NotionMaterialPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "select") return "";
  return p.select?.name ?? "";
}

/** The tagged option names, in the order Notion holds them. Blank names are
 * dropped so a half-deleted option can't produce an empty group. */
function readMultiSelect(page: NotionMaterialPage, name: string): string[] {
  const p = page.properties[name];
  if (p?.type !== "multi_select") return [];
  return p.multi_select.map((option) => option.name.trim()).filter(Boolean);
}

function readNumber(page: NotionMaterialPage, name: string): number | null {
  const p = page.properties[name];
  if (p?.type !== "number") return null;
  return p.number;
}

function readCheckbox(page: NotionMaterialPage, name: string): boolean {
  const p = page.properties[name];
  if (p?.type !== "checkbox") return false;
  return p.checkbox;
}

function readUrl(page: NotionMaterialPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "url") return "";
  return (p.url ?? "").trim();
}

function readFormulaNumber(
  page: NotionMaterialPage,
  name: string,
): number | null {
  const p = page.properties[name];
  if (p?.type !== "formula") return null;
  return typeof p.formula.number === "number" ? p.formula.number : null;
}

/** Map a raw Notion page into a material record. Every field degrades to
 * absent/null rather than throwing, so one odd row can't fail the whole scan. */
export function extractMaterial(page: NotionMaterialPage): MaterialRecord {
  const category = readSelect(page, MATERIAL_CATEGORY_PROPERTY);
  const fabricTypes = readMultiSelect(page, MATERIAL_FABRIC_TYPE_PROPERTY);
  const link = readUrl(page, MATERIAL_LINK_PROPERTY);
  const pricePerUnit = readNumber(page, MATERIAL_PRICE_PROPERTY);

  return {
    id: page.id,
    name: readTitle(page, MATERIAL_NAME_PROPERTY),
    stockOnHand: readFormulaNumber(page, MATERIAL_STOCK_ON_HAND_PROPERTY),
    minimumStock: readNumber(page, MATERIAL_MINIMUM_STOCK_PROPERTY),
    alertsSuppressed: readCheckbox(page, MATERIAL_ALERTS_SUPPRESSED_PROPERTY),
    ...(category ? { category } : {}),
    ...(fabricTypes.length ? { fabricTypes } : {}),
    ...(link ? { link } : {}),
    ...(pricePerUnit !== null ? { pricePerUnit } : {}),
  };
}
