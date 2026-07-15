---
name: Appointment scheduling — Notion databases + design decisions
description: Real-time appointment booking with no external calendar; availability is computed server-side from two Notion databases the atelier must create, plus a code-side type catalog. Records the schema and the trust/timezone rules.
---

The site lets customers book appointments (consultations, fittings, design
reviews, general) with a staff member in real time — picking an actual open slot,
not requesting a preferred time. There is deliberately **no** external calendar
integration (Google Calendar / Cal.com were considered and rejected to stay
consistent with the all-in-Notion, no-extra-accounts model). Availability is
computed in-app.

## What the atelier must set up in Notion (two new databases)

Both must be shared with the integration or queries 404 (the same rule as every
other database here). Env: `NOTION_AVAILABILITY_DATABASE_ID`,
`NOTION_APPOINTMENTS_DATABASE_ID`.

**1. "Staff Availability"** — the live-editable schedule. Property names/types
(see `api-server/src/lib/notion/availability.schema.ts`):

- `Staff` (select) — option values MUST match the staff names in
  `lib/appointments/catalog.ts` (currently `Alexandra`, `Alayna`).
- `Kind` (select) — `Weekly hours` or `Time off` (discriminates the row).
- `Day` (select) — long weekday name (`Monday`…`Sunday`) — weekly-hours rows.
- `Start time` / `End time` (rich_text) — `HH:MM` 24h, e.g. `09:00` / `17:00`.
- `Locations` (multi_select) — `In person` / `Virtual` (parsed case/spacing/
  hyphen-insensitively) — which formats that block supports.
- `Date` (date, single or range) — time-off rows (blocks whole local days).
- `Active` (checkbox) — only ticked rows are read.

**2. "Appointments"** — the booked rows the server writes (properties in
`appointments.blocks.ts`): `Name` (title), `Customer name` (rich_text), `Email`
(email), `Phone` (phone_number), `Appointment type` (select), `Staff` (select),
`Location` (select), `Start` / `End` (date **with time**), `Status` (select,
default `Booked`; a `Cancelled` row frees its slot), `Confirmation code`
(rich_text), `Notes` (rich_text), `Preferred contact` (select).

## Why the type catalog is in code, not Notion

The four appointment types, their durations, and their routing rules (Alayna:
consultations + design reviews; Alexandra: everything; fittings in-person only)
live in `lib/appointments/catalog.ts`, **not** a Notion database. This is the
same "targeted business rule" exception as `STATUS_IN_STOCK` / `SIZED_CATEGORIES`:
these values are coupled to code (duration drives the slot math; allowed
staff/locations drive the UI and server validation), so they aren't a
free-floating option list. The *schedule* (when each person works) is what's
genuinely live-editable, and that's the Notion database above. Renaming a staff
member or adding a type is a code change (and must be mirrored in the "Staff"
option values).

## Load-bearing rules (don't regress these)

- **Never trust a client-sent slot.** `POST /appointments` re-derives the type
  from the catalog and re-runs the *same* `computeSlots` used by the availability
  endpoint for the requested day before writing. A `start` that isn't currently
  open (stale, taken, off-grid, or inside the lead-time window) → `BadRequestError`
  (400). One function powers both paths so they can't disagree. Bookings are read
  **fresh** (no TTL cache) so a just-taken slot isn't offered again.
- **Timezone.** All working hours and offered slot times are wall-clock in
  `APPOINTMENT_TIMEZONE` (default `America/New_York`); bookings are stored/compared
  as UTC instants. `lib/appointments/time.ts` does the DST-correct conversion via
  `Intl` (no date library). If you touch slot math, keep the pure unit tests
  (`test/unit/appointments.*.test.ts`) green — they pin the DST and overlap edges.
- **Free to book, no hold.** v1 has no payment and no pending reservation, so two
  simultaneous bookings of the same slot is an accepted low-volume race. Adding a
  booking fee would reuse the Stripe deposit pattern and require holding the slot.
- **Emails are best-effort** (Resend, `appointments` category with per-category
  address overrides), exactly like the order/contact/notify endpoints — a mail
  failure never fails the booking.
