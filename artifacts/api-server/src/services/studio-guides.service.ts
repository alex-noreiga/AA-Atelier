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
//  1. **A guide is never dropped, only explained.** A row with no file, a PDF
//     filed as a guide, an oversized file, a download that failed — each is
//     returned with `unavailable` saying which. The alternative is a guide the
//     atelier wrote that appears nowhere and raises nothing, which is
//     indistinguishable from one nobody wrote. Same reasoning as the materials
//     panel's untracked list.
//  2. **The markup is served verbatim, and sanitized by the FRAME, not here.**
//     The dashboard renders it in a sandboxed iframe with scripts disabled, so
//     nothing in a guide can run or reach the signed-in studio session. Passing
//     it through a regex "sanitizer" as well would buy no safety the sandbox
//     doesn't already give, while silently mangling the atelier's own markup —
//     and would make the sandbox look optional to whoever reads this next. It
//     is not optional. See `components/studio-guides.tsx`.
//  3. **Cached whole, for a minute.** Each guide costs a download on top of the
//     Notion query, so the assembled result is cached rather than the rows —
//     the same 60s every live read here uses, which is also how long after
//     replacing a file the dashboard takes to show it.

import {
  guidesConfigured,
  listGuides,
  fetchGuideDocument,
} from "../lib/notion/guides.repository.js";
import type { GuideRecord } from "../lib/notion/guides.schema.js";
import {
  GUIDE_SECTIONS,
  resolveGuideSection,
  type GuideSection,
} from "../lib/guide-sections.js";
import { logger } from "../lib/logger.js";

/** Why a guide has no markup to render. Mirrors `StudioGuide.unavailable`. */
export type GuideUnavailable =
  "no-file" | "not-html" | "too-large" | "unreadable";

export interface StudioGuideView {
  id: string;
  title: string;
  summary?: string;
  section: string;
  html?: string;
  unavailable?: GuideUnavailable;
  fileName?: string;
  updatedAt?: string;
  notionUrl?: string;
}

export interface StudioGuidesResult {
  guides: StudioGuideView[];
  sections: GuideSection[];
  configured: boolean;
  truncated?: boolean;
}

/**
 * How many attachments are downloaded at once. Notion's published rate limit
 * averages three requests a second; the downloads go to its storage host rather
 * than the API, but staying under it costs nothing and keeps one badly-timed
 * dashboard load from competing with the rest of the page's reads.
 */
const GUIDE_CONCURRENCY = 3;

/** A minute, like every other live read here. */
const CACHE_TTL_MS = 60_000;

/** Run `task` over `items` a few at a time, preserving order. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await task(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

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

/** The everything-but-the-markup half of a guide, so both paths agree on it. */
function baseView(record: GuideRecord): StudioGuideView {
  return {
    id: record.id,
    title: record.title,
    section: resolveGuideSection(record.section),
    ...(record.summary ? { summary: record.summary } : {}),
    ...(record.attachment?.name ? { fileName: record.attachment.name } : {}),
    ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    ...(record.notionUrl ? { notionUrl: record.notionUrl } : {}),
  };
}

/** Resolve one row to what the dashboard renders. */
async function resolveGuide(record: GuideRecord): Promise<StudioGuideView> {
  const base = baseView(record);
  const attachment = record.attachment;

  if (!attachment) return { ...base, unavailable: "no-file" };
  if (!isHtmlAttachment(attachment.name)) {
    return { ...base, unavailable: "not-html" };
  }

  const document = await fetchGuideDocument(attachment);
  if (!document.ok) {
    // Worth a log line: unlike the other reasons, this one is nothing the
    // atelier did and nothing they can fix by editing the row.
    logger.warn(
      { guide: record.title, reason: document.reason },
      "Studio guide attachment could not be read",
    );
    return { ...base, unavailable: document.reason };
  }

  return { ...base, html: document.html };
}

let cached: { result: StudioGuidesResult; fetchedAt: number } | null = null;

/** Test seam; also the seam if a manual refresh is ever wanted. */
export function __resetStudioGuidesCache(): void {
  cached = null;
}

/**
 * The atelier's guides, ready to render.
 *
 * The section vocabulary rides along whether or not any guide is filed against
 * it, so an empty panel can still tell the atelier what a `Section` may be set
 * to — the one thing that is otherwise only discoverable by reading this file.
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
    const guides = await mapLimited(
      [...records].sort(compareGuides),
      GUIDE_CONCURRENCY,
      resolveGuide,
    );

    const result: StudioGuidesResult = {
      guides,
      sections,
      configured: true,
      ...(truncated ? { truncated: true } : {}),
    };
    cached = { result, fetchedAt: Date.now() };
    return result;
  } catch (error) {
    // Stale guides are still the right procedures; no guides reads as though
    // none were ever written. Fall back where there is something to fall back
    // to, and surface the failure otherwise.
    if (cached) return cached.result;
    throw error;
  }
}
