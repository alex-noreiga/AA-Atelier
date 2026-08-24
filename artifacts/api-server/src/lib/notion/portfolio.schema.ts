// Notion schema mapping for the READ side of the "Design Portfolio & Sketch
// Library" database — the finished costumes, preliminary sketches and digital
// mockups the public gallery shows.
//
// The app never writes this database. The atelier keeps it as its own working
// record of every design, so the gallery is a *projection* of that record, not
// a second copy of it: the row is authored in Notion, and one checkbox decides
// whether it is also shown to the world.
//
// Two things here are load-bearing:
//
//   * **Publication fails closed.** `Show on website` is the single gate, and an
//     absent property, an unticked box, or a row with no image all read as "not
//     published". The database is the atelier's private sketchbook first — it
//     holds work-in-progress and pieces made for named customers — so the safe
//     direction is emphatically "shows nothing", never "publishes something the
//     atelier hadn't chosen". This mirrors the shop's `Show on website` gate
//     (same property name, deliberately, so the atelier learns one convention),
//     not the reviews' two-gate curation: these are photographs of the
//     atelier's own work, and the decision to show one is theirs alone.
//
//   * **The facet DIMENSIONS are code; the facet OPTIONS are not.** Which
//     questions the gallery can be filtered by (type, discipline, colorway,
//     competition) is a product decision that has to be mirrored in the UI, so
//     it lives in {@link FACET_DEFINITIONS} — the same "targeted business rule"
//     exception as the appointment catalog. What the answers *are* is read live
//     off the published rows, so the atelier adds a discipline by typing it on a
//     piece, never by asking for a deploy. Never hardcode an option list here.

/** The row's name, and the gallery card's caption. */
const PORTFOLIO_TITLE_PROPERTY = "Name"; // title
/** The photographs / sketches themselves. */
const PORTFOLIO_IMAGES_PROPERTY = "Image / Sketch"; // files
/**
 * The single publication gate. Named to match the shop inventory's own
 * `Show on website` checkbox — one convention across both public catalogues.
 * Additive: until the atelier adds it, no row reads as published and the
 * gallery is empty, which is the correct direction for a database that
 * predates the gallery by a year.
 */
export const PORTFOLIO_PUBLISH_PROPERTY = "Show on website"; // checkbox

/**
 * A filter dimension offered above the gallery.
 *
 * `property` names a Notion property that may be a **select or a
 * multi_select** — see {@link extractFacetValues}. `Type` already exists on the
 * database; the other three are additive, and a dimension whose property the
 * atelier hasn't added simply never yields a value, so it is omitted from the
 * response rather than rendering an empty chip group.
 */
export interface FacetDefinition {
  /** Stable id on the wire. Renaming one is a breaking change for a shared URL. */
  id: string;
  /** The chip group's heading, as the visitor reads it. */
  label: string;
  /** The Notion property it is read from. */
  property: string;
}

export const FACET_DEFINITIONS: readonly FacetDefinition[] = [
  { id: "type", label: "Type", property: "Type" },
  { id: "discipline", label: "Discipline", property: "Discipline" },
  { id: "colorway", label: "Colorway", property: "Colorway" },
  { id: "competition", label: "Competition", property: "Competition" },
] as const;

/** One piece's values for a single dimension. Never present when empty. */
export interface PortfolioFacetRecord {
  id: string;
  values: string[];
}

/** One published piece, mapped to exactly what the gallery renders. */
export interface PortfolioPieceRecord {
  /** Notion page id — a render key only; never used to look anything up. */
  id: string;
  title: string;
  /** Cover first. Never empty: a row with no image isn't published. */
  images: string[];
  facets: PortfolioFacetRecord[];
  /** The row's Notion `created_time`, ISO-8601. Absent when Notion didn't
   * return one — the contract makes it optional, and an empty string would
   * fail the response's date-time parse. */
  publishedAt?: string;
}

/** A chip group, with its options derived from the published pieces. */
export interface PortfolioFilterRecord {
  id: string;
  label: string;
  options: string[];
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
  | { type: "multi_select"; multi_select: Array<{ name: string }> }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "files"; files: NotionFileValue[] };

