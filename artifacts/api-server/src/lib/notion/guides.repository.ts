// Reads for the Notion "Studio Guides" database.
//
// Three reads, and they don't all hit the same host:
//
//   * {@link listGuides} queries Notion for the rows — metadata only, no file
//     content. This is what the dashboard loads.
//   * {@link findGuideById} reads one row back, for when a guide is opened.
//   * {@link fetchGuideDocument} downloads one row's attachment from the
//     storage host Notion's signed URL points at. That is an ordinary `fetch`
//     with no Notion credential on it — the signature in the URL is the
//     authorization — which is why it takes an injectable fetcher rather than
//     going through `NotionClient`.
//
// THE LISTING DOES NOT DOWNLOAD ANYTHING. A guide's markup is fetched only when
// that guide is opened. The first cut downloaded every attachment on every
// dashboard load in order to render a list of collapsed one-line summaries,
// which was wrong three ways: the whole manual was inlined into a single JSON
// body (nine screenshot-heavy guides would exceed Vercel's ~4.5 MB response
// limit and 500 the endpoint — losing the small guides along with the large
// ones, with no partial degradation because the size cap is per file), a
// dashboard that merely refocused re-downloaded the lot, and one hung storage
// connection stalled a page nobody had asked to read a guide on. One guide per
// response also means the per-file cap is now the only cap needed.
//
// It is one page of rows, not a `scanDatabase`: a studio writes a handful of
// procedures, not thousands, and paging a database that will never fill one
// page buys nothing but latency. The caller is told when the read was cut short
// so the panel can say the list is partial rather than looking complete — the
// same contract as the review moderation queue.

import {
  getStudioGuidesNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import {
  extractGuide,
  type GuideAttachment,
  type GuideRecord,
  type NotionGuidePage,
} from "./guides.schema.js";

/** One page of rows. A studio's whole manual fits many times over. */
const GUIDES_PAGE_SIZE = 100;

/**
 * The most markup one guide may contribute to a response.
 *
 * Sized for the guide the atelier is actually likely to write: an HTML export
 * from a word processor, with its screenshots base64-inlined. Only ever one
 * guide per response, so this is comfortably inside Vercel's ~4.5 MB limit even
 * after JSON string-escaping.
 */
export const MAX_GUIDE_BYTES = 2 * 1024 * 1024;

/**
 * How long a single attachment download may take.
 *
 * Without this the fetch has no bound at all: one hung storage connection holds
 * a worker until the platform kills the function, which turns a slow file into
 * a 500. Every other outbound read here that can hang carries an explicit
 * bound (`lib/google/retry.ts`); this is that bound.
 */
const DOWNLOAD_TIMEOUT_MS = 10_000;

interface NotionGuidesQueryResponse {
  results: NotionGuidePage[];
  has_more?: boolean;
}

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_STUDIO_GUIDES_DATABASE_ID is not configured for the Studio Guides database",
  );
}

/** Whether the guides database is configured. Unset ⇒ the dashboard panel says
 * so, rather than rendering an empty list that reads as "nothing written yet". */
export function guidesConfigured(
  client: NotionClient = getStudioGuidesNotionClient(),
): boolean {
  return Boolean(client.databaseId);
}

/**
 * Thrown when Notion says the database isn't there.
 *
 * Distinguished from every other failure because it is the one the atelier
 * causes and can fix: setting the id but never sharing the database with the
 * integration 404s every query. Left as a bare error that would be a permanent
 * 500 plus an alert email on every dashboard load; the service turns it into
 * the same "not connected" the unset id gets, which is what the panel already
 * tells you how to fix.
 */
export class GuidesDatabaseUnreachableError extends Error {}

/**
 * Every guide row, most recently edited first. Metadata only — no downloads.
 *
 * Deliberately unsorted by the atelier's `Order` at the query: sorting on a
 * property the database may not have yet 400s the whole read, and the service
 * has to order by title as a tiebreak anyway. Ordering is one line there.
 */
export async function listGuides(
  client: NotionClient = getStudioGuidesNotionClient(),
): Promise<{ records: GuideRecord[]; truncated: boolean }> {
  assertConfigured(client);

  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        page_size: GUIDES_PAGE_SIZE,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      }),
    },
  );

  if (response.status === 404) {
    throw new GuidesDatabaseUnreachableError(
      "Notion returned 404 for the Studio Guides database",
    );
  }
  if (!response.ok) {
    throw new Error(
      `Notion guides query failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as NotionGuidesQueryResponse;
  return {
    records: data.results.map(extractGuide),
    truncated: Boolean(data.has_more),
  };
}

/** One guide row by page id, or null when Notion no longer has it (the row may
 * have been deleted since the dashboard loaded). */
export async function findGuideById(
  guideId: string,
  client: NotionClient = getStudioGuidesNotionClient(),
): Promise<GuideRecord | null> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${guideId}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Notion guide read failed with status ${response.status}`);
  }

  return extractGuide((await response.json()) as NotionGuidePage);
}

/** Why an attachment produced no markup. Mirrors `StudioGuide.unavailable`. */
export type GuideFetchFailure = "too-large" | "unreadable";

export type GuideDocument =
  { ok: true; html: string } | { ok: false; reason: GuideFetchFailure };

/**
 * Read a response body, giving up the moment it exceeds `limit`.
 *
 * Streaming rather than `arrayBuffer()` is the point: buffering first and
 * checking the length after means a 300 MB file served without a
 * `Content-Length` is fully materialized in the function's heap before being
 * rejected — an unbounded read wearing a cap. Here nothing past the limit is
 * ever held, and the body is cancelled rather than drained.
 */
async function readCapped(
  response: Response,
  limit: number,
): Promise<Uint8Array | null> {
  const body = response.body;
  // No stream to read (an older runtime, or a test double): fall back to
  // buffering. Safe here only because the declared-length check ran first.
  if (!body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > limit ? null : bytes;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Download one guide's markup.
 *
 * The size cap is checked twice on purpose: `Content-Length` first, so an
 * oversized file is refused without being pulled down at all, and then as the
 * body streams in, because a chunked response may not have declared a length. A
 * missing or lying header therefore costs nothing beyond the cap itself.
 *
 * Never throws — a failure is a value, so an unreachable file degrades that one
 * guide rather than the endpoint.
 */
export async function fetchGuideDocument(
  attachment: GuideAttachment,
  fetchImpl: typeof fetch = fetch,
): Promise<GuideDocument> {
  // The compiler already forbids this (see `GuideAttachment`); the check is
  // what makes the guarantee legible at the point the request is made.
  if (attachment.kind !== "upload") return { ok: false, reason: "unreadable" };

  try {
    const response = await fetchImpl(attachment.url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok) return { ok: false, reason: "unreadable" };

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_GUIDE_BYTES) {
      return { ok: false, reason: "too-large" };
    }

    const bytes = await readCapped(response, MAX_GUIDE_BYTES);
    if (!bytes) return { ok: false, reason: "too-large" };

    return { ok: true, html: new TextDecoder("utf-8").decode(bytes) };
  } catch {
    // Includes the abort: a download that outran the timeout is unreadable as
    // far as the dashboard is concerned, and re-opening the guide retries it.
    return { ok: false, reason: "unreadable" };
  }
}
