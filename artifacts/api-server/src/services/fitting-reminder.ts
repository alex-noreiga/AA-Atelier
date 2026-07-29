// The fitting-reminder business rule, shared by the reconciliation service (which
// finds the due "Fitting" milestones and emails the customer) and its tests. Kept
// apart from the reconciliation so the config parsing + cutoff math stay pure and
// independently testable, the same split as `measurement-lock.ts`.

// A targeted business rule naming the live Stage option(s) that call for a fitting
// appointment. This names values, not the stage list (which stays live-read from
// Notion), so it's the same kind of deliberate exception as `STATUS_IN_STOCK` /
// `MEASUREMENT_LOCK_FROM_STAGE`: if the atelier renames the Fitting stage in
// Notion, update the default here (or set the env override). A comma-separated
// override supports ateliers with more than one fitting stage (e.g. a first and
// second fitting).
const DEFAULT_FITTING_STAGES = ["Fitting"];

// How many days before a fitting milestone's target date the reminder goes out.
const DEFAULT_LEAD_DAYS = 10;

/** The live Stage option name(s) that trigger a fitting reminder. */
export function fittingReminderStages(): string[] {
  const raw = process.env.FITTING_REMINDER_STAGES?.trim();
  if (!raw) return DEFAULT_FITTING_STAGES;
  const stages = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return stages.length > 0 ? stages : DEFAULT_FITTING_STAGES;
}

/** The reminder lead window in days. Falls back to the default for an unset,
 * non-numeric, or non-positive override. */
export function fittingReminderLeadDays(): number {
  const raw = process.env.FITTING_REMINDER_LEAD_DAYS?.trim();
  if (!raw) return DEFAULT_LEAD_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LEAD_DAYS;
}

/** The latest target date (ISO `yyyy-mm-dd`, UTC) still inside the reminder
 * window: `now + leadDays`. Drives the Notion `on_or_before` filter, so a Fitting
 * milestone due on or before this date (and not yet reminded) is picked up. */
export function reminderCutoffDate(now: Date, leadDays: number): string {
  const cutoff = new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().split("T")[0];
}
