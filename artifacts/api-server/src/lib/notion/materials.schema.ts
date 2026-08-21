// Read-side mapping for the Notion "materials inventory" database — the
// atelier's fabrics, appliqués, crystals, notions and packaging, with the
// reorder points they set against each one.
//
// The app only ever READS this database. Stock is maintained in Notion by
// intake and usage lines (both rollups feeding a `Stock on Hand` formula), and
// nothing here writes any of it back.
//
// TWO TRAPS LIVE IN THIS SCHEMA — both are why this file exists rather than the
// property names being inlined at the call site:
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

// Live-schema property names (a Notion rename is a one-line change here).
export const MATERIAL_NAME_PROPERTY = "Item Name"; // title
export const MATERIAL_CATEGORY_PROPERTY = "Category"; // select
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
  const link = readUrl(page, MATERIAL_LINK_PROPERTY);
  const pricePerUnit = readNumber(page, MATERIAL_PRICE_PROPERTY);

  return {
    id: page.id,
    name: readTitle(page, MATERIAL_NAME_PROPERTY),
    stockOnHand: readFormulaNumber(page, MATERIAL_STOCK_ON_HAND_PROPERTY),
    minimumStock: readNumber(page, MATERIAL_MINIMUM_STOCK_PROPERTY),
    alertsSuppressed: readCheckbox(page, MATERIAL_ALERTS_SUPPRESSED_PROPERTY),
    ...(category ? { category } : {}),
    ...(link ? { link } : {}),
    ...(pricePerUnit !== null ? { pricePerUnit } : {}),
  };
}
