// Reads and writes `staff_availability` — the studio's standing working hours,
// edited on the studio dashboard (`/studio` → Working hours).
//
// This is the one table in `lib/db/` that is not an optional integrity layer
// over a Notion record: it IS the record. The schedule used to live in a Google
// Sheet, then a Notion database, both chosen so the atelier could edit hours
// without a redeploy. The dashboard's editor made that moot — the hours are
// entered in the app, validated by the app, and read by nothing but the app, so
// the third-party store was carrying data it had no stake in. Consequence to
// know: appointment booking now REQUIRES `POSTGRES_URL`, where every other
// caller in this directory degrades to a Notion fallback when it is unset.
//
// The read keeps the short-TTL cache + fall-back-to-cache-on-error shape the
// Notion and Sheets adapters before it had, for the same reason: the schedule
// changes rarely but is read on every availability query and every booking
// re-check, so a database blip must degrade to slightly stale hours rather than
// an empty calendar. The writes bust that cache, because the atelier editing
// hours and then not seeing them for another minute reads as the save failing.
// The cache is per-instance, so a write on one warm serverless instance doesn't
// bust another's — the same tradeoff the Notion version had, bounded by the TTL.

import { getDb, postgresConfigured, type DbClient } from "./client.js";
import type { ScheduleEntry } from "../appointments/staff.js";

/** One block of hours plus the id the editor updates/removes it by. */
export interface StaffAvailabilityRecord extends ScheduleEntry {
  id: string;
}

const AVAILABILITY_CACHE_TTL_MS = 60_000;
let cached: { records: StaffAvailabilityRecord[]; fetchedAt: number } | null =
  null;

/** Test seam — the module-level cache would otherwise leak between tests. */
export function __resetStaffAvailabilityCache(): void {
  cached = null;
}

/**
 * Resolve the client to use, failing first with a pointed message when Postgres
 * isn't configured. This has to *resolve* the client rather than just check,
 * because a `db: DbClient = getDb()` default parameter is evaluated BEFORE the
 * function body — so `getDb()` would throw its bare "POSTGRES_URL environment
 * variable is not set" and this message would never be reached on the very path
 * it exists for. An injected client (tests) skips the check: it is a database by
 * definition.
 */
function assertConfigured(db?: DbClient): DbClient {
  if (db) return db;
  if (!postgresConfigured()) {
    throw new Error(
      "POSTGRES_URL is not configured — the staff working hours the appointment " +
        "slot calculator reads are stored in Postgres, so booking cannot be offered without it",
    );
  }
  return getDb();
}

// `id` is a uuid column, so a malformed id is a *parse* error (22P02) rather
// than a miss — which would surface as a 500 where the caller wants the 404 it
// gets for an id that is merely gone. Screening here keeps "no such entry" a
// single answer no matter how wrong the id is.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The columns every read and write echoes back, in one place. */
const RETURNING = `id, staff, calendar_email, weekdays,
    to_char(start_time, 'HH24:MI') as start_time,
    to_char(end_time,   'HH24:MI') as end_time,
    locations`;

interface AvailabilityRow {
  id: string;
  staff: string;
  calendar_email: string;
  weekdays: string[] | null;
  start_time: string;
  end_time: string;
  locations: string[] | null;
}

/** Map a row to a domain record. Times are formatted to `HH:MM` in SQL, so the
 * driver's `time` representation ("10:00:00") never reaches the domain. */
function toRecord(row: AvailabilityRow): StaffAvailabilityRecord {
  return {
    id: row.id,
    staff: row.staff,
    email: row.calendar_email,
    weekdays: row.weekdays ?? [],
    start: row.start_time,
    end: row.end_time,
    locations: row.locations ?? [],
  };
}

/** The parameters of one entry, in the order every write below binds them. */
function writeParams(entry: ScheduleEntry): unknown[] {
  return [
    entry.staff,
    entry.email,
    entry.weekdays,
    entry.start,
    entry.end,
    entry.locations,
  ];
}

/**
 * Every block of working hours on record, ordered so the dashboard lists one
 * person's hours together. Cached for {@link AVAILABILITY_CACHE_TTL_MS}; on a
 * database error, falls back to the cached list, or rethrows if nothing has been
 * read yet — so an outage degrades booking to slightly stale hours rather than
 * no hours at all.
 */
export async function listStaffAvailability(
  db?: DbClient,
): Promise<StaffAvailabilityRecord[]> {
  const client = assertConfigured(db);

  if (cached && Date.now() - cached.fetchedAt < AVAILABILITY_CACHE_TTL_MS) {
    return cached.records;
  }

  try {
    const rows = await client.query<AvailabilityRow>(
      `select ${RETURNING}
         from staff_availability
        order by staff asc, start_time asc`,
    );
    const records = rows.map(toRecord);
    cached = { records, fetchedAt: Date.now() };
    return records;
  } catch (error) {
    if (cached) return cached.records;
    throw error;
  }
}

/** Create one block of hours; returns it as stored, for the editor to render. */
export async function createStaffAvailability(
  entry: ScheduleEntry,
  db?: DbClient,
): Promise<StaffAvailabilityRecord> {
  const client = assertConfigured(db);

  const rows = await client.query<AvailabilityRow>(
    `insert into staff_availability
       (staff, calendar_email, weekdays, start_time, end_time, locations)
     values ($1, $2, $3, $4::time, $5::time, $6)
     returning ${RETURNING}`,
    writeParams(entry),
  );

  cached = null;
  return toRecord(rows[0]);
}

/**
 * Replace one block of hours. The whole entry is written, so a value the atelier
 * cleared in the editor is cleared here too. Returns null when no such row
 * exists, which the service turns into a 404 — it may have been deleted from
 * another dashboard session since the editor loaded it.
 */
export async function updateStaffAvailability(
  entryId: string,
  entry: ScheduleEntry,
  db?: DbClient,
): Promise<StaffAvailabilityRecord | null> {
  const client = assertConfigured(db);
  if (!UUID_PATTERN.test(entryId)) return null;

  const rows = await client.query<AvailabilityRow>(
    `update staff_availability
        set staff = $1, calendar_email = $2, weekdays = $3,
            start_time = $4::time, end_time = $5::time, locations = $6,
            updated_at = now()
      where id = $7
     returning ${RETURNING}`,
    [...writeParams(entry), entryId],
  );

  if (rows.length === 0) return null;

  cached = null;
  return toRecord(rows[0]);
}

/**
 * Remove one block of hours. Unlike the Notion version this is a hard delete
 * rather than an archive — there is no workspace trash to restore from, and a
 * block of hours is a handful of fields the atelier can retype in seconds, which
 * is not worth an `archived_at` column every read would then have to filter on.
 * Returns false when no such row exists, so a repeated delete reads as a 404.
 */
export async function deleteStaffAvailability(
  entryId: string,
  db?: DbClient,
): Promise<boolean> {
  const client = assertConfigured(db);
  if (!UUID_PATTERN.test(entryId)) return false;

  const rows = await client.query<{ id: string }>(
    `delete from staff_availability where id = $1 returning id`,
    [entryId],
  );

  if (rows.length === 0) return false;

  cached = null;
  return true;
}
