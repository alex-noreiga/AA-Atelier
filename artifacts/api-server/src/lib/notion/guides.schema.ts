// Read-side mapping for the Notion "Studio Guides" database — the atelier's own
// how-to write-ups, each an HTML file attached to a row.
//
// The app only ever READS this database. A guide is authored elsewhere (the
// atelier already keeps them as standalone HTML files) and revised by replacing
// the attachment, which is the whole point of storing them here rather than in
// the repository: no deploy stands between rewriting a procedure and the
// dashboard showing the new one.
//
// TWO THINGS TO KNOW ABOUT THE FILE:
//
//  1. **The `url` is Notion-signed and short-lived** (about an hour), exactly
//     like the review photos. It is a fetch target for this request and nothing
//     more — never stored, never handed to the browser. The server downloads
//     the markup and serves that instead, so the dashboard never holds a
//     credential-bearing URL and a cached response can't rot into a dead link.
//  2. **A row can legitimately have no file.** The atelier creates the row when
//     it decides a guide is needed and attaches the file when it's written. So
//     an absent attachment is a normal state, not an error, and the guide is
//     still listed — with the reason it can't be rendered.

// Live-schema property names (a Notion rename is a one-line change here).
export const GUIDE_TITLE_PROPERTY = "Guide"; // title
export const GUIDE_FILE_PROPERTY = "File"; // files & media
export const GUIDE_SECTION_PROPERTY = "Section"; // select
export const GUIDE_SUMMARY_PROPERTY = "Summary"; // rich_text
export const GUIDE_ORDER_PROPERTY = "Order"; // number

/** The attachment on a guide row, before anything has been downloaded. */
export interface GuideAttachment {
  /** The file's name as Notion holds it — how the HTML check is decided. */
  name: string;
  /** Notion-signed and short-lived. A fetch target, never served on. */
  url: string;
}

/** One guide row, as the dashboard reads it. */
export interface GuideRecord {
  /** The Notion page id. */
  id: string;
  title: string;
  /** What the atelier filed it under, verbatim. Resolved by `resolveGuideSection`. */
  section: string;
  /** A line about what it covers. Absent when the row carries none. */
  summary?: string;
  /** Where it sorts within its section. `null` when the atelier hasn't said. */
  order: number | null;
  /** The first attachment on the row, when there is one. */
  attachment?: GuideAttachment;
  /** When the row was last edited — i.e. when the guide last changed. */
  updatedAt?: string;
  /** The row's own page, which is where the file is replaced. */
  notionUrl?: string;
}

// Raw Notion property shapes we read back (only the types we touch).
interface NotionFileValue {
  name?: string;
  file?: { url?: string };
  external?: { url?: string };
}

type NotionReadProperty =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "number"; number: number | null }
  | { type: "files"; files: NotionFileValue[] };

export interface NotionGuidePage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties: Record<string, NotionReadProperty | undefined>;
}

function readTitle(page: NotionGuidePage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function readRichText(page: NotionGuidePage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "rich_text") return "";
  return p.rich_text
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function readSelect(page: NotionGuidePage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "select") return "";
  return (p.select?.name ?? "").trim();
}

function readNumber(page: NotionGuidePage, name: string): number | null {
  const p = page.properties[name];
  if (p?.type !== "number") return null;
  return p.number;
}

/**
 * The first usable attachment on the row.
 *
 * `file.url` is a Notion-hosted upload, `external.url` a link the atelier
 * pasted — the same fallback the review-photo reader uses, and for the same
 * reason: which one a guide arrived as isn't a distinction the dashboard cares
 * about. Only the first is read; a row is one guide, and quietly rendering a
 * second attachment nobody asked about would be a surprise.
 */
function readAttachment(
  page: NotionGuidePage,
  name: string,
): GuideAttachment | undefined {
  const p = page.properties[name];
  if (p?.type !== "files") return undefined;

  for (const file of p.files) {
    const url = file.file?.url ?? file.external?.url;
    if (url) return { name: (file.name ?? "").trim(), url };
  }
  return undefined;
}

/** Map a raw Notion page into a guide record. Every field degrades to
 * absent/null rather than throwing, so one odd row can't fail the whole scan. */
export function extractGuide(page: NotionGuidePage): GuideRecord {
  const summary = readRichText(page, GUIDE_SUMMARY_PROPERTY);
  const attachment = readAttachment(page, GUIDE_FILE_PROPERTY);

  return {
    id: page.id,
    title: readTitle(page, GUIDE_TITLE_PROPERTY),
    section: readSelect(page, GUIDE_SECTION_PROPERTY),
    order: readNumber(page, GUIDE_ORDER_PROPERTY),
    ...(summary ? { summary } : {}),
    ...(attachment ? { attachment } : {}),
    ...(page.last_edited_time ? { updatedAt: page.last_edited_time } : {}),
    ...(page.url ? { notionUrl: page.url } : {}),
  };
}
