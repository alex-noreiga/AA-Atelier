// Notion schema mapping for the finished-goods "inventory" database that feeds
// the shop's ready-to-ship section.
//
// Same lessons as `schema.ts` apply: property *types* must match the live Notion
// schema, not the name (verified against a sample page). The property-name
// literals live here so a Notion rename is a one-line change.
//
// Each inventory row is a product *variant* (e.g. one soaker style). Rows that
// share a `Website Group` value are grouped into a single shop card by the
// service layer; each row becomes a selectable variant.

const PRODUCT_NAME_PROPERTY = "Item Name"; // title
const PRODUCT_TYPE_PROPERTY = "Item Type"; // select
const PRODUCT_PRICE_PROPERTY = "Listed Price"; // number
const PRODUCT_STATUS_PROPERTY = "Status"; // status
const PRODUCT_QTY_AVAILABLE_PROPERTY = "Quantity Available"; // formula (number)
const PRODUCT_NOTES_PROPERTY = "Listing Notes"; // rich_text — the shop card's description
export const PRODUCT_PUBLISH_PROPERTY = "Show on website"; // checkbox
const PRODUCT_PHOTOS_PROPERTY = "Website Photos"; // files
const PRODUCT_GROUP_PROPERTY = "Website Group"; // select
const PRODUCT_SIZES_AVAILABLE_PROPERTY = "Sizes Available"; // multi_select
const PRODUCT_SIZES_OFFERED_PROPERTY = "Sizes Offered"; // multi_select

// The single status value that counts as sellable. This is an intentional,
// targeted business rule (not a hardcoded copy of the full option list, which
// the atelier edits live) — a row must be "In Stock" to be marked available.
const STATUS_IN_STOCK = "In Stock";

/** One size band the item is offered in, and whether it's currently in stock. */
interface SizeOptionRecord {
  name: string;
  available: boolean;
}

/** A single inventory row, mapped to the shape the shop cares about. */
export interface VariantRecord {
  id: string;
  name: string;
  available: boolean;
  price?: number;
  description?: string;
  photos: string[];
  sizes: SizeOptionRecord[];
  quantityAvailable?: number;
  /** Item Type — used as the card category. */
  category: string;
  /** Website Group value, or null when the row stands alone. */
  group: string | null;
}

/** One variant as exposed to the client (no grouping internals). */
export interface ProductVariantRecord {
  id: string;
  name: string;
  available: boolean;
  price?: number;
  description?: string;
  photos: string[];
  sizes: SizeOptionRecord[];
  quantityAvailable?: number;
}

/** A shop card: one or more variants sharing a group. */
export interface ProductRecord {
  id: string;
  title: string;
  category: string;
  variants: ProductVariantRecord[];
}

// --- Raw Notion payload typing (only the property types we read) ---

interface NotionFileValue {
  type: "file" | "external";
  name?: string;
  file?: { url: string };
  external?: { url: string };
}

interface NotionFormulaValue {
  type: string;
  number?: number | null;
  string?: string | null;
  boolean?: boolean | null;
}

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "multi_select"; multi_select: Array<{ name: string }> }
  | { type: "status"; status: { name: string } | null }
  | { type: "number"; number: number | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "formula"; formula: NotionFormulaValue }
  | { type: "files"; files: NotionFileValue[] };

