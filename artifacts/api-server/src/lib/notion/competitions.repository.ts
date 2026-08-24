// The competitions read — the dated events a waitlist entry can be pinned to.
//
// Optional and degrade-safe in every direction, because this is decoration on a
// waitlist form and must never be able to break one: an unset database id, an
// unshared integration (Notion's 404), or any other failure all yield `[]`, and
// the form then asks the customer to type a date instead. Cached like every
// other live Notion read (60s TTL, falling back to the cached list on a later
// error), since the calendar changes a few times a season and is read on every
// intake-form load.

import { getCompetitionsNotionClient, type NotionClient } from "./client.js";
import { scanDatabase } from "./scan.js";
import { logger } from "../logger.js";
import {
  COMPETITION_ACTIVE_PROPERTY,
  COMPETITION_DATE_PROPERTY,
  extractCompetition,
  type CompetitionRecord,
  type NotionCompetitionPage,
} from "./competitions.schema.js";

const CACHE_TTL_MS = 60_000;
let cached: { competitions: CompetitionRecord[]; fetchedAt: number } | null =
  null;

/** True when a competitions database id is configured. */
export function competitionsConfigured(): boolean {
  return Boolean(getCompetitionsNotionClient().databaseId);
}

/** Test seam: drop the cache between cases. */
export function __resetCompetitionsCache(): void {
  cached = null;
}

/**
 * The upcoming competitions the atelier is still working towards, soonest
 * first.
 *
 * Two filters, and they are the atelier's own two ways of saying a competition
 * is behind them: the `Active` checkbox (whose Notion description is "Uncheck
 * once the competition has passed") and the date itself. Both are applied
 * because they can disagree — a row nobody remembered to untick is still past,
 * and a future row somebody unticked by mistake is still past to the atelier.
 * Filtering on both means the list only ever shrinks, which is the safe
 * direction for a picker: a missing option costs a customer one typed date, a
 * stale one invites them to order for an event that has been and gone.
 *
 * `on_or_after: today` is a real Notion date filter (unlike the view DSL's
 * `< "today"`, which silently matches nothing — see
 * `.agents/memory/studio-operations-page.md`), so this one is safe to push down
 * to the query. Today's own competition is deliberately included: someone
 * skating this weekend still has a season to plan for.
 */
export async function listUpcomingCompetitions(
  client: NotionClient = getCompetitionsNotionClient(),
): Promise<CompetitionRecord[]> {
  if (!client.databaseId) return [];

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.competitions;
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const rows = await scanDatabase<NotionCompetitionPage>(
      client,
      "competitions",
      {
        filter: {
          and: [
            {
              property: COMPETITION_ACTIVE_PROPERTY,
              checkbox: { equals: true },
            },
            {
              property: COMPETITION_DATE_PROPERTY,
              date: { on_or_after: today },
            },
          ],
        },
        sorts: [
          { property: COMPETITION_DATE_PROPERTY, direction: "ascending" },
        ],
      },
    );

    const competitions = rows
      .map(extractCompetition)
      .filter((row): row is CompetitionRecord => row !== null);

    cached = { competitions, fetchedAt: Date.now() };
    return competitions;
  } catch (err) {
    // `warn`, not `error`: an unshared or misconfigured competitions database
    // costs the waitlist a convenience, not a capture, and this is reached from
    // a public endpoint that would otherwise alert the atelier's inbox on every
    // form load. The stale list is served when there is one.
    logger.warn(
      { err },
      "Failed to read the competitions database; the waitlist will ask for a date instead",
    );
    return cached?.competitions ?? [];
  }
}
