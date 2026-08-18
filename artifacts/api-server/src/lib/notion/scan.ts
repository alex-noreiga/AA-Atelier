// Full-database scans, for the reads that genuinely need every row.
//
// Almost every Notion read in this app is a filtered lookup — one order, one
// customer's orders, the invoices due a reminder. The studio analytics are the
// exception: they aggregate over the whole orders / shop-orders / invoices
// databases, so they page through a database front to back.
//
// That's a footgun worth containing in one place:
//
//   * **Bounded.** A runaway `has_more`/cursor loop against a paginated API is
//     an unbounded request fan-out on a serverless function. `MAX_SCAN_PAGES`
//     stops it; hitting the cap logs a warning and returns what was read, so an
//     unexpectedly large database yields under-counted figures rather than a
//     timeout. At Notion's 100-row page size that's 10,000 rows — orders of
//     magnitude past what a costume atelier will hold, and cheap to raise.
//   * **One implementation.** The three analytics repositories differ only in
//     which client and which row shape they read, so the paging itself lives
//     here rather than being copy-pasted (and drifting) three times.

import type { NotionClient } from "./client.js";
import { logger } from "../logger.js";

/** Safety ceiling on a full-database scan: 100 pages × 100 rows = 10,000 rows. */
export const MAX_SCAN_PAGES = 100;

interface NotionPagedResponse<TRow> {
  results: TRow[];
  has_more?: boolean;
  next_cursor?: string | null;
}

/**
 * Read every row of a Notion database, following the cursor up to
 * {@link MAX_SCAN_PAGES}. `label` names the scan in the cap warning so a
 * truncated aggregation is traceable to the database it came from.
 */
export async function scanDatabase<TRow>(
  client: NotionClient,
  label: string,
  body: Record<string, unknown> = {},
): Promise<TRow[]> {
  const rows: TRow[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          ...body,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Notion query failed with status ${response.status}`);
    }

    const data = (await response.json()) as NotionPagedResponse<TRow>;
    rows.push(...data.results);
    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    pages += 1;

    if (cursor && pages >= MAX_SCAN_PAGES) {
      logger.warn(
        { label, pages, rows: rows.length },
        "Notion scan hit the page cap; figures are computed from a partial read",
      );
      cursor = undefined;
    }
  } while (cursor);

  return rows;
}
