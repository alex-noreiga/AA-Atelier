// Notion schema mapping for the optional "Product Categories" database — the
// data-driven source for which shop categories show a size chart.
//
// Each row is one shop category: its `Name` (title) matches an inventory
// "Item Type" value, and a `Show size guide` checkbox says whether that
// category's cards show the ready-to-wear body-measurement chart. Moving this
// decision into Notion lets the atelier toggle it per category without a
// redeploy — the durable replacement for the frontend's hardcoded
// SIZED_CATEGORIES (see config-audit.ts for the fallback used until this
// database is populated). Property-name literals live here so a Notion rename is
// a one-line change, as elsewhere.

export const CATEGORY_NAME_PROPERTY = "Name"; // title
export const CATEGORY_SHOW_SIZE_GUIDE_PROPERTY = "Show size guide"; // checkbox

// --- Raw Notion payload typing (only the property types we read) ---

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "checkbox"; checkbox: boolean };

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

/**
 * The `Name`s of categories whose `Show size guide` checkbox is ticked. Rows with
 * the box unchecked, or with an empty name, are dropped. The result is the set of
 * category names whose shop cards should show the size chart.
 */
export function extractSizedCategoryNames(
  pages: NotionCategoryPage[],
): string[] {
  return pages
    .filter((page) => extractCheckbox(page, CATEGORY_SHOW_SIZE_GUIDE_PROPERTY))
    .map((page) => extractTitle(page, CATEGORY_NAME_PROPERTY))
    .filter((name) => name.length > 0);
}
