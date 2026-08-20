---
name: Staff availability moved onto the studio dashboard (and then into Postgres)
description: The standing working-hours grid moved from a Google Sheet to a typed editor on /studio — retiring the Sheets adapter, the Sheets API + scope, the service-account share, and APPOINTMENT_SHEET_ID/_RANGE. It landed in a Notion database first (PR #191) and moved to the `staff_availability` Postgres table days later; records why the second move, why booking now REQUIRES POSTGRES_URL, and why the swap cost two files (the `lib/appointments/schedule.ts` seam).
---

Roadmap card: **"Staff availability on the studio dashboard"** (rank 16,
Product + Workspace / Consolidation). "Move the schedule into the dashboard
behind a typed editor, retiring the Sheets adapter, the Sheets API and the
service-account share."

## What the sheet actually cost

Not the editing — the sheet was genuinely easy to edit, which is why it replaced
an `APPOINTMENT_STAFF` JSON env var in the first place. What it cost was that
**nothing checked it**. A staff name that didn't match the appointment catalog,
an end time before a start, a location spelled some other way: each produced no
error, no log, and no hours. The day just stopped being offered, and the only
symptom was a customer not seeing slots. Add a second vendor (Sheets API +
scope), a second share (the sheet, with the service account, separately from the
Calendar delegation), and a second place to look when hours are wrong.

## Where it lives now: `staff_availability` (Postgres)

`supabase/migrations/0002_staff_availability.sql` — staff, calendar email
(`citext`), `weekdays text[]`, `start_time`/`end_time` (`time`), `locations
text[]`, with `check (end_time > start_time)` and `<@` array constraints on the
weekday/location values. Edited at `/studio` → **Working hours** through four
staff-gated routes.

**It shipped in Notion first, and that was the wrong call.** PR #191 put it in a
"Staff Availability" Notion database, for consistency with stages, categories,
and Studio Settings. The distinction that argument missed: those are things the
atelier manages **as part of its own Notion workflow**, whereas nobody has a
reason to open this one — the dashboard is the only writer and the slot
calculator the only reader. It was app config wearing a Notion costume. Moving
it to Postgres bought:

- **The rules live in the DDL**, not only in the service: real `time` columns
  instead of `HH:MM` `rich_text` (Notion has no time-of-day property), and
  inverted hours that are _unrepresentable_ rather than merely refused.
- **No hand-edit drift.** The Notion version needed a tolerant mapper (`Mon` →
  Monday, `In person` → `in-person`) and a UI that showed a row as _what it will
  actually do_, purely because a Notion row can be typed into. The mapper is kept
  as belt-and-braces (it's pure and already tested), but nothing depends on it.
- **Notion off the booking path** — a few hundred ms per read and a ~3 req/s
  rate limit, on a page a customer waits on.

**What Notion had that Postgres doesn't: a fallback editor.** If `/studio` is
down, or the staff gate locks someone out (allowlist + Google `amr` + 2SV — see
`studio-dashboard-access.md`, it has bitten), hours were still fixable by hand in
Notion. Now they are not. That was the real trade, and it was made deliberately.

## `POSTGRES_URL` is now required for booking

The rest of `lib/db/` is optional and degrade-safe — unset ⇒ `postgresConfigured()`
is false and callers fall back (Stripe dedup → Notion read-before-write, the
portal → Notion by-email). **The working hours have no fallback**, so
`listStaffAvailability` **throws a pointed error** when the layer is
unconfigured, the same contract the Notion database and `APPOINTMENT_SHEET_ID`
before it had: "no working hours" and "no configuration" look identical from the
booking page and only one of them is a bug. An **empty** table is legitimate and
the editor says so plainly. This is the one place the layer's optionality is
qualified — say so when documenting it.

## Why the swap was cheap, and what to reuse

`lib/appointments/schedule.ts` — the seam `getScheduleConfig`/`calendarEmailFor`
read through — meant the Calendar adapter, the four routes, the OpenAPI contract,
the service's validation, and the **entire editor component** were untouched by a
change of storage engine. The swap was one migration, one repository, and their
tests. Keep the seam if this ever moves again.

Also load-bearing in the repository:

- **60s TTL cache + fall-back-to-cache-on-error**, kept from the earlier homes:
  the schedule changes rarely and is read on every availability query and booking
  re-check, so a database blip should mean _slightly stale hours_, not _none_.
  Writes bust it (saving hours and not seeing them for a minute reads as a failed
  save).
- **`entryId` is screened against a UUID regex before querying.** `id` is a
  `uuid` column, so `where id = 'nonsense'` is a driver error, not an empty
  result — without the guard a junk id is a 500 where the caller means 404.
- Locations are stored as **ids** (`in-person`), not the display labels the
  Notion version used; nothing reads the table by hand any more.

## Still true regardless of storage

- **A day off is a Google Calendar event.** This table is the standing week;
  `timeOff` is permanently `[]` and every exception comes from FreeBusy.
- **The appointment catalog stays in code** (types, durations, who offers what).
  The editor reads its staff list from it, which is what makes "a name the studio
  doesn't book" a refusal rather than a silently dead row — and why a **rename in
  the catalog** still orphans rows, which the dashboard groups under "No longer
  booked".
- The **service** owns the four validation rules and their wording; the dashboard
  renders the server's message verbatim.

## One-time atelier steps

1. Run the **DB migrate** GitHub Action (`workflow_dispatch`, needs the
   `POSTGRES_URL_NON_POOLING` repo secret) to create the table.
2. Make sure `POSTGRES_URL` is set for the environment — **per environment** on
   Vercel; the studio-dashboard note records that trap.
3. Enter the hours at `/studio` → Working hours. **Until then booking offers no
   slots** — that is this change's visible failure mode, so do it in the same
   sitting as the deploy.
4. Clean up the retired vendor: delete `APPOINTMENT_SHEET_ID` /
   `APPOINTMENT_SHEET_RANGE` from Vercel, disable the **Sheets API** on the
   Google Cloud project, unshare the sheet from the service-account email. If the
   interim Notion "Staff Availability" database was created, it is now unused —
   delete it and drop `NOTION_STAFF_AVAILABILITY_DATABASE_ID`.
