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
import { notionRequestError } from "./errors.js";
import { logger } from "../logger.js";

/** Safety ceiling on a full-database scan: 100 pages × 100 rows = 10,000 rows. */
export const MAX_SCAN_PAGES = 100;

interface NotionPagedResponse<TRow> {
  results: TRow[];
  has_more?: boolean;
  next_cursor?: string | null;
}

/** A scan, and whether it read the whole database. */
export interface DatabaseScan<TRow> {
  rows: TRow[];
  /** False when the page cap cut the read short — so a caller whose arithmetic
   * would be WRONG on a partial read (rather than merely short) can say so or
   * fall back, instead of quietly reporting a smaller number. */
  complete: boolean;
}

/**
 * Read every row of a Notion database, following the cursor up to
 * {@link MAX_SCAN_PAGES}, and report whether that was all of them.
 *
 * Most callers want {@link scanDatabase} — a row missing from a sum makes that
 * sum short, which the cap warning covers. This variant is for the caller where
 * a partial read is qualitatively different: the invoice-line scan groups rows
 * BY invoice, so truncation doesn't drop an invoice, it silently halves one.
 */
export async function scanDatabaseChecked<TRow>(
  client: NotionClient,
  label: string,
  body: Record<string, unknown> = {},
): Promise<DatabaseScan<TRow>> {
  const rows: TRow[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let complete = true;

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
      // `label` and the id ride the error: a scan that fails is read by whoever
      // opens the alert email, and "status 404" alone tells them nothing about
      // which database to go and share.
      throw await notionRequestError(response, {
        label,
        databaseId: client.databaseId,
      });
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
      complete = false;
    }
  } while (cursor);

  return { rows, complete };
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
  const { rows } = await scanDatabaseChecked<TRow>(client, label, body);
  return rows;
}