export interface NotionInventoryPage {
  id: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionInventoryQueryResponse {
  results: NotionInventoryPage[];
  has_more: boolean;
  next_cursor: string | null;
}

/** The database schema, as returned by `GET /v1/databases/{id}`. */
export interface NotionInventoryDatabaseSchema {
  properties: Record<
    string,
    {
      type: string;
      select?: { options: Array<{ name: string }> };
    }
  >;
}

/**
 * The shop's category list — the live "Item Type" select options, in the order
 * the atelier arranged them in Notion. Never hardcode this list: the team edits
 * the options directly and expects the shop's filters to follow without a
 * redeploy (the same rule as the order "Stage" options, see `schema.ts`).
 */
export function extractCategoryOptions(
  schema: NotionInventoryDatabaseSchema,
): string[] {
  return (
    schema.properties[PRODUCT_TYPE_PROPERTY]?.select?.options.map(
      (option) => option.name,
    ) ?? []
  );
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

function extractTitle(page: NotionInventoryPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractRichText(page: NotionInventoryPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "rich_text") return "";
  return p.rich_text
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractSelect(page: NotionInventoryPage, name: string): string | null {
  const p = page.properties[name];
  if (p?.type !== "select") return null;
  return p.select?.name ?? null;
}

function extractStatus(page: NotionInventoryPage, name: string): string | null {
  const p = page.properties[name];
  if (p?.type !== "status") return null;
  return p.status?.name ?? null;
}

function extractNumber(page: NotionInventoryPage, name: string): number | null {
  const p = page.properties[name];
  if (p?.type !== "number") return null;
  return p.number;
}

function extractCheckbox(page: NotionInventoryPage, name: string): boolean {
  const p = page.properties[name];
  if (p?.type !== "checkbox") return false;
  return p.checkbox;
}

function extractFormulaNumber(
  page: NotionInventoryPage,
  name: string,
): number | null {
  const p = page.properties[name];
  if (p?.type !== "formula") return null;
  return typeof p.formula.number === "number" ? p.formula.number : null;
}

function extractMultiSelect(page: NotionInventoryPage, name: string): string[] {
  const p = page.properties[name];
  if (p?.type !== "multi_select") return [];
  return p.multi_select.map((option) => option.name);
}

function extractFiles(page: NotionInventoryPage, name: string): string[] {
  const p = page.properties[name];
  if (p?.type !== "files") return [];
  return p.files
    .map((f) => f.file?.url ?? f.external?.url ?? "")
    .filter((url) => url.length > 0);
}

/** Whether a row's Publish checkbox is checked. */
export function extractIsPublished(page: NotionInventoryPage): boolean {
  return extractCheckbox(page, PRODUCT_PUBLISH_PROPERTY);
}

/**
 * A row is available only when its status is "In Stock" and it isn't at zero
 * quantity. A null quantity (common for one-off items) is treated as available.
 */
function computeVariantAvailability(
  status: string | null,
  quantityAvailable: number | null,
): boolean {
  if (status !== STATUS_IN_STOCK) return false;
  if (quantityAvailable === null) return true;
  return quantityAvailable > 0;
}

/**
 * The size bands to show on a card: everything in "Sizes Offered", each flagged
 * with whether it's also in "Sizes Available" (i.e. in stock). Offered-but-not-
 * available means sold out, which is what lets the shop offer a per-size
 * back-in-stock request.
 *
 * A size marked available but never offered is still shown (available) rather
 * than dropped — the team ticking only "Sizes Available" is the likely slip, and
 * silently hiding a size we *do* have in stock is the worse failure.
 */
export function computeSizeOptions(
  offered: string[],
  available: string[],
): SizeOptionRecord[] {
  const inStock = new Set(available);
  const bands = [...offered];
  for (const size of available) {
    if (!offered.includes(size)) bands.push(size);
  }
  return bands.map((name) => ({ name, available: inStock.has(name) }));
}

/** Map a raw inventory page into a domain variant record. */
export function extractVariant(page: NotionInventoryPage): VariantRecord {
  const status = extractStatus(page, PRODUCT_STATUS_PROPERTY);
  const quantityAvailable = extractFormulaNumber(
    page,
    PRODUCT_QTY_AVAILABLE_PROPERTY,
  );
  const price = extractNumber(page, PRODUCT_PRICE_PROPERTY);
  const description = extractRichText(page, PRODUCT_NOTES_PROPERTY);

  return {
    id: page.id,
    name: extractTitle(page, PRODUCT_NAME_PROPERTY),
    available: computeVariantAvailability(status, quantityAvailable),
    ...(price !== null ? { price } : {}),
    ...(description ? { description } : {}),
    photos: extractFiles(page, PRODUCT_PHOTOS_PROPERTY),
    sizes: computeSizeOptions(
      extractMultiSelect(page, PRODUCT_SIZES_OFFERED_PROPERTY),
      extractMultiSelect(page, PRODUCT_SIZES_AVAILABLE_PROPERTY),
    ),
    ...(quantityAvailable !== null ? { quantityAvailable } : {}),
    category: extractSelect(page, PRODUCT_TYPE_PROPERTY) ?? "",
    group: extractSelect(page, PRODUCT_GROUP_PROPERTY),
  };
}
