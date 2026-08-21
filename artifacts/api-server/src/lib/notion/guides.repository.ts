// Reads for the Notion "Studio Guides" database.
//
// Two reads, not one, and they hit different hosts:
//
//   * {@link listGuides} queries Notion for the rows, like every other
//     repository here.
//   * {@link fetchGuideDocument} downloads one row's attachment from the
//     storage host Notion's signed URL points at. That is an ordinary `fetch`
//     with no Notion credential on it — the signature in the URL is the
//     authorization — which is why it takes an injectable fetcher rather than
//     going through `NotionClient`.
//
// It is one page of rows, not a `scanDatabase`: a studio writes a handful of
// procedures, not thousands, and paging a database that will never fill one
// page buys nothing but latency. The caller is told when the read was cut short
// so the panel can say the list is partial rather than looking complete — the
// same contract as the review moderation queue.
//
// THE SIZE CAP IS LOAD-BEARING. The markup is returned inline in a JSON
// response from a serverless function, so an attachment nobody bounded is a
// response nobody bounded. A guide over the cap is reported as `too-large`
// rather than downloaded and truncated, because half a procedure that stops
// mid-sentence is worse than one that says why it isn't here.

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

/** The most markup one guide may contribute to the response. */
export const MAX_GUIDE_BYTES = 512 * 1024;

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
 * Every guide row, newest first.
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

/** Why an attachment produced no markup. Mirrors `StudioGuide.unavailable`. */
export type GuideFetchFailure = "too-large" | "unreadable";

export type GuideDocument =
  { ok: true; html: string } | { ok: false; reason: GuideFetchFailure };

/**
 * Download one guide's markup.
 *
 * The size cap is checked twice on purpose: `Content-Length` first, so an
 * oversized file is refused without being pulled down at all, and again on what
 * actually arrived, because a chunked response may not have declared a length.
 * A missing or lying header therefore costs at most one over-cap download, not
 * an unbounded one.
 *
 * Never throws — a failure is a value, so one unreachable file degrades that
 * guide rather than the panel.
 */
export async function fetchGuideDocument(
  attachment: GuideAttachment,
  fetchImpl: typeof fetch = fetch,
): Promise<GuideDocument> {
  try {
    const response = await fetchImpl(attachment.url);
    if (!response.ok) return { ok: false, reason: "unreadable" };

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_GUIDE_BYTES) {
      return { ok: false, reason: "too-large" };
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_GUIDE_BYTES) {
      return { ok: false, reason: "too-large" };
    }

    return {
      ok: true,
      html: new TextDecoder("utf-8").decode(bytes),
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
