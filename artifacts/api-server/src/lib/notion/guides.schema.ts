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
//     like the review photos. It is a fetch target for one request and nothing
//     more — never stored, never handed to the browser. The server downloads
//     the markup and serves that instead, so the dashboard never holds a
//     credential-bearing URL and a cached response can't rot into a dead link.
//  2. **ONLY AN UPLOAD IS FETCHED, never a pasted link.** A Notion `files`
//     property holds either — `file` for something uploaded to Notion,
//     `external` for a URL somebody pasted. The review-photo reader accepts
//     both; this one must not. The server fetches the URL and returns the
//     response body to the dashboard, so accepting `external` would let anyone
//     with EDIT ACCESS TO THIS DATABASE — a Notion permission, not membership
//     of `STUDIO_STAFF_EMAILS` — aim a server-side GET at an address of their
//     choosing and read the answer. The two groups mostly overlap; "mostly" is
//     not a security boundary. An external link is reported as `not-uploaded`
//     rather than silently ignored, and its URL never leaves this module.
//  3. **A row can legitimately have no file.** The atelier creates the row when
//     it decides a guide is needed and attaches the file when it's written. So
//     an absent attachment is a normal state, not an error, and the guide is
//     still listed — with the reason it can't be rendered.

// Live-schema property names (a Notion rename is a one-line change here).
export const GUIDE_TITLE_PROPERTY = "Guide"; // title
export const GUIDE_FILE_PROPERTY = "File"; // files & media
export const GUIDE_SECTION_PROPERTY = "Section"; // select
export const GUIDE_SUMMARY_PROPERTY = "Summary"; // rich_text
export const GUIDE_ORDER_PROPERTY = "Order"; // number

/**
 * The attachment on a guide row, before anything has been downloaded.
 *
 * A discriminated union rather than a nullable `url`, so the external case
 * cannot carry one: the fetchable URL exists only on the `upload` variant, and
 * the compiler is what stops a pasted link reaching {@link fetchGuideDocument}.
 */
export type GuideAttachment =
  | {
      kind: "upload";
      /** The file's name as Notion holds it — how the HTML check is decided. */
      name: string;
      /** Notion-signed and short-lived. A fetch target, never served on. */
      url: string;
    }
  | { kind: "external"; name: string };

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
 * The first attachment on the row.
 *
 * A Notion-hosted upload yields a fetchable `upload`; a pasted link yields an
 * `external` carrying only its name, for the reason in trap 2 above. Only the
 * first file is read — a row is one guide, and quietly rendering a second
 * attachment nobody asked about would be a surprise.
 */
function readAttachment(
  page: NotionGuidePage,
  name: string,
): GuideAttachment | undefined {
  const p = page.properties[name];
  // Notion always sends the array for a `files` property, but one malformed row
  // must not throw its way out of a whole-database read.
  if (p?.type !== "files" || !Array.isArray(p.files)) return undefined;

  for (const file of p.files) {
    const fileName = (file?.name ?? "").trim();
    if (file?.file?.url) {
      return { kind: "upload", name: fileName, url: file.file.url };
    }
    if (file?.external?.url) return { kind: "external", name: fileName };
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
