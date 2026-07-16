// Notion schema mapping for the "Portfolio" database that feeds the public
// gallery of past custom work.
//
// Same lessons as `products.schema.ts`: property *types* must match the live
// Notion schema, not the name. The property-name literals live here so a Notion
// rename is a one-line change. Each row is one gallery item — a past commission
// with one or more photos, an optional caption, and an optional category.

const PORTFOLIO_TITLE_PROPERTY = "Title"; // title
const PORTFOLIO_CATEGORY_PROPERTY = "Category"; // select
const PORTFOLIO_CAPTION_PROPERTY = "Caption"; // rich_text
const PORTFOLIO_PHOTOS_PROPERTY = "Website Photos"; // files
export const PORTFOLIO_PUBLISH_PROPERTY = "Show on website"; // checkbox

/** A single portfolio row, mapped to the shape the gallery cares about. */
export interface PortfolioItemRecord {
  id: string;
  title: string;
  photos: string[];
  category?: string;
  caption?: string;
}

// --- Raw Notion payload typing (only the property types we read) ---

interface NotionFileValue {
  type: "file" | "external";
  name?: string;
  file?: { url: string };
  external?: { url: string };
}

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "files"; files: NotionFileValue[] };

export interface NotionPortfolioPage {
  id: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionPortfolioQueryResponse {
  results: NotionPortfolioPage[];
  has_more: boolean;
  next_cursor: string | null;
}

/** The database schema, as returned by `GET /v1/databases/{id}`. */
export interface NotionPortfolioDatabaseSchema {
  properties: Record<
    string,
    {
      type: string;
      select?: { options: Array<{ name: string }> };
    }
  >;
}

/**
 * The gallery's category list — the live "Category" select options, in the
 * order the atelier arranged them in Notion. Never hardcode this list (same
 * rule as the shop's "Item Type"). Empty when the property doesn't exist.
 */
export function extractCategoryOptions(
  schema: NotionPortfolioDatabaseSchema,
): string[] {
  return (
    schema.properties[PORTFOLIO_CATEGORY_PROPERTY]?.select?.options.map(
      (option) => option.name,
    ) ?? []
  );
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

function extractTitle(page: NotionPortfolioPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractRichText(page: NotionPortfolioPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "rich_text") return "";
  return p.rich_text
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractSelect(page: NotionPortfolioPage, name: string): string | null {
  const p = page.properties[name];
  if (p?.type !== "select") return null;
  return p.select?.name ?? null;
}

function extractCheckbox(page: NotionPortfolioPage, name: string): boolean {
  const p = page.properties[name];
  if (p?.type !== "checkbox") return false;
  return p.checkbox;
}

function extractFiles(page: NotionPortfolioPage, name: string): string[] {
  const p = page.properties[name];
  if (p?.type !== "files") return [];
  return p.files
    .map((f) => f.file?.url ?? f.external?.url ?? "")
    .filter((url) => url.length > 0);
}

/** Whether a row's Publish checkbox is checked. */
export function extractIsPublished(page: NotionPortfolioPage): boolean {
  return extractCheckbox(page, PORTFOLIO_PUBLISH_PROPERTY);
}

/** Map a raw portfolio page into a domain record. */
export function extractPortfolioItem(
  page: NotionPortfolioPage,
): PortfolioItemRecord {
  const category = extractSelect(page, PORTFOLIO_CATEGORY_PROPERTY);
  const caption = extractRichText(page, PORTFOLIO_CAPTION_PROPERTY);

  return {
    id: page.id,
    title: extractTitle(page, PORTFOLIO_TITLE_PROPERTY),
    photos: extractFiles(page, PORTFOLIO_PHOTOS_PROPERTY),
    ...(category ? { category } : {}),
    ...(caption ? { caption } : {}),
  };
}
