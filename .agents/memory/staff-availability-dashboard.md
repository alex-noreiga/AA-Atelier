---
name: Staff availability moved onto the studio dashboard
description: The standing working-hours grid moved from a Google Sheet into a "Staff Availability" Notion database edited on /studio behind a typed, validating editor — retiring the Sheets adapter, the Sheets API + scope, the service-account share, and APPOINTMENT_SHEET_ID/_RANGE. Records why Notion (not Postgres), why the times are text, why the read is required-but-cached, and the one-time migration (re-type the rows; there is deliberately no importer).
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

## Where it lives now

A **"Staff Availability" Notion database** (`NOTION_STAFF_AVAILABILITY_DATABASE_ID`)
— `Staff` (title) | `Calendar Email` (email) | `Weekdays` (multi-select) |
`Start` (text) | `End` (text) | `Locations` (multi-select) — edited at `/studio`
→ **Working hours** through four staff-gated routes.

**Why Notion and not Postgres.** The Postgres layer is optional and holds only
app-owned integrity facts; booking's positive grid is neither. Notion is the
workspace the atelier already edits, it gives the same live-read + 60s cache +
fall-back-to-cache-on-error shape as stages / categories / Studio Settings, and
it keeps "no database of our own for atelier-editable config" intact. The
dashboard is still _the_ editor — the validation is what the card was about, not
the storage.

**Why the times are `rich_text`.** Notion has no time-of-day property. `10:00`
reads as a time in the Notion UI and parses with the same `parseTimeToMinutes`
every other clock value goes through; minutes-past-midnight as a number would be
tidier for the app and unreadable for the atelier.

**Why the read throws when unconfigured.** Every optional integration here
degrades to off; this one doesn't, because "no working hours" and "no database
configured" look identical from the booking page and only one is a bug. Same
contract `APPOINTMENT_SHEET_ID` had. An **empty** database is legitimate and the
editor says so plainly.

**Tolerant reads, strict writes.** The rows are ordinary Notion pages and can be
hand-edited there, so `buildSchedule` still accepts `Mon` for Monday and
`In person` for `in-person`, and skips an entry it can't make sense of rather
than dropping everyone's hours. The dashboard renders a hand-edited row as **what
it will actually do**, not what it says — so a typo in Notion is visible instead
of silent.

## Code shape

- `lib/notion/staff-availability.{schema,blocks,repository}.ts` — the usual
  per-domain trio. The repository owns the cache and **busts it on every write**
  (saving hours and not seeing them for a minute reads as a failed save).
- `lib/appointments/schedule.ts` — the seam `getScheduleConfig` /
  `calendarEmailFor` read through. This is why `lib/google/calendar.repository.ts`
  never learned that the storage changed: it asks the appointments domain, not a
  vendor adapter. Worth keeping if the storage ever moves again.
- `lib/appointments/staff.ts` — `parseScheduleRows(ScheduleRow[])` became the
  pure `buildSchedule(ScheduleEntry[])`; the day-range/comma-list parsing went
  with the sheet (multi-select gives a real list), the normalizers stayed.
- `services/staff-availability.service.ts` — the four rules the sheet couldn't
  enforce, each with a message the dashboard shows verbatim.
- `web-app/src/components/studio-availability.tsx` — staff as a picker fed by the
  server's own list, days/locations as toggles, times as `time` inputs, so most
  refusals are unreachable from the UI at all.

**Deleted:** `lib/google/sheets.repository.ts`, `getGoogleSheetsClient` + the
Sheets scope/base URL in `lib/google/client.ts`, and their tests. `google-auth-library`
stays (Calendar impersonation).

## One-time atelier steps (after this deploys)

1. Create the **Staff Availability** database with the six properties above and
   connect the atelier's Notion integration to it.
2. Set `NOTION_STAFF_AVAILABILITY_DATABASE_ID` in Vercel (**per environment** —
   the studio-dashboard note records that trap) and redeploy.
3. **Re-type the rows from the old sheet** at `/studio` → Working hours. There is
   deliberately **no importer**: writing one would mean keeping the Sheets
   adapter, the API, and the share that this card retired, to run once. It is a
   handful of rows.
4. Then clean up: delete `APPOINTMENT_SHEET_ID` / `APPOINTMENT_SHEET_RANGE` from
   Vercel, disable the **Sheets API** on the Google Cloud project, and unshare the
   sheet from the service-account email.

**Until step 3 is done, booking offers no slots.** That is the visible failure
mode of this change, so do it in the same sitting as the deploy — and check
`/studio` → Working hours immediately after, which is also the fastest way to
confirm step 1 and 2 landed (an unshared or unset database shows the error state,
an empty one shows "no appointment times are being offered").

## Not changed

A day off is still a Google Calendar event, `timeOff` is still permanently `[]`,
and the appointment **catalog** (types, durations, who offers what) is still a
targeted business rule in code. The editor now reads its staff list from that
catalog, which is what makes "a name the studio doesn't book" a refusal rather
than a silently dead row.
