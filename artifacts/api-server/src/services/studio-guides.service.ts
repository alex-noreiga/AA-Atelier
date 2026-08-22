// The studio dashboard's how-to guides.
//
// The atelier's procedures — how an invoice is actually built, what the
// milestone reconciliation is for, how a refund is decided — have lived in two
// places that aren't the dashboard: developer notes under `.agents/memory/`,
// and standalone HTML files the atelier writes for itself. This is the read
// that puts them beside the tool each one describes.
//
// THE ARRANGEMENT IS THE FEATURE. The app stores no guide content and has no
// editor: a guide is a file attached to a Notion row, and revising it means
// replacing the file. Nothing here is a deploy, which is what makes it worth
// the read — a procedure that needs an engineer to correct is a procedure that
// stays wrong.
//
// Load-bearing decisions:
//
//  1. **Listing is metadata; markup is fetched per guide, when opened.** Two
//     use-cases rather than one, because inlining every guide's markup into the
//     listing put the studio's whole manual in a single JSON body: nine
//     screenshot-heavy guides would pass Vercel's ~4.5 MB response limit and
//     500 the endpoint, losing the small guides along with the large ones. It
//     also means a dashboard nobody opens a guide on downloads nothing at all,
//     and one hung storage connection can't stall the page.
//  2. **A guide is never dropped, only explained.** A row with no file, a
//     pasted link where an upload was needed, a PDF filed as a guide, an
//     oversized file, a failed download — each is reported with `unavailable`
//     saying which. The alternative is a guide the atelier wrote that appears
//     nowhere and raises nothing, which is indistinguishable from one nobody
//     wrote. Same reasoning as the materials panel's untracked list. The three
//     reasons that need no download are decided in the listing, so a broken
//     guide reads as broken before anyone opens it.
//  3. **The markup is served verbatim, and sanitized by the FRAME, not here.**
//     The dashboard renders it in a sandboxed iframe with scripts disabled, so
//     nothing in a guide can run or reach the signed-in studio session. Passing
//     it through a regex "sanitizer" as well would buy no safety the sandbox
//     doesn't already give, while silently mangling the atelier's own markup —
//     and would make the sandbox look optional to whoever reads this next. It
//     is not optional. See `components/studio-guides.tsx`.
//  4. **The listing is cached for a minute**, like every other live read here,
//     which is also how long after editing a row the dashboard takes to show
//     the change. Markup is deliberately not cached server-side: it is fetched
//     on demand and held by the browser's query cache while the guide is open,
//     so replacing a file shows on the next open rather than a minute later.

