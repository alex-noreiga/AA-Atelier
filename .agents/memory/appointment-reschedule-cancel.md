# Self-service appointment reschedule & cancel (Phase 2)

Lets a customer reschedule or cancel a booked appointment from a link in their
confirmation email — no sign-in, no phone call — freeing the slot automatically.
Builds on the Google Calendar integration (adds get/update/delete alongside the
existing event insert) and the HMAC token helpers the account portal already uses.
The **day-before reminder email** in the same roadmap card is a deliberate
fast-follow (needs a new cron + an `events.list`-by-window) and was **not** built
here — see "Deferred" below.

## The core problem it solves

There is **no appointments database** — a booking exists only as an event on the
staff member's Google Calendar (`.agents/memory/appointment-scheduling.md`). And
the booking flow used to **throw the event id away** (`createCalendarEvent`
returned only the Meet + calendar links). So a customer had no durable handle to
act on; the confirmation email/success screen just said "reply to this email to
change or cancel". This feature captures the event id and hands the customer a
signed link that carries it.

## How it's shaped

1. **Signed token = the authorization** (the same possession-is-proof idea a magic
   link used). At booking, `bookAppointment` mints an `"appointment"`-purpose token
   (`lib/auth/tokens.ts` — now this is the **only** token purpose, since sign-in
   moved to Supabase Auth; carries optional `eventId`/`staff` claims,
   `APPOINTMENT_MANAGE_TTL_SECONDS` = 60 days) carrying `{ email, eventId, staff }`,
   and embeds it in a `${PUBLIC_BASE_URL}/appointments/manage?token=…` link in the
   confirmation email. `verifyToken` returns the `eventId`/`staff` claims alongside
   the email. Possession of the link is the auth — no cookie,
   no account. Gated on `authConfigured()` + `PUBLIC_BASE_URL`; unset ⇒ no link and
   the email falls back to the old "reply to us" copy (`buildManageUrl` returns
   undefined), so the feature is inert-safe exactly like the portal.

2. **The calendar event is the record — read live, never trust the token's copy.**
   `lib/google/calendar.repository.ts` gained `getCalendarEvent` (GET, 404/410 ⇒
   null), `updateCalendarEvent` (PATCH start/end, a merge so attendees/description/
   Meet/extended-props survive), and `cancelCalendarEvent` (DELETE, 404/410 treated
   as success = idempotent), all `sendUpdates=all` so Google re-notifies the
   customer and (for cancel/reschedule) frees the slot in free/busy. `createCalendarEvent`
   now returns the event `id` and stamps **private `extendedProperties`**
   (`aptType`/`aptLocation`/`aptConfirmation`/`aptEmail`/`aptName`, the `EVENT_PROP_*`
   consts) so the event is self-describing for a later reschedule/cancel without
   parsing description text.

3. **Reschedule re-runs the same `computeSlots`** as booking (`services/appointment-manage.service.ts`),
   **locked to the same type/location/staff** (a reschedule is a _move_, so the
   event stays on that staff member's calendar — PATCH can't move calendars). Known
   limitation: because the current booking counts as busy, a new time overlapping
   the old one isn't offered (the customer picks a clearly different slot). Gated:
   404 if the event is gone, 409 if it's already started/cancelled, 400 if the
   requested slot isn't currently open.

4. **Contract-first, unlike the webhook/cron routes.** The three endpoints are in
   `openapi.yaml` (`GET /appointments/manage`, `POST /appointments/reschedule`,
   `POST /appointments/cancel`) with generated hooks — they're ordinary SPA JSON
   calls, so no reason to hand-mount them. `AppointmentDetails` carries `timezone`
   so the manage page can render times in the atelier zone without a second options
   fetch. Frontend: `pages/appointment-manage.tsx` (`/appointments/manage`), reusing
   the booking page's slot picker via extracted `lib/appointment-format.ts` helpers;
   cancel uses an **inline confirm** (no new `alert-dialog` dependency).

5. **Emails: best-effort, appointments sender, customer + atelier.** New builders in
   `lib/resend/emails.ts`: `appointmentRescheduledEmail`, `appointmentCancelledEmail`,
   `appointmentChangeNotificationEmail(details, to, "rescheduled"|"cancelled")`, and
   a `manageUrl` added to `AppointmentEmailDetails` (the confirmation email's new
   "Reschedule or cancel" button). Same best-effort contract as every appointment
   mail — a Resend failure never fails the action; Google's own invite update is a
   second confirmation.

## No new env vars / no atelier setup

Reuses `SESSION_SECRET` (token signing — now its **only** remaining use, after
sign-in moved to Supabase Auth), `PUBLIC_BASE_URL` (the link origin — same as
Stripe/Supabase redirects), the Google service account, and the Resend appointment
sender. If `SESSION_SECRET`/`PUBLIC_BASE_URL` are unset the link
is simply omitted (reply-to-us fallback). Nothing to add in Notion or Google.

## Deferred (rest of the roadmap card)

- **Day-before reminder email.** Not built. Google Calendar is write + free/busy
  only today, so a reminder needs a **new cron** (`GET /api/cron/appointment-reminders`,
  CRON*SECRET) doing a net-new `events.list` over a `[now, now+lead]` window across
  staff calendars, filtering our appointment events (they carry the `EVENT_PROP*\*`private props + the customer email) that aren't reminded yet, sending the mail, and
  marking a per-event`aptReminded`extended property for idempotency (the analogue of
  the milestone`Reminder Sent` checkbox). The extended-property model added here is
  the groundwork for it.

## Files

- `lib/auth/tokens.ts` — `"appointment"` purpose + `eventId`/`staff` claims,
  `APPOINTMENT_MANAGE_TTL_SECONDS`.
- `lib/google/calendar.repository.ts` — event id + `extendedProperties` on create;
  `getCalendarEvent` / `updateCalendarEvent` / `cancelCalendarEvent`; `EVENT_PROP_*`.
- `services/appointment-manage.service.ts` — `buildManageUrl`, `getAppointmentForManage`,
  `rescheduleAppointment`, `cancelAppointment`.
- `services/appointments.service.ts` — passes `typeId` + mints the manage link on booking.
- `routes/appointments.ts` — the three manage routes (contract-validated).
- `lib/resend/emails.ts` — reschedule/cancel/change email builders + confirmation `manageUrl`.
- `web-app/src/pages/appointment-manage.tsx` + `lib/appointment-format.ts` (shared) +
  `App.tsx` route; booking success-screen copy updated.
- `openapi.yaml` → regenerated `lib/api-zod` + `lib/api-client-react`.
