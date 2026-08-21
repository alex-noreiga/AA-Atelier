# Day-before appointment reminders (roadmap card 01)

Emails a customer the day before a booked appointment, with the reschedule /
cancel link from their confirmation. This is the half of the "self-service
reschedule & cancel" roadmap card that was explicitly deferred — see the
"Deferred" section of `appointment-reschedule-cancel.md`, whose plan this
follows with one deliberate departure (below).

## The core problem it solves

A no-show costs studio time that was held open and can't be resold. Google
already sends its own calendar notifications, so the question was whether a
second reminder earns its place — it does, because Google's carries none of what
prevents the no-show: **the link that lets the customer move the appointment
instead of missing it**, the Meet link for a virtual fitting, and the
confirmation code. Google's notification also goes to whoever accepted the
invite, in whatever form their calendar is set to, which may be nothing at all.

## How it's shaped

1. **A sweep over a window, because there is no appointments database.** A
   booking exists only as a Google Calendar event, so there is nothing to hang a
   per-booking timer on. `notifyUpcomingAppointments`
   (`services/appointment-reminder.service.ts`) reads every appointment starting
   inside the window and reminds whoever is due. `listAppointmentsInRange`
   (`lib/google/calendar.repository.ts`) is the new read: one `events.list` per
   staff calendar, filtered **client-side** to events carrying the `aptEmail`
   stamp. It can't filter server-side the way `listUpcomingAppointmentsByEmail`
   does — repeating `privateExtendedProperty` ANDs the pairs, so there is no way
   to ask Google for "any `aptType`".

2. **The window is a calendar day, not a duration** (`lib/appointments/reminders.ts`,
   pure + unit-tested). `[now, end of the local day today+leadDays]`. A 24-hour
   cutoff would have been wrong in exactly the case the feature exists for: the
   nightly run fires around 3am studio time, so a 10am appointment tomorrow is
   ~31 hours out when the sweep sees it and a duration test would skip it. The
   window starting at `now` (rather than at midnight tomorrow) also means a
   missed nightly run degrades to a **late** reminder rather than none.
   `whenPhrase` renders "today" / "tomorrow" / "on Monday, August 24" so the copy
   reads right whatever `APPOINTMENT_REMINDER_LEAD_DAYS` is set to.

3. **The marker is a TIME, not a flag — and the event holds it.** After sending,
   `aptRemindedEmail` is stamped on the event with **the start instant that was
   reminded about**. Two things fall out of that shape rather than needing rules:
   a customer who **reschedules** after being reminded is reminded again (the
   marker stops matching the new `start`), and the feature needs **no table, no
   Notion property, and nothing to configure**. This is the departure from the
   deferred plan, which proposed a boolean `aptReminded`; a boolean would have
   silently suppressed the reminder for every rescheduled booking.

4. **Send, then mark.** The reverse of the back-in-stock sweep, deliberately.
   There, a lost marker means emailing the same person every night forever, so it
   claims first. Here the window closes on its own once the appointment passes,
   so a failed marker risks at most one duplicate — while marking first would
   risk losing the reminder this card exists to send. A marker failure is a
   `warn`, not a throw.

5. **It rides the nightly reconciliation, not a cron of its own.**
   `sendDueAppointmentReminders` is a fourth notification pass in
   `reconcileMilestones` (`services/schedule.service.ts`), alongside the fitting,
   payment and restock passes. The deferred plan called for
   `GET /api/cron/appointment-reminders`; the existing cron already fires at
   exactly the hour a day-before reminder wants (08:00 UTC = 3am Central), the
   project is on a Vercel plan where cron jobs are scarce, and the on-demand path
   the atelier already has — the dashboard's **Reconcile production milestones**
   tool — covers it for free. So no new endpoint, no new `vercel.json` entry, and
   no new studio tool.

6. **Quiet when unconfigured.** An install with no `GOOGLE_SERVICE_ACCOUNT_KEY`
   or no `POSTGRES_URL` (the working hours, hence the staff calendar list) reports
   `unconfigured` rather than throwing — this runs unattended nightly, and a
   configuration error thrown here would email the alert inbox every night about
   a feature the atelier never turned on.

## Groundwork for SMS (the roadmap's own later card)

The reminder is the natural first SMS, so this was built so that card is an
addition rather than a reshaping:

- **The phone number is stamped on the event now** (`aptPhone`, written by
  `createCalendarEvent`). Nothing reads it. It is there because it is the one
  piece that **cannot be retro-fitted**: an SMS channel added in a year can't put
  a number onto bookings already taken. Exactly the argument that made `aptEmail`
  load-bearing for the account portal later.
- **The marker is per-channel from the start** (`aptRemindedEmail` /
  `aptRemindedSms`, `reminderMarkerKey(channel)`). A single shared marker would
  mean every already-emailed booking was silently ineligible for its first text.
- **The window, the due test and the wording are transport-agnostic.**
  `lib/appointments/reminders.ts` knows nothing about email; the sweep composes
  the content and hands it to one sender. An SMS send drops in beside the email
  one in `remind()`.

What SMS still needs, and why it wasn't built here: **a vendor** (Twilio or
Resend's own, a new dependency + credentials + a per-message cost) and — the real
work — **an opt-in**. Marketing consent for texts is not the same permission as a
transactional email, and the booking form asks for neither today. `preferredContact`
is collected but is a "how should the atelier reach you", not consent to be texted.
That belongs with the Client CRM, next to the newsletter consent, not bolted onto
this sweep.

## No new env vars required, and no atelier setup

One optional knob, `APPOINTMENT_REMINDER_LEAD_DAYS` (default `1`), which is also a
Studio Setting so the atelier can retune it in Notion. Everything else is reused:
the Google service account, the Resend appointments sender, `SESSION_SECRET` +
`PUBLIC_BASE_URL` for the manage link (unset ⇒ the link is simply omitted and the
copy falls back to "reply to us", exactly as the confirmation email does). Nothing
to add in Notion or Google.

## Known limits

- **Bookings made before this shipped carry no `aptPhone`.** They are still
  reminded by email (which reads `aptEmail`, stamped since the reschedule work);
  only a future SMS would miss them.
- **A hand-made calendar entry is never reminded about.** The sweep only
  recognizes events this app booked (the `aptEmail` + `aptType` stamps), so an
  appointment the atelier types straight into Google gets Google's notification
  and nothing more.
- **One reminder per booking per start time.** There is no "and again an hour
  before" — that would need a second marker per channel, which the per-channel
  key scheme extends to cleanly if it is ever wanted.

## Files

- `lib/appointments/reminders.ts` — the pure policy (window, markers, due test,
  `whenPhrase`).
- `lib/appointments/settings.ts` — `reminderLeadDays()`; `lib/settings/store.ts`
  gains `APPOINTMENT_REMINDER_LEAD_DAYS`.
- `lib/google/calendar.repository.ts` — `listAppointmentsInRange`,
  `markAppointmentReminded`, the `aptPhone` stamp.
- `lib/google/client.ts` — `googleCalendarConfigured()`.
- `services/appointment-reminder.service.ts` — the sweep.
- `services/schedule.service.ts` — `sendDueAppointmentReminders`, the fourth
  notification pass in `reconcileMilestones`.
- `lib/resend/emails.ts` — `appointmentReminderEmail`.
- `services/studio-tools.service.ts` + `web-app/src/components/studio-tools.tsx` —
  the reconciliation tool reports and describes the new pass.
