// Notion schema mapping for the "Product Categories" database — the data-driven
// source of the shop's category list, ordering, and per-category size-guide flag.
//
// Each row is one shop category. Its `Name` (title) is the category label, a
// `Show size guide` checkbox says whether that category's cards show the ready-to-
// wear body-measurement chart, and an optional `Sort` (number) orders the shop's
// filter chips. Inventory rows point at a category via a `Category` relation (see
// products.schema.ts), so the category a product belongs to — and whether it's
// sized — follows the linked page, not a name string: renaming a category in
// Notion propagates automatically with no redeploy. Property-name literals live
// here so a Notion rename is a one-line change, as elsewhere.

export const CATEGORY_NAME_PROPERTY = "Name"; // title
export const CATEGORY_SHOW_SIZE_GUIDE_PROPERTY = "Show size guide"; // checkbox
export const CATEGORY_SORT_PROPERTY = "Sort"; // number — shop chip ordering

/** One shop category row, mapped to the shape the shop cares about. */
export interface CategoryRecord {
  /** Notion page id — the join key for an inventory row's `Category` relation. */
  id: string;
  /** Category label (the shop's chip + card category). */
  name: string;
  /** Whether this category's cards show the ready-to-wear size chart. */
  sized: boolean;
  /** Chip ordering; `null` when unset (sorted last, after the numbered rows). */
  sort: number | null;
}

// --- Raw Notion payload typing (only the property types we read) ---

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "number"; number: number | null };

export interface NotionCategoryPage {
  id: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionCategoriesQueryResponse {
  results: NotionCategoryPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

function extractTitle(page: NotionCategoryPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractCheckbox(page: NotionCategoryPage, name: string): boolean {
  const p = page.properties[name];
  if (p?.type !== "checkbox") return false;
  return p.checkbox;
}

function extractNumber(page: NotionCategoryPage, name: string): number | null {
  const p = page.properties[name];
  if (p?.type !== "number") return null;
  return p.number;
}

/**
 * Map the "Product Categories" rows into domain records — id, name, sized flag,
 * and sort order. Rows with an empty `Name` are dropped (a blank category can't
 * be matched or shown). The `id` is the page id an inventory row's `Category`
 * relation points at, so the caller can join a product to its category.
 */
export function extractCategoryRecords(
  pages: NotionCategoryPage[],
): CategoryRecord[] {
  return pages
    .map((page) => ({
      id: page.id,
      name: extractTitle(page, CATEGORY_NAME_PROPERTY),
      sized: extractCheckbox(page, CATEGORY_SHOW_SIZE_GUIDE_PROPERTY),
      sort: extractNumber(page, CATEGORY_SORT_PROPERTY),
    }))
    .filter((record) => record.name.length > 0);
}