export interface NotionPortfolioPage {
  id: string;
  created_time?: string;
  properties: Record<string, NotionPropertyValue | undefined>;
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

function extractCheckbox(page: NotionPortfolioPage, name: string): boolean {
  const p = page.properties[name];
  if (p?.type !== "checkbox") return false;
  return p.checkbox;
}

/**
 * A files property's URLs, in the order the atelier arranged them.
 *
 * Accepts an uploaded file **and** a pasted external link, exactly as the shop's
 * product photos do: the URL is handed to the visitor's browser to load, so an
 * external one is the atelier's own choice and costs nothing. (The studio-guides
 * reader deliberately refuses external URLs — but there the *server* fetches
 * what it is given, which is a different question entirely.)
 *
 * A Notion-hosted URL is signed and expires in about an hour, which is why
 * nothing downstream stores one and the route's edge cache is far shorter.
 */
function extractFiles(page: NotionPortfolioPage, name: string): string[] {
  const p = page.properties[name];
  if (p?.type !== "files") return [];
  return p.files
    .map((f) => f.file?.url ?? f.external?.url ?? "")
    .filter((url) => url.length > 0);
}

/**
 * One dimension's values off a page, tolerating either single- or multi-select.
 *
 * The tolerance is deliberate rather than defensive. Three of the four facet
 * properties don't exist yet — the atelier creates them — and a reader that
 * insisted on `multi_select` would answer a `select` named `Discipline` with
 * silence: no error, no log, just a chip group that never appears. That is the
 * exact failure this codebase keeps designing against, and a facet value is the
 * same string whichever way the property was created, so there is nothing to
 * get wrong by accepting both. A rich_text is read too, for the atelier who
 * types a competition name rather than picking one.
 *
 * Values are trimmed and de-duplicated; blanks are dropped, so a half-filled
 * property yields no facet rather than an empty chip.
 */
export function extractFacetValues(
  page: NotionPortfolioPage,
  property: string,
): string[] {
  const p = page.properties[property];
  const raw: string[] =
    p?.type === "multi_select"
      ? p.multi_select.map((o) => o.name)
      : p?.type === "select"
        ? [p.select?.name ?? ""]
        : p?.type === "rich_text"
          ? [p.rich_text.map((t) => t.plain_text).join("")]
          : [];

  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of raw) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    values.push(trimmed);
  }
  return values;
}

/**
 * Whether a row may be shown publicly.
 *
 * Two conditions, both failing closed: the atelier ticked `Show on website`,
 * and the row actually has something to look at. The second is not a
 * formality — a gallery card with no image is a hole in the grid, and a row
 * whose photograph hasn't been attached yet is precisely the row someone ticks
 * the box on in advance.
 */
export function isPublishable(page: NotionPortfolioPage): boolean {
  return (
    extractCheckbox(page, PORTFOLIO_PUBLISH_PROPERTY) &&
    extractFiles(page, PORTFOLIO_IMAGES_PROPERTY).length > 0
  );
}

/**
 * Map the publishable rows of a Notion scan to their public projection,
 * newest first.
 *
 * A row with no title still renders (the caption falls back client-side to
 * nothing) — the photograph is the point of a gallery, and dropping a piece
 * because the atelier hadn't named it would lose the work, not just the label.
 */
export function extractPortfolioPieces(
  pages: NotionPortfolioPage[],
): PortfolioPieceRecord[] {
  const records: PortfolioPieceRecord[] = [];

  for (const page of pages) {
    if (!isPublishable(page)) continue;

    const facets: PortfolioFacetRecord[] = [];
    for (const facet of FACET_DEFINITIONS) {
      const values = extractFacetValues(page, facet.property);
      if (values.length > 0) facets.push({ id: facet.id, values });
    }

    records.push({
      id: page.id,
      title: extractTitle(page, PORTFOLIO_TITLE_PROPERTY),
      images: extractFiles(page, PORTFOLIO_IMAGES_PROPERTY),
      facets,
      ...(page.created_time ? { publishedAt: page.created_time } : {}),
    });
  }

  // Newest first, like the testimonials. Notion's own sort can't be trusted to
  // survive the scan's paging, and the order is not something the atelier
  // should have to maintain a property for.
  records.sort((a, b) =>
    (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
  );
  return records;
}

/**
 * The chip groups to offer, derived from the pieces being served.
 *
 * A dimension is offered only when the published work actually varies along it:
 * fewer than two distinct options means every piece answers it the same way (or
 * none answers it at all), and a chip that filters nothing is worse than no
 * chip — it invites a click that changes the grid not at all. That single rule
 * is what lets all four dimensions be declared up front and still have the
 * gallery show only the ones that mean something today.
 */
export function derivePortfolioFilters(
  pieces: PortfolioPieceRecord[],
): PortfolioFilterRecord[] {
  const filters: PortfolioFilterRecord[] = [];

  for (const facet of FACET_DEFINITIONS) {
    const options = new Set<string>();
    for (const piece of pieces) {
      const match = piece.facets.find((f) => f.id === facet.id);
      for (const value of match?.values ?? []) options.add(value);
    }
    if (options.size < 2) continue;
    filters.push({
      id: facet.id,
      label: facet.label,
      options: [...options].sort((a, b) => a.localeCompare(b)),
    });
  }

  return filters;
}
