-- 0002_staff_availability.sql — the studio's standing working hours.
--
-- The positive grid every offered appointment slot is computed from, before
-- Google free/busy subtracts what each staff member is busy with. It moved here
-- from a "Staff Availability" Notion database (and a Google Sheet before that),
-- because it is app-owned config, not something the atelier manages as part of
-- its own workspace: the studio dashboard is the only writer, and no other
-- Notion workflow reads it. See CLAUDE.md → "Staff availability".
--
-- What the move buys is in this DDL rather than in application code: `time`
-- columns instead of `HH:MM` text (Notion has no time property), an ordering
-- constraint that makes "ends before it starts" unrepresentable, and value
-- constraints on the weekday/location arrays so a row can't hold a day or a
-- location the slot calculator would silently skip.

create table staff_availability (
  id             uuid primary key default gen_random_uuid(),
  -- A name from the appointment catalog (lib/appointments/catalog.ts). Not an
  -- enum: the catalog is code, and a rename there shouldn't need a migration —
  -- the service validates the name on write, and the dashboard surfaces a row
  -- left behind by a rename instead of hiding it.
  staff          text not null check (length(btrim(staff)) > 0),
  -- The staff member's Google Workspace calendar; citext so it matches
  -- case-insensitively like `clients.email`.
  calendar_email citext not null check (length(btrim(calendar_email)) > 0),
  weekdays       text[] not null check (
                   cardinality(weekdays) > 0 and
                   weekdays <@ array[
                     'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                     'Friday', 'Saturday', 'Sunday'
                   ]::text[]
                 ),
  start_time     time not null,
  end_time       time not null,
  locations      text[] not null check (
                   cardinality(locations) > 0 and
                   locations <@ array['in-person', 'virtual']::text[]
                 ),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- The rule a spreadsheet could never hold: hours that end before they begin
  -- produced no error and no bookable time, silently.
  constraint staff_availability_hours_ordered check (end_time > start_time)
);

create index staff_availability_staff_idx on staff_availability (staff);
