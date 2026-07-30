// Timezone-aware formatting for the appointment booking + manage pages. The
// atelier's IANA zone comes from the API (options/details), and every label is
// rendered in that zone so a customer in another timezone still sees the studio's
// local times. Shared so the booking flow and the reschedule flow can't drift.

/** "No preference" sentinel staff choice → omit `staff` on the request. */
export const NO_PREFERENCE = "__any__";

/** How far ahead the slot pickers look. */
export const WINDOW_DAYS = 21;

export const LOCATION_LABELS: Record<string, string> = {
  "in-person": "In person",
  virtual: "Virtual",
};

/** A stable per-day key (YYYY-MM-DD in the atelier zone) for grouping slots. */
export function fmtDateKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function fmtDayLabel(
  iso: string,
  tz: string,
): { weekday: string; date: string } {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(new Date(iso));
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
  return { weekday, date };
}

export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** Group ISO slot start-times by their local calendar date (atelier zone). */
export function groupSlotsByDate(
  slots: Array<{ start: string }>,
  tz: string,
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const slot of slots) {
    const key = fmtDateKey(slot.start, tz);
    const list = groups.get(key) ?? [];
    list.push(slot.start);
    groups.set(key, list);
  }
  return groups;
}
