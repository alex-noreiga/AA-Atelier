// Rendering an ISO calendar date (`yyyy-mm-dd`) for a customer to read.
//
// Extracted from `lib/resend/emails.ts` when texts began quoting the same dates
// as the emails, because the rule below is a real gotcha rather than a
// preference — a second copy of it would drift, and the drift would be a
// payment reminder that says one date in the inbox and the day before it on the
// phone.
//
// **The formatting is pinned to UTC, deliberately.** A date-only value parses to
// UTC midnight, which any westward zone (the studio's own included) renders as
// the previous day. This is the same trap `orderedOn` documents on the sales
// figures: a value carrying no time is a calendar day and must be read as
// written, never converted.

/** Parse a `yyyy-mm-dd` value, or null when it isn't one. */
function parseCalendarDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * `2026-08-15` -> "August 15, 2026". Falls back to the raw string when it isn't
 * a parseable `yyyy-mm-dd`, so a malformed value is shown, not dropped.
 */
export function formatCalendarDate(isoDate: string): string {
  const parsed = parseCalendarDate(isoDate);
  if (!parsed) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(parsed);
}

/**
 * `2026-08-15` -> "August 15". The same date without the year, for a text —
 * where every character is billed and a due date is always within weeks, so the
 * year says nothing the reader didn't know.
 */
export function formatCalendarDateShort(isoDate: string): string {
  const parsed = parseCalendarDate(isoDate);
  if (!parsed) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  }).format(parsed);
}
