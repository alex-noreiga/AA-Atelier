---
name: Staff availability — from a Google Sheet, to Notion, to our own Postgres table
description: The standing working-hours grid moved out of a Google Sheet into a "Staff Availability" Notion database behind a typed editor on /studio, and then out of Notion into the staff_availability Postgres table. Records what the sheet cost, why the original "Notion not Postgres" call was reversed, that appointment booking now hard-requires POSTGRES_URL, and the one-time steps (re-type the rows; there is deliberately no importer, either time).
---

Two roadmap cards, in sequence. First **"Staff availability on the studio
dashboard"** (rank 16, Product + Workspace / Consolidation) moved the schedule
off a Google Sheet and behind a typed editor. Then a follow-up moved the storage
again, from Notion into our own Postgres table. The editor is the same; only the
store underneath it changed.

## What the sheet actually cost

Not the editing — the sheet was genuinely easy to edit, which is why it replaced
an `APPOINTMENT_STAFF` JSON env var in the first place. What it cost was that
**nothing checked it**. A staff name that didn't match the appointment catalog,
an end time before a start, a location spelled some other way: each produced no
error, no log, and no hours. The day just stopped being offered, and the only
symptom was a customer not seeing slots. Add a second vendor (Sheets API +
scope), a second share (the sheet, with the service account, separately from the
Calendar delegation), and a second place to look when hours are wrong.

**That diagnosis is the durable part of this note.** The typed, validating editor
is what fixed it, and it survived both storage moves untouched.

## Where it lives now

The **`staff_availability` Postgres table** (`supabase/migrations/0004_staff_availability.sql`),
edited at `/studio` → **Working hours** through the same four staff-gated routes.
No env var of its own — it rides the `POSTGRES_URL` the Supabase integration
already provides.

## Why the original "Notion, not Postgres" call was reversed

The first version of this note argued: _"The Postgres layer is optional and holds
only app-owned integrity facts; booking's positive grid is neither. Notion is the
workspace the atelier already edits… it keeps 'no database of our own for
atelier-editable config' intact."_

Both halves stopped being true the moment the dashboard editor shipped:

- **"Atelier-editable config" stopped meaning "edited in Notion."** The whole
  point of the first card was that the atelier edits hours in the _app_, behind
  validation. Nobody opened the Notion database — and anyone who did was
  hand-editing past the validation, which is why the mapper had to stay tolerant
  and the dashboard had to render rows as _what they will actually do_. The
  live-read + 60s cache shape it was chosen for is a property of the repository,
  not of Notion; it moved across unchanged.
- **"Not an app-owned fact" was wrong.** The schedule is written by our editor,
  validated by our service, read by our slot calculator, and consumed by nothing
  else. Notion is the record for what the _atelier_ manages by hand — orders,
  inventory, invoices, all things with a life outside the app. The working hours
  have none.

What we bought: the vocabularies and the `end > start` rule are now **check
constraints the database enforces**, not just service-side validation a hand-run
`update` could bypass; `start_time`/`end_time` are real `time` columns instead of
`HH:MM` text (Notion has no time property — the old note's "why the times are
rich_text" reasoning was a workaround, not a preference); and the atelier's setup
dropped from _create a database, add six properties, share the integration, set
an env var_ to _nothing_.

## The cost, and it is a real one

**Appointment booking now hard-requires `POSTGRES_URL`.** Every other table in
`lib/db/` is an optional integrity layer with a Notion fallback; this one is the
record, so there is nothing to fall back to. The repository throws a pointed
error naming the schedule rather than returning an empty grid, for the same
reason the Notion and Sheet versions did: "no working hours" and "no
configuration" look identical from the booking page and only one is a bug.

The `restock_alerts` table set this precedent one card earlier, so Postgres was
already load-bearing for a shipped feature — this is the second, not the first.
The Postgres section of CLAUDE.md now says so up front instead of calling the
whole layer optional.

## Tolerant reads, strict writes — kept

`buildSchedule` still accepts `Mon` for Monday and `In person` for `in-person`,
and skips an entry it can't make sense of rather than dropping everyone's hours.
The check constraints make malformed rows much harder to introduce now, but the
tolerance predates them, costs nothing, and covers the legacy label spelling the
Notion version wrote. Locations are stored as canonical **ids** now — the Notion
version stored display labels ("In person") so the row read nicely in the Notion
UI, which no longer buys anything.

## Code shape

- `lib/db/staff-availability.repository.ts` — list / create / update / delete.
  Owns the 60s cache and **busts it on every write** (saving hours and not seeing
  them for a minute reads as a failed save). Screens a malformed `entryId` to a
  404 rather than letting Postgres reject it as a uuid parse error → 500.
- `lib/appointments/schedule.ts` — the seam `getStaffSchedule` /
  `calendarEmailFor` read through. **This is why the storage could move twice
  without `lib/google/calendar.repository.ts` or any appointment service
  noticing**: they ask the appointments domain, not a vendor adapter. Keep it if
  the storage ever moves again.
- `lib/appointments/staff.ts` — pure `buildSchedule(ScheduleEntry[])`. Unchanged
  by the Postgres move.
- `services/staff-availability.service.ts` — the four rules, each with a message
  the dashboard shows verbatim. Unchanged apart from storing location ids.
- `web-app/src/components/studio-availability.tsx` — unchanged; the contract is
  storage-agnostic (`id` is just a string), so **no generated code changed
  either**.

**Deleted with the Notion move:** `lib/notion/staff-availability.{schema,blocks,repository}.ts`,
`getStaffAvailabilityNotionClient`, and their tests.
**Deleted with the Sheets move, earlier:** `lib/google/sheets.repository.ts`,
`getGoogleSheetsClient` + the Sheets scope/base URL in `lib/google/client.ts`.
`google-auth-library` stays (Calendar impersonation).

## One-time atelier steps (after this deploys)

1. Run the migration once — `pnpm --filter @workspace/api-server db:migrate`, or
   the manual **Migrate** workflow on GitHub. Needs `POSTGRES_URL_NON_POOLING`.
2. **Re-type the rows** at `/studio` → Working hours. There is deliberately **no
   importer** — the same call as last time, and for the same reason: writing one
   means keeping the adapter this change deletes, to run it once, for a handful
   of rows.
3. Then clean up: delete `NOTION_STAFF_AVAILABILITY_DATABASE_ID` from Vercel and
   archive the **Staff Availability** Notion database.

**Until step 2 is done, booking offers no slots.** That is the visible failure
mode of this change, so do it in the same sitting as the deploy — and check
`/studio` → Working hours immediately after, which is also the fastest way to
confirm step 1 landed (an unmigrated or unset database shows the error state, an
empty one shows "no appointment times are being offered").

## Not changed

A day off is still a Google Calendar event, `timeOff` is still permanently `[]`,
and the appointment **catalog** (types, durations, who offers what) is still a
targeted business rule in code. The editor still reads its staff list from that
catalog, which is what makes "a name the studio doesn't book" a refusal rather
than a silently dead row.
