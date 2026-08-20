// The studio's standing working hours — the positive grid `computeSlots` starts
// from. Read on every availability query and every booking re-check, written
// only by the studio dashboard's editor.
//
// This is the one Postgres table the app cannot degrade without: the other three
// hold facts that have a Notion fallback (payment dedup, the account portal's
// discovery index), whereas "no working hours" and "no database configured" look
// identical from the booking page and only one of them is a bug. So the read
// throws a pointed error when the layer isn't configured, rather than returning
// an empty schedule — the same contract the Notion database and the Google Sheet
// before it had.
//
// The short-TTL cache + fall-back-to-cache-on-error is kept from those earlier
// homes for the same reason: the schedule changes rarely and is read constantly,
// so a database blip should degrade booking to slightly stale hours rather than
// none. Writes bust it, because saving hours and not seeing them for another
// minute reads as the save having failed.

import { getDb, postgresConfigured, type DbClient } from "./client.js";
import { normalizeEmail } from "../email.js";
import type { ScheduleEntry } from "../appointments/staff.js";

const AVAILABILITY_CACHE_TTL_MS = 60_000;
let cached: { entries: StaffAvailabilityRow[]; fetchedAt: number } | null =
  null;

/** One stored block of hours: a schedule entry plus the id the editor works by. */
export interface StaffAvailabilityRow extends ScheduleEntry {
  id: string;
}

/** The row shape Postgres hands back (snake_case, `time` as `HH:MM:SS`). */
interface RawRow {
  id: string;
  staff: string;
  calendar_email: string;
  weekdays: string[];
  start_time: string;
  end_time: string;
  locations: string[];
}

// `id` is a uuid column, so a junk id in `where id = $1` is a driver error, not
// an empty result. Screening it here turns "no such entry" into the 404 the
// caller means instead of a 500.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS =
  "id, staff, calendar_email, weekdays, start_time, end_time, locations";

/** Postgres renders `time` as `HH:MM:SS`; the app speaks `HH:MM` throughout. */
function toClockTime(value: string): string {
  return String(value).slice(0, 5);
}

function toRow(raw: RawRow): StaffAvailabilityRow {
  return {
    id: raw.id,
    staff: raw.staff,
    email: raw.calendar_email,
    weekdays: raw.weekdays ?? [],
    start: toClockTime(raw.start_time),
    end: toClockTime(raw.end_time),
    locations: raw.locations ?? [],
  };
}

function assertConfigured(): void {
  if (!postgresConfigured()) {
    throw new Error(
      "POSTGRES_URL is not configured — the studio's working hours (and therefore appointment booking) need the Postgres layer",
    );
  }
}

/** Test seam — the module-level cache would otherwise leak between tests. */
export function __resetStaffAvailabilityCache(): void {
  cached = null;
}

/**
 * Every block of working hours on record, by staff then start time. Cached for
 * {@link AVAILABILITY_CACHE_TTL_MS}; on a database error, falls back to the
 * cached list, or rethrows if nothing has been read yet.
 */
export async function listStaffAvailability(
  db: DbClient = getDb(),
): Promise<StaffAvailabilityRow[]> {
  assertConfigured();

  if (cached && Date.now() - cached.fetchedAt < AVAILABILITY_CACHE_TTL_MS) {
    return cached.entries;
  }

  try {
    const rows = await db.query<RawRow>(
      `select ${COLUMNS} from staff_availability order by staff, start_time`,
    );
    const entries = rows.map(toRow);
    cached = { entries, fetchedAt: Date.now() };
    return entries;
  } catch (error) {
    if (cached) return cached.entries;
    throw error;
  }
}

/** Add one block of hours; returns it as stored, for the editor to render. */
export async function createStaffAvailability(
  entry: ScheduleEntry,
  db: DbClient = getDb(),
): Promise<StaffAvailabilityRow> {
  assertConfigured();

  const rows = await db.query<RawRow>(
    `insert into staff_availability
       (staff, calendar_email, weekdays, start_time, end_time, locations)
     values ($1, $2, $3, $4, $5, $6)
     returning ${COLUMNS}`,
    [
      entry.staff,
      normalizeEmail(entry.email),
      entry.weekdays,
      entry.start,
      entry.end,
      entry.locations,
    ],
  );

  cached = null;
  return toRow(rows[0]);
}

/**
 * Replace one block of hours. The whole entry is written, so a value the atelier
 * cleared in the editor is cleared here too. Returns null when no such row
 * exists — which the service turns into a 404, since the entry may have been
 * removed since the editor loaded it.
 */
export async function updateStaffAvailability(
  entryId: string,
  entry: ScheduleEntry,
  db: DbClient = getDb(),
): Promise<StaffAvailabilityRow | null> {
  assertConfigured();
  if (!UUID_RE.test(entryId)) return null;

  const rows = await db.query<RawRow>(
    `update staff_availability
        set staff = $2,
            calendar_email = $3,
            weekdays = $4,
            start_time = $5,
            end_time = $6,
            locations = $7,
            updated_at = now()
      where id = $1
      returning ${COLUMNS}`,
    [
      entryId,
      entry.staff,
      normalizeEmail(entry.email),
      entry.weekdays,
      entry.start,
      entry.end,
      entry.locations,
    ],
  );

  cached = null;
  return rows.length > 0 ? toRow(rows[0]) : null;
}

/**
 * Remove one block of hours. Returns false when there was nothing to remove (a
 * 404 for the caller), so a repeated delete is idempotent rather than an error.
 * Bookings already made inside these hours are untouched — they live on the
 * staff member's calendar, which this table never governed.
 */
export async function deleteStaffAvailability(
  entryId: string,
  db: DbClient = getDb(),
): Promise<boolean> {
  assertConfigured();
  if (!UUID_RE.test(entryId)) return false;

  const rows = await db.query<{ id: string }>(
    `delete from staff_availability where id = $1 returning id`,
    [entryId],
  );

  cached = null;
  return rows.length > 0;
}
