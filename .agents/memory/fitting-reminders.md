# Automated fitting reminders (Phase 2)

Emails a customer to book/confirm their fitting when their order's **"Fitting"**
production milestone is approaching, deep-linking to the booking flow
(`/appointments?type=fitting`). It **wires two existing systems together** — the
nightly milestone reconciliation and the Resend mailer — with **no new endpoint, no
new cron, and no frontend change** (the booking page already preselects a type from
`?type=`, a use the appointments page comment explicitly names).

## Why it's shaped this way

- **Rides the existing reconciliation, not a new trigger.** There's no Notion→app
  trigger (same constraint as milestones/status emails), so the reminder is a third
  pass, `sendDueFittingReminders`, inside `reconcileMilestones`
  (`services/schedule.service.ts`) after generation + status-sync. Both the Vercel
  cron and the on-demand button run it; the result now carries `remindersSent`.
- **One Notion query finds the work.** `findMilestonesNeedingFittingReminder`
  (`lib/notion/production-schedule.repository.ts`) filters the Production Schedule DB
  on `and`[ `or`(Production Stage = each fitting stage), Status ≠ Completed,
  Target Completion Date `on_or_before` cutoff, `Reminder Sent` = false ]. The
  milestone rows don't carry the customer email, so each order is resolved back from
  its `Order` relation via `findOrderForStageNotificationByPageId`.
- **"Fitting" + lead window are targeted business rules** (`services/fitting-reminder.ts`),
  the same kind of exception as `STATUS_IN_STOCK` / `MEASUREMENT_LOCK_FROM_STAGE`:
  `FITTING_REMINDER_STAGES` (comma-separated live Stage names, default `Fitting`) and
  `FITTING_REMINDER_LEAD_DAYS` (default `10`). Stage names aren't otherwise hardcoded —
  the default matches the live "Fitting" Stage option (see `stage-descriptions.ts`).
- **Idempotent via a per-milestone `Reminder Sent` checkbox** (the atelier adds it once
  to the Production Schedule DB; `PS_REMINDER_SENT_PROPERTY` +
  `buildReminderSentUpdate` / `markFittingReminderSent`). Analogue of the order's
  `Milestones Generated` / `Last Notified Stage` markers. A due milestone is emailed
  once then marked; an absent/unchecked box reads as false so new rows need nothing set.
  Load-bearing: a milestone is marked reminded **even when the order has no email** (a
  legacy order can't be reached — marking stops a nightly re-check); if the order lookup
  **throws**, the row is left unmarked so the next run retries it. Per-milestone failures
  are logged + skipped, like the generation/sync passes.
- **Customer email only, best-effort, appointments sender.** Sends via
  `sendEmailBestEffort` from `fromAddress("appointments")` — a Resend failure never
  fails the cron. **No internal atelier notification** (deliberate, like the newsletter
  opt-in: the atelier already sees the schedule/calendar, so a per-reminder studio email
  is noise). The booking link uses `PUBLIC_BASE_URL` and is omitted when unset (graceful,
  like the stage-change email's tracking link). Copy: `fittingReminderEmail` in
  `lib/resend/emails.ts`.

## One-time setup

Add a **`Reminder Sent`** (checkbox) property to the "📅 Production Schedule" Notion
database. **No new env var required** — reuses `CRON_SECRET`, `PUBLIC_BASE_URL`, the
Resend vars, and `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`; the two optional knobs above
tune it.

## Files

`services/fitting-reminder.ts` (new), `services/schedule.service.ts`
(`sendDueFittingReminders` + wired into `reconcileMilestones`, `MilestoneReconcileResult`
gained `remindersSent`), `lib/notion/production-schedule.{blocks,repository}.ts`
(`Reminder Sent` prop + query + marker), `fittingReminderEmail` in `lib/resend/emails.ts`,
`routes/cron.ts` (button summary notes reminders). Tests: `test/unit/fitting-reminder.test.ts`
(new), extended `resend.emails`, `schedule.service`, `production-schedule.repository`, and
`integration/cron.routes` suites.
