// Timezone math for appointment scheduling, built on the platform `Intl` API so
// no date library is needed. Everything is expressed in a single atelier
// timezone (see settings): weekly working hours and slot start times are
// *wall-clock* times in that zone, while bookings are stored and compared as
// UTC instants. These helpers convert between the two, correctly across DST.
//
// A "date string" throughout is a local calendar date `YYYY-MM-DD`. The weekday
// of a calendar date is timezone-independent, so it's computed with plain UTC
// arithmetic; only wall-clock ⇄ instant conversion needs the zone.

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Parse `YYYY-MM-DD` into numeric parts (no timezone involved). */
export function parseDateString(dateStr: string): {
  year: number;
  month: number;
  day: number;
} {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month, day };
}

/** Parse `HH:MM` (24h) into minutes since midnight, or null if malformed. */
export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Add `n` calendar days to a `YYYY-MM-DD` string (pure calendar arithmetic). */
export function addCalendarDays(dateStr: string, n: number): string {
  const { year, month, day } = parseDateString(dateStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + n);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** The long weekday name ("Monday", …) for a local calendar date. */
export function weekdayName(dateStr: string): string {
  const { year, month, day } = parseDateString(dateStr);
  return WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

// The offset (ms) between the given zone's wall-clock reading of `instant` and
// the instant itself: `wallClockAsUTC - instant`. Positive east of UTC.
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  // `hour` can come back as 24 at midnight in some engines; normalize to 0.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    parts.minute,
    parts.second,
  );
  return asUTC - instant.getTime();
}

/**
 * Convert a wall-clock local time (a calendar date + minutes-since-midnight in
 * `timeZone`) to the UTC instant it denotes. Double-adjusts so the offset is
 * evaluated at the true instant, which resolves DST transitions.
 */
export function zonedWallClockToInstant(
  dateStr: string,
  minutesOfDay: number,
  timeZone: string,
): Date {
  const { year, month, day } = parseDateString(dateStr);
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const guessUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = zoneOffsetMs(new Date(guessUTC), timeZone);
  const offset2 = zoneOffsetMs(new Date(guessUTC - offset1), timeZone);
  return new Date(guessUTC - offset2);
}

/** The calendar date `YYYY-MM-DD` an instant falls on in `timeZone`. */
export function dateInZone(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA formats as YYYY-MM-DD.
  return dtf.format(instant);
}

/** A human, timezone-aware label for an instant, e.g. for emails. */
export function formatInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}
