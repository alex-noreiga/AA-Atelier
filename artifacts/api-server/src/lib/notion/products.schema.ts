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
const PRODUCT_CATEGORY_RELATION_PROPERTY = "Category"; // relation → Product Categories
const PRODUCT_PRICE_PROPERTY = "Listed Price"; // number
const PRODUCT_STATUS_PROPERTY = "Status"; // status
const PRODUCT_QTY_AVAILABLE_PROPERTY = "Quantity Available"; // formula (number)
const PRODUCT_NOTES_PROPERTY = "Listing Notes"; // rich_text — the shop card's description
export const PRODUCT_PUBLISH_PROPERTY = "Show on website"; // checkbox
const PRODUCT_PHOTOS_PROPERTY = "Website Photos"; // files
const PRODUCT_GROUP_PROPERTY = "Website Group"; // select
const PRODUCT_SIZES_AVAILABLE_PROPERTY = "Sizes Available"; // multi_select
const PRODUCT_SIZES_OFFERED_PROPERTY = "Sizes Offered"; // multi_select
const PRODUCT_ADDONS_RELATION_PROPERTY = "Matching Add-ons"; // relation → inventory (self)

// The single status value that counts as sellable. This is an intentional,
// targeted business rule (not a hardcoded copy of the full option list, which
// the atelier edits live) — a row must be "In Stock" to be marked available.
// Exported so the config-drift check (config-audit.ts) can verify it still
// exists among the live Status options.
export const STATUS_IN_STOCK = "In Stock";

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
  /** Ids of inventory rows offered as matching add-ons for this variant (the
   * `Matching Add-ons` self-relation) — e.g. a soaker points at its blade towel.
   * Empty when the row has no add-ons. */
  addOnIds: string[];
  /** The card's category name. Resolved from the `Category` relation in the
   * service layer (products.service) by joining `categoryId` to a category record;
   * the raw inventory row carries only the relation id, so this is `""` here until
   * resolved (and stays `""` for a row that isn't linked to a category). */
  category: string;
  /** The linked Product Categories page id from the `Category` relation, or absent
   * when the row isn't related. The service joins this to a category record for the
   * authoritative name + sized flag. */
  categoryId?: string;
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
  /** Ids of other variants offered as matching add-ons (see VariantRecord).
   * Each id is the `id` of a ProductVariant elsewhere in the same product list,
   * so the client resolves the add-on locally. Absent when there are none. */
  addOnIds?: string[];
}

/** A shop card: one or more variants sharing a group. */
export interface ProductRecord {
  id: string;
  title: string;
  category: string;
  /** Whether this card's category shows a size guide. Computed server-side (see
   * products.service) from the live "Product Categories" data — the client never
   * decides this. A soaker category is always sized (its blade chart implies it). */
  sized: boolean;
  /** Which size chart this card uses — the ready-to-wear body-measurement chart
   * ("garment") or the skate-soaker blade-length chart ("soaker"). Omitted for
   * garments (the client treats absent as "garment"); only meaningful when
   * `sized`. Resolved from the category's "Size Guide Type", not the name. */
  sizeGuide?: "garment" | "soaker";
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
  | { type: "relation"; relation: Array<{ id: string }> }
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

/** The first related page id of a relation property, or null when unrelated. */
function extractRelationFirstId(
  page: NotionInventoryPage,
  name: string,
): string | null {
  const p = page.properties[name];
  if (p?.type !== "relation") return null;
  return p.relation[0]?.id ?? null;
}

/** All related page ids of a relation property, in Notion order. */
function extractRelationIds(page: NotionInventoryPage, name: string): string[] {
  const p = page.properties[name];
  if (p?.type !== "relation") return [];
  return p.relation.map((r) => r.id);
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
  const categoryId = extractRelationFirstId(
    page,
    PRODUCT_CATEGORY_RELATION_PROPERTY,
  );

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
    addOnIds: extractRelationIds(page, PRODUCT_ADDONS_RELATION_PROPERTY),
    // The category NAME is resolved from the relation in the service; the raw row
    // carries only its id (below). Empty here, and for a row with no link.
    category: "",
    ...(categoryId ? { categoryId } : {}),
    group: extractSelect(page, PRODUCT_GROUP_PROPERTY),
  };
}
