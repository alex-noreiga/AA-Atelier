// Notion schema mapping for the optional "Fabrics" database — the atelier-editable
// swatch palette that feeds the custom-order intake form's visual fabric selector.
//
// Each row is one selectable swatch. Its `Type` (select) groups it in the picker
// (solid / print / foil / textured / sequin), its `Placement` (select) decides
// whether it appears in the bodice picker, the skirt picker, or both, a `Hex`
// (text) gives solids their color fill, and a `Swatch` (files) gives image-based
// types their tile. Property-name literals live here so a Notion rename is a
// one-line change, as elsewhere.
//
// Same lesson as the other schema files: property *types* must match the live
// Notion schema, not the name.

export const FABRIC_NAME_PROPERTY = "Name"; // title
export const FABRIC_TYPE_PROPERTY = "Type"; // select
export const FABRIC_PLACEMENT_PROPERTY = "Placement"; // select
export const FABRIC_HEX_PROPERTY = "Hex"; // rich_text (no Notion hex/color type)
export const FABRIC_SWATCH_PROPERTY = "Swatch"; // files
export const FABRIC_SORT_PROPERTY = "Sort"; // number
export const FABRIC_PUBLISH_PROPERTY = "Show on website"; // checkbox
export const FABRIC_COLOR_FAMILY_PROPERTY = "Color Family"; // select (free label)

/** Fabric families, matching the contract `Fabric.type` enum. */
export type FabricType = "solid" | "print" | "foil" | "textured" | "sequin";
/** Where a swatch appears, matching the contract `Fabric.placement` enum. */
export type FabricPlacement = "bodice" | "skirt" | "both";

// Live Notion "Type"/"Placement" select labels → contract enum values. These name
// specific live option values (a targeted business rule, like `STATUS_IN_STOCK`):
// rename an option in Notion and it must change here too, or the row is dropped as
// unrecognized. A swatch whose Type/Placement isn't in these maps is skipped.
const TYPE_MAP: Record<string, FabricType> = {
  Solid: "solid",
  Print: "print",
  Foil: "foil",
  Textured: "textured",
  Sequin: "sequin",
};
const PLACEMENT_MAP: Record<string, FabricPlacement> = {
  Bodice: "bodice",
  Skirt: "skirt",
  Both: "both",
};

/** One fabric swatch row, mapped to the shape the picker cares about. Matches the
 * contract `Fabric` (the service passes it through with only a sort). */
export interface FabricRecord {
  /** Notion page id — becomes `FabricSelection.fabricId` when chosen. */
  id: string;
  name: string;
  type: FabricType;
  placement: FabricPlacement;
  /** Hex color for solids (e.g. "#8A1E2D"); absent for image-based types. */
  hex?: string;
  /** First "Swatch" file URL (a short-lived Notion signed URL); absent for
   * solids and for image types whose photo isn't uploaded yet. */
  swatchImage?: string;
  /** Color-family label for the "group by color family" view (a free select
   * label, shown verbatim — no mapping). Absent when the atelier hasn't set one. */
  colorFamily?: string;
  /** Ordering within a fabric-type group; `null` when unset (sorted last). */
  sort: number | null;
}

// --- Raw Notion payload typing (only the property types we read) ---

interface NotionFileValue {
  type: "file" | "external";
  file?: { url: string };
  external?: { url: string };
}

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "number"; number: number | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "files"; files: NotionFileValue[] };

export interface NotionFabricPage {
  id: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionFabricsQueryResponse {
  results: NotionFabricPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

function extractTitle(page: NotionFabricPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractRichText(page: NotionFabricPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "rich_text") return "";
  return p.rich_text
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractSelect(page: NotionFabricPage, name: string): string | null {
  const p = page.properties[name];
  if (p?.type !== "select") return null;
  return p.select?.name ?? null;
}

function extractNumber(page: NotionFabricPage, name: string): number | null {
  const p = page.properties[name];
  if (p?.type !== "number") return null;
  return p.number;
}

function extractCheckbox(page: NotionFabricPage, name: string): boolean {
  const p = page.properties[name];
  if (p?.type !== "checkbox") return false;
  return p.checkbox;
}

/** The first file URL of a `files` property, or null when none. */
function extractFirstFileUrl(
  page: NotionFabricPage,
  name: string,
): string | null {
  const p = page.properties[name];
  if (p?.type !== "files") return null;
  for (const f of p.files) {
    const url = f.file?.url ?? f.external?.url ?? "";
    if (url.length > 0) return url;
  }
  return null;
}

/** Whether a swatch row's `Show on website` checkbox is ticked. */
export function extractIsPublished(page: NotionFabricPage): boolean {
  return extractCheckbox(page, FABRIC_PUBLISH_PROPERTY);
}

/**
 * Map the "Fabrics" rows into domain records. A row is dropped when its `Name` is
 * blank, or its `Type`/`Placement` select isn't a value we recognize (an
 * unmapped/unset option) — a swatch we can't group or place can't be shown. `hex`
 * and `swatchImage` are omitted when blank so a mis-authored row degrades to a
 * placeholder tile rather than a broken one.
 */
export function extractFabricRecords(
  pages: NotionFabricPage[],
): FabricRecord[] {
  const records: FabricRecord[] = [];
  for (const page of pages) {
    const name = extractTitle(page, FABRIC_NAME_PROPERTY);
    const typeLabel = extractSelect(page, FABRIC_TYPE_PROPERTY);
    const placementLabel = extractSelect(page, FABRIC_PLACEMENT_PROPERTY);
    const type = typeLabel ? TYPE_MAP[typeLabel] : undefined;
    const placement = placementLabel
      ? PLACEMENT_MAP[placementLabel]
      : undefined;
    if (!name || !type || !placement) continue;

    const hex = extractRichText(page, FABRIC_HEX_PROPERTY);
    const swatchImage = extractFirstFileUrl(page, FABRIC_SWATCH_PROPERTY);
    // A free-label select — shown verbatim as the group heading, not mapped.
    const colorFamily = extractSelect(page, FABRIC_COLOR_FAMILY_PROPERTY);
    records.push({
      id: page.id,
      name,
      type,
      placement,
      ...(hex ? { hex } : {}),
      ...(swatchImage ? { swatchImage } : {}),
      ...(colorFamily ? { colorFamily } : {}),
      sort: extractNumber(page, FABRIC_SORT_PROPERTY),
    });
  }
  return records;
}