import {
  guidesConfigured,
  listGuides,
  findGuideById,
  fetchGuideDocument,
} from "../lib/notion/guides.repository.js";
import { isNotionNotFound } from "../lib/notion/errors.js";
import type { GuideRecord } from "../lib/notion/guides.schema.js";
import {
  GUIDE_SECTIONS,
  resolveGuideSection,
  type GuideSection,
} from "../lib/guide-sections.js";
import { NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** Why a guide has no markup to render. Mirrors `StudioGuide.unavailable`. */
export type GuideUnavailable =
  "no-file" | "not-uploaded" | "not-html" | "too-large" | "unreadable";

export interface StudioGuideView {
  id: string;
  title: string;
  summary?: string;
  section: string;
  /** Set when the row can't produce markup for a reason visible without a
   * download, so the dashboard says so before the guide is opened. */
  unavailable?: GuideUnavailable;
  fileName?: string;
  updatedAt?: string;
  notionUrl?: string;
}

/** One guide's markup, or why there isn't any. */
export interface StudioGuideContentView {
  id: string;
  html?: string;
  unavailable?: GuideUnavailable;
}

export interface StudioGuidesResult {
  guides: StudioGuideView[];
  sections: GuideSection[];
  configured: boolean;
  /** True when the id IS set but Notion answered 404 — never shared with the
   * integration, or the wrong id. A configuration state, not an outage, so it
   * is reported rather than thrown; see {@link getStudioGuides}. */
  unreachable?: boolean;
  truncated?: boolean;
}

/** A minute, like every other live read here. */
const CACHE_TTL_MS = 60_000;

/**
 * Whether an attachment is markup this can render.
 *
 * Decided on the file's NAME rather than on what comes back from the download,
 * because the storage host serves everything as a generic binary type — there
 * is no content type to trust. A `.pdf` or a `.docx` filed as a guide would
 * decode to mojibake and render as a page of noise, so it is reported as
 * `not-html` instead: the atelier can see it needs converting.
 */
export function isHtmlAttachment(fileName: string): boolean {
  return /\.x?html?$/i.test(fileName.trim());
}

/**
 * Order guides for display: the atelier's `Order` first where it set one, then
 * alphabetically by title.
 *
 * A row with no `Order` sorts after every row that has one rather than at zero
 * — "I haven't said where this goes" is not the same claim as "this goes
 * first", and defaulting it to 0 would silently promote every unordered guide
 * above the ones the atelier deliberately placed.
 */
export function compareGuides(a: GuideRecord, b: GuideRecord): number {
  const orderA = a.order ?? Number.POSITIVE_INFINITY;
  const orderB = b.order ?? Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

/**
 * The reasons a row can't produce markup that are visible from the row alone —
 * no download required.
 *
 * Shared by both halves so the listing and the content read can't disagree
 * about whether a guide is renderable: the listing reports it, and the content
 * read refuses on exactly the same test rather than fetching anyway.
 */
export function staticUnavailability(
  record: GuideRecord,
): GuideUnavailable | undefined {
  const attachment = record.attachment;
  if (!attachment) return "no-file";
  if (attachment.kind !== "upload") return "not-uploaded";
  if (!isHtmlAttachment(attachment.name)) return "not-html";
  return undefined;
}

/** Map one row to its listing entry. */
function toView(record: GuideRecord): StudioGuideView {
  const unavailable = staticUnavailability(record);

  return {
    id: record.id,
    title: record.title,
    section: resolveGuideSection(record.section),
    ...(record.summary ? { summary: record.summary } : {}),
    ...(unavailable ? { unavailable } : {}),
    ...(record.attachment?.name ? { fileName: record.attachment.name } : {}),
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    ...(record.notionUrl ? { notionUrl: record.notionUrl } : {}),
  };
}

let cached: { result: StudioGuidesResult; fetchedAt: number } | null = null;

/** Test seam; also the seam if a manual refresh is ever wanted. */
export function __resetStudioGuidesCache(): void {
  cached = null;
}

/**
 * The atelier's guides — what they are and where they go, without their
 * content.
 *
 * The section vocabulary rides along whether or not any guide is filed against
 * it, so an empty panel can still tell the atelier what a `Section` may be set
 * to — the one thing that is otherwise only discoverable by reading
 * `lib/guide-sections.ts`.
 */
export async function getStudioGuides(): Promise<StudioGuidesResult> {
  const sections = [...GUIDE_SECTIONS];

  if (!guidesConfigured()) {
    return { guides: [], sections, configured: false };
  }

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    const { records, truncated } = await listGuides();

    const result: StudioGuidesResult = {
      guides: [...records].sort(compareGuides).map(toView),
      sections,
      configured: true,
      ...(truncated ? { truncated: true } : {}),
    };
    cached = { result, fetchedAt: Date.now() };
    return result;
  } catch (error) {
    // Stale guides are still the right procedures; no guides reads as though
    // none were ever written. Fall back where there is something to fall back
    // to.
    if (cached) return cached.result;

    // An id set but never shared with the integration 404s every query. Left as
    // a throw that is a permanent 500 plus an alert email on every dashboard
    // load — for a configuration mistake only a human can clear, which is the
    // same KIND of state as an unset id. So it is reported and the panel says
    // what to fix. Deliberately NOT folded into `configured: false`: the two
    // have different fixes, and the panel names the right one. Every other
    // failure still throws — a 502 from Notion IS an outage.
    if (isNotionNotFound(error)) {
      logger.warn(
        { err: error },
        "Studio Guides database is configured but Notion cannot see it; check the id and that the integration is shared with it",
      );
      return { guides: [], sections, configured: true, unreachable: true };
    }
    throw error;
  }
}

/**
 * One guide's markup, fetched now.
 *
 * The row is read back rather than trusted from the listing: the signed
 * attachment URL expires in about an hour, so it has to be fresh, and re-reading
 * is also what turns a row deleted since the dashboard loaded into a 404 rather
 * than a confusing download error.
 */
export async function getStudioGuideContent(
  guideId: string,
): Promise<StudioGuideContentView> {
  if (!guidesConfigured()) {
    throw new NotFoundError("That guide no longer exists.");
  }

  const record = await findGuideById(guideId);
  if (!record) throw new NotFoundError("That guide no longer exists.");

  const unavailable = staticUnavailability(record);
  if (unavailable) return { id: record.id, unavailable };

  const document = await fetchGuideDocument(record.attachment!);
  if (!document.ok) {
    // Worth a log line: unlike the static reasons, this one is nothing the
    // atelier did and nothing they can fix by editing the row.
    logger.warn(
      { guide: record.title, reason: document.reason },
      "Studio guide attachment could not be read",
    );
    return { id: record.id, unavailable: document.reason };
  }

  return { id: record.id, html: document.html };
}
