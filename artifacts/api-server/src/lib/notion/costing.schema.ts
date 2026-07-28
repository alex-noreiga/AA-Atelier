// Read-side mapping for the atelier's costing system, which the invoice
// line-item generator reads to itemize a custom order (see
// `services/invoice-generator.service.ts`):
//
//   - "costing (custom orders)"  — one costing item per garment/component of an
//     order. Holds the labor + suggested (margin-loaded) price and relates to
//     its material usage lines.
//   - "material usage database"  — one row per material used, with that line's
//     material cost and a Usage Type (Material vs. Packaging).
//
// As everywhere in this adapter, property *types* must match the live Notion
// schema, not the name (see `.agents/memory/notion-status-filters.md`), and the
// name literals live here so a Notion rename is a one-line change. The app never
// writes these databases — it only reads them to build invoice lines.

// --- costing (custom orders) ---
export const COSTING_ITEM_TITLE_PROPERTY = "Item"; // title
export const COSTING_LABOR_COST_PROPERTY = "Labor Cost"; // formula (number)
// The margin-loaded price the invoice total reconciles to. Its formula folds in
// the profit margin (and, for Production rows, selling fees) — the app reads the
// resolved number and does not recompute it. See `.agents/memory/invoice-building.md`.
export const COSTING_SUGGESTED_PRICE_PROPERTY = "Suggested Price"; // formula (number)
export const COSTING_MATERIAL_USAGE_LINES_PROPERTY = "Material Usage Lines"; // relation → material usage

// --- material usage database ---
export const USAGE_TITLE_PROPERTY = "Usage Line"; // title
// "Quantity used multiplied by the selected material unit cost" — a material
// line's own cost, which becomes its invoice line's price (at cost; the margin
// rides the separate reconciling adjustment line).
export const USAGE_LINE_MATERIAL_COST_PROPERTY = "Line Material Cost"; // formula (number)
export const USAGE_TYPE_PROPERTY = "Usage Type"; // select: Material | Packaging

// A targeted business rule naming one option value (like `STATUS_IN_STOCK`): the
// "Packaging" usage type is an internal cost, never itemized on the customer's
// invoice, so the generator skips it. Rename that option in Notion and update it
// here too.
export const USAGE_TYPE_PACKAGING = "Packaging";

/** One costing item as the generator reads it. */
export interface CostingItemRecord {
  pageId: string;
  /** `Labor Cost` formula (dollars); 0 when unset. */
  laborCost: number;
  /** `Suggested Price` formula (dollars) — margin-loaded; 0 when unset. */
  suggestedPrice: number;
  /** Page ids of the linked material usage lines. */
  usageLineIds: string[];
}

/** One material usage line as the generator reads it. */
export interface MaterialUsageLineRecord {
  pageId: string;
  /** The `Usage Line` title, used as the invoice line's name. */
  name: string;
  /** `Line Material Cost` formula (dollars); 0 when unset. */
  materialCost: number;
  /** `Usage Type` select value — "Packaging" lines are skipped by the generator. */
  usageType: string;
}

// --- Raw Notion payload typing (only the property shapes we read) ---

interface NotionNumericValue {
  type: string;
  number?: number | null;
}

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "number"; number: number | null }
  | { type: "formula"; formula: NotionNumericValue }
  | { type: "rollup"; rollup: NotionNumericValue }
  | { type: "relation"; relation: Array<{ id: string }> };

export interface NotionCostingPage {
  id: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionMaterialUsagePage {
  id: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

/** A number-valued property (plain number, formula, or rollup); 0 when absent. */
function extractNumeric(
  page: NotionCostingPage | NotionMaterialUsagePage,
  name: string,
): number {
  const p = page.properties[name];
  if (p?.type === "number") {
    return typeof p.number === "number" ? p.number : 0;
  }
  if (p?.type === "formula") {
    return typeof p.formula.number === "number" ? p.formula.number : 0;
  }
  if (p?.type === "rollup") {
    return typeof p.rollup.number === "number" ? p.rollup.number : 0;
  }
  return 0;
}

function extractRelationIds(
  page: NotionCostingPage | NotionMaterialUsagePage,
  name: string,
): string[] {
  const p = page.properties[name];
  if (p?.type !== "relation") return [];
  return p.relation.map((r) => r.id);
}

function extractTitle(
  page: NotionCostingPage | NotionMaterialUsagePage,
  name: string,
): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractSelectName(
  page: NotionMaterialUsagePage,
  name: string,
): string {
  const p = page.properties[name];
  if (p?.type !== "select") return "";
  return p.select?.name ?? "";
}

/** Map a "costing" page into the record the generator reads. */
export function extractCostingItem(page: NotionCostingPage): CostingItemRecord {
  return {
    pageId: page.id,
    laborCost: extractNumeric(page, COSTING_LABOR_COST_PROPERTY),
    suggestedPrice: extractNumeric(page, COSTING_SUGGESTED_PRICE_PROPERTY),
    usageLineIds: extractRelationIds(
      page,
      COSTING_MATERIAL_USAGE_LINES_PROPERTY,
    ),
  };
}

/** Map a "material usage" page into the record the generator reads. */
export function extractMaterialUsageLine(
  page: NotionMaterialUsagePage,
): MaterialUsageLineRecord {
  return {
    pageId: page.id,
    name: extractTitle(page, USAGE_TITLE_PROPERTY),
    materialCost: extractNumeric(page, USAGE_LINE_MATERIAL_COST_PROPERTY),
    usageType: extractSelectName(page, USAGE_TYPE_PROPERTY),
  };
}
