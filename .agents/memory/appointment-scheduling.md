---
name: Appointment scheduling — Google Calendar integration + design decisions
description: Real-time appointment booking backed by Google Calendar free/busy (conflicts) + a working-hours grid (a Postgres table) edited on the studio dashboard, writing each booking as a calendar event via a Workspace service account with domain-wide delegation. Records the setup and the trust/timezone rules.
---

The site lets customers book appointments (consultations, fittings, design
reviews, general) with a staff member in real time — picking an actual open slot.
Scheduling runs on **Google Calendar**, the tool the staff already use. (An
earlier version used two Notion databases for availability + bookings; the
atelier found the availability database cumbersome, so it was replaced — blocking
time off is now just adding a calendar event.)

## The model: positive grid (config) minus busy (Google)

`computeSlots` (`lib/appointments/availability.ts`, pure + unit-tested) builds
slots from a **positive** weekly working-hours grid and **subtracts** busy
intervals. Google free/busy only provides the subtractive half (when someone is
busy), so the two halves come from two places:

- **Working hours (positive grid)** → the **`staff_availability` Postgres table**
  (`supabase/migrations/0002_staff_availability.sql`), edited on `/studio` →
  **Working hours**. Read through `lib/appointments/schedule.ts` (the seam) over
  `lib/db/staff-availability.repository.ts` (60s cache + fallback) and mapped by
  the pure `buildSchedule` in `lib/appointments/staff.ts`. One row is one block:
  staff, calendar email, weekdays, start/end `time`, locations. `staff` must be a
  catalog staff name — the editor enforces it now rather than failing silently.
  **This makes `POSTGRES_URL` required for booking**, unlike the rest of the
  Postgres layer. (History: an `APPOINTMENT_STAFF` JSON env var → a **Google
  Sheet** shared with the service account → a Notion database → this; see
  `staff-availability-dashboard.md`. Reading it is async either way —
  `getScheduleConfig`/`calendarEmailFor` are async.)
- **Busy (subtractive)** → the Google **FreeBusy API** per staff calendar
  (`lib/google/calendar.repository.ts` → `listBusyInRange`), fed into
  `computeSlots` as `bookings`. Because booked appointments are themselves
  calendar events, and a day off / personal commitment is any calendar event,
  everything busy is subtracted uniformly. `timeOff` is always `[]`.

## Auth: Workspace service account + domain-wide delegation

`lib/google/client.ts` uses `google-auth-library` to mint an access token that
**impersonates** each staff member (`JWT({ subject: staffEmail })`) — this is
what lets the server read their free/busy, write an event on their calendar,
invite the customer as a real attendee (`sendUpdates=all`), and create a Google
Meet link for virtual bookings (`conferenceData`). Token minting is the only use
of the library; calendar calls are raw `fetch`, mirroring the Notion adapter.
The client is injectable (`GoogleCalendarClient`) so tests pass a fake.

Setup the atelier must do once:

1. GCP project → enable the **Google Calendar API** → create a **service
   account** + JSON key → set `GOOGLE_SERVICE_ACCOUNT_KEY`.
2. Workspace **Admin → Security → API controls → Domain-wide delegation**:
   authorize the service account's client id for scope
   `https://www.googleapis.com/auth/calendar` (calendar impersonation only).
3. Run `db:migrate` to create the `staff_availability` table, set `POSTGRES_URL`,
   and enter the hours on `/studio` → Working hours.

## Load-bearing rules (don't regress these)

- **The type catalog stays in code** (`lib/appointments/catalog.ts`): the four
  types, durations, and routing (consultations: Alayna only; fittings, design
  reviews, general: either Alexandra or Alayna; fittings in-person only). Targeted business rule, like
  `STATUS_IN_STOCK`. Staff `name`s here are the list the working-hours editor
  offers and validates against, so the two can't drift.
- **Never trust a client-sent slot.** `POST /appointments` re-runs the same
  `computeSlots` with **fresh** free/busy for the requested day before writing;
  a `start` that isn't currently open → `BadRequestError` (400). One function
  powers availability + the booking re-check, so they can't disagree. No caching
  of free/busy.
- **Timezone.** Working hours + slot times are wall-clock in `APPOINTMENT_TIMEZONE`
  (default `America/Chicago`); busy/bookings are UTC instants. `time.ts` does the
  DST-correct conversion via `Intl`. Keep the pure unit tests green when touching
  slot math.
- **Free to book, no hold.** No payment, no pending reservation; two simultaneous
  bookings of the same slot is an accepted low-volume race.
- **Emails are best-effort** (Resend, `appointments` category), same as the other
  endpoints — a mail failure never fails the booking. Google also sends its own
  calendar invite (a nice second confirmation).
- **Google Calendar is the sole record** — there is no Notion appointments
  database. If you ever want an atelier inbox row too, dual-write in
  `bookAppointment` after `createCalendarEvent`.
