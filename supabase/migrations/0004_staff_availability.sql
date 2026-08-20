-- 0004_staff_availability.sql — the studio's standing working hours.
--
-- One row is one recurring block of hours for one person: who, which calendar,
-- which weekdays, from when to when, and which locations may be booked in it.
-- This is the POSITIVE availability grid `computeSlots` starts from, before it
-- subtracts whatever Google Calendar says that person is busy with. A day off
-- is a calendar event, not a row here.
--
-- It has lived in three places now: a Google Sheet, then a Notion database, and
-- now here. The first two were both chosen so the atelier could edit hours
-- without a redeploy — but once the studio dashboard grew its own editor
-- (`/studio` → Working hours), that reason evaporated: the atelier edits the
-- schedule in the app, and the third-party database was left holding data the
-- app both owns and validates. Notion is the record for things the ATELIER
-- manages by hand (orders, inventory, invoices); this is not one of them.
--
-- Note what this changes about the Postgres layer's "optional" contract (see
-- 0001's header). Every other table here is degrade-safe — unset `POSTGRES_URL`
-- and the app falls back to a Notion path. This one has no fallback, because
-- there is no longer a second store: appointment booking now REQUIRES Postgres.
-- That is the deliberate trade for a single, validated, app-owned schedule.
--
-- Times are stored as `time` rather than the `HH:MM` text Notion had to use.
-- Notion has no time-of-day property, so text was forced there; Postgres does,
-- so the range check below can be a real constraint the database enforces
-- instead of a rule the service has to remember. Weekdays and locations are
-- `text[]`, checked against the canonical vocabularies — the app writes them
-- canonically, and the constraint is what stops a hand-run `update` from
-- introducing a value the slot calculator would silently skip.

create table staff_availability (
  id             uuid primary key default gen_random_uuid(),
  staff          text not null check (length(trim(staff)) > 0),
  calendar_email citext not null,
  weekdays       text[] not null check (
                   cardinality(weekdays) > 0
                   and weekdays <@ array[
                     'Monday','Tuesday','Wednesday',
                     'Thursday','Friday','Saturday','Sunday'
                   ]::text[]
                 ),
  start_time     time not null,
  end_time       time not null,
  locations      text[] not null check (
                   cardinality(locations) > 0
                   and locations <@ array['in-person','virtual']::text[]
                 ),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- The one rule a spreadsheet could never enforce and the service had to check
  -- by hand: a block that ends before it begins produces no bookable time at all.
  constraint staff_availability_range check (end_time > start_time)
);

-- The schedule is read whole on every availability query and every booking
-- re-check, ordered by staff. Small table, but the index keeps the sort free.
create index staff_availability_staff_idx on staff_availability (staff);

-- Same lock-down as 0002 applies to every other table: Supabase serves `public`
-- through PostgREST and the `anon` key ships in the browser bundle, so a table
-- left open would let anyone read the studio's staffing pattern and calendar
-- addresses — or forge hours to open slots that were never offered. Both layers,
-- for the same reason as 0002: RLS with no policies denies every row to
-- non-owner roles, and the revoke holds even if RLS is later disabled. The app
-- connects as the owning `postgres` role, which bypasses both.
alter table public.staff_availability enable row level security;
revoke all on public.staff_availability from anon, authenticated;
