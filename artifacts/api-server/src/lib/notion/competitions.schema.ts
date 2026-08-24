// Reading the atelier's "🏆 Competitions" database — the events their customers
// skate, and the only reason seasonal capacity is *seasonal* rather than just a
// number.
//
// The app is a strict READER here. The atelier has kept this calendar since
// before the app existed, with its own `Push starts` and `Weeks away` formulas
// for planning their marketing; nothing below writes to it, and nothing reads
// those two formulas — a formula's rendered text is display wording the atelier
// can restyle, and `Push starts` answers "when should we start advertising",
// which is a different question from "when does this customer need the piece".
// What the waitlist needs is the plain `Date`, so that is what is read.
//
// Property *types* must match the live schema, not the property name (the same
// lesson as the orders database — see `.agents/memory/notion-status-filters.md`).

/** Live-schema property names. A Notion rename is a one-line change here. */
export const COMPETITION_NAME_PROPERTY = "Competition"; // title
export const COMPETITION_DATE_PROPERTY = "Date"; // date
export const COMPETITION_SEASON_PROPERTY = "Season"; // rich_text ("2026-27")
export const COMPETITION_LOCATION_PROPERTY = "Location"; // rich_text
export const COMPETITION_ACTIVE_PROPERTY = "Active"; // checkbox

/** One dated competition, as the waitlist form offers it. */
export interface CompetitionRecord {
  id: string;
  name: string;
  /** ISO `yyyy-mm-dd`. A row without one is dropped — see below. */
  date: string;
  season?: string;
  location?: string;
}

export interface NotionCompetitionPage {
  id: string;
  properties: {
    [COMPETITION_NAME_PROPERTY]?: { title?: Array<{ plain_text: string }> };
    [COMPETITION_DATE_PROPERTY]?: { date?: { start?: string | null } | null };
    [COMPETITION_SEASON_PROPERTY]?: {
      rich_text?: Array<{ plain_text: string }>;
    };
    [COMPETITION_LOCATION_PROPERTY]?: {
      rich_text?: Array<{ plain_text: string }>;
    };
  };
}

function readText(
  page: NotionCompetitionPage,
  property:
    typeof COMPETITION_SEASON_PROPERTY | typeof COMPETITION_LOCATION_PROPERTY,
): string {
  return (page.properties[property]?.rich_text ?? [])
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

/**
 * Map one competition row, or `null` when it can't be offered as a choice.
 *
 * Two things make a row unusable, and both are **current live data**, not
 * hypotheticals: every row in the database today has a blank `Date` and a blank
 * `Season`. A nameless or undated competition cannot be picked from a list ("
 * — " is not a choice) and cannot be sorted by need-by date, which is the whole
 * point of pinning a waitlist entry to one. So it is dropped rather than
 * rendered as a blank option, and the form falls back to asking for a date.
 *
 * `Season` and `Location` are genuinely optional — they are labels on a choice
 * that is already identified by its name and date — so a blank one is simply
 * omitted rather than disqualifying the row.
 */
export function extractCompetition(
  page: NotionCompetitionPage,
): CompetitionRecord | null {
  const name = (page.properties[COMPETITION_NAME_PROPERTY]?.title ?? [])
    .map((t) => t.plain_text)
    .join("")
    .trim();
  // Notion returns a datetime here when the atelier set one; the waitlist cares
  // about the day, and the contract says `format: date`.
  const date = (
    page.properties[COMPETITION_DATE_PROPERTY]?.date?.start ?? ""
  ).slice(0, 10);
  if (!name || !date) return null;

  const season = readText(page, COMPETITION_SEASON_PROPERTY);
  const location = readText(page, COMPETITION_LOCATION_PROPERTY);
  return {
    id: page.id,
    name,
    date,
    ...(season ? { season } : {}),
    ...(location ? { location } : {}),
  };
}
