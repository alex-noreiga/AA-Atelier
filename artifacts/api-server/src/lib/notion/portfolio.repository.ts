// Reads for the "Design Portfolio & Sketch Library" Notion database.
//
// Read-only, and the only consumer is the public gallery. Three shapes are
// borrowed wholesale from the reads that came before it, for the same reasons:
//
//   * **A bounded scan, not a filtered query.** The gate is a `Show on website`
//     checkbox the atelier has not created yet, and a Notion `filter` naming a
//     property the database lacks answers 400 — so pushing the gate into the
//     query would make the gallery fail loudly for exactly as long as it took
//     to add the column, instead of quietly showing nothing. The publish gate
//     is applied in the pure extractor instead (`isPublishable`), where it also
//     re-reads as false for a property that isn't there. Nothing is lost:
//     deriving the filter chips needs every published row anyway, and the
//     database is a costume studio's sketchbook, nowhere near the scan cap.
//   * **60s cache + fall back to stale on error**, like inventory, categories
//     and testimonials. The atelier publishes a piece every few weeks; the page
//     is read on every visit.
//   * **Degrade to an empty gallery, never a 500, for the states only a human
//     can clear.** An unset `NOTION_PORTFOLIO_DATABASE_ID` and a Notion 404 (the
//     id is wrong, or the integration was never shared with the database) are
//     configuration, not outages: they cannot fix themselves, so erroring the
//     page and alerting the inbox on every visit would be noise. Any other
//     status still throws — an outage clears itself and is worth the one alert.

import { getPortfolioNotionClient, type NotionClient } from "./client.js";
import { isNotionNotFound } from "./errors.js";
import { scanDatabase } from "./scan.js";
import { logger } from "../logger.js";
import {
  extractPortfolioPieces,
  type NotionPortfolioPage,
  type PortfolioPieceRecord,
} from "./portfolio.schema.js";

const CACHE_TTL_MS = 60_000;
let cached: { pieces: PortfolioPieceRecord[]; fetchedAt: number } | null = null;

/** Whether the portfolio database is configured. Unset ⇒ the gallery is empty
 * and says so, rather than erroring. */
export function portfolioConfigured(
  client: NotionClient = getPortfolioNotionClient(),
): boolean {
  return Boolean(client.databaseId);
}

/** Test seam: drop the cached scan so a test's fake client is read afresh. */
export function __resetPortfolioCache(): void {
  cached = null;
}

/**
 * The published portfolio pieces, newest first.
 *
 * Returns `[]` — never throws — when the database isn't configured or Notion
 * can't see it. See the header for why those two are treated as states rather
 * than failures.
 */
export async function listPublishedPortfolioPieces(
  client: NotionClient = getPortfolioNotionClient(),
): Promise<PortfolioPieceRecord[]> {
  if (!client.databaseId) return [];

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.pieces;
  }

  try {
    const pages = await scanDatabase<NotionPortfolioPage>(
      client,
      "Design Portfolio & Sketch Library",
    );
    const pieces = extractPortfolioPieces(pages);
    cached = { pieces, fetchedAt: Date.now() };
    return pieces;
  } catch (error) {
    if (cached) return cached.pieces;
    if (isNotionNotFound(error)) {
      // Deliberately not cached: the fix is a human sharing the database, and
      // caching the empty result would hold the gallery blank for another
      // minute after they did.
      logger.warn(
        { err: error },
        "Portfolio database is unreachable; serving an empty gallery",
      );
      return [];
    }
    throw error;
  }
}
