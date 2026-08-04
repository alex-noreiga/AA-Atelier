// The payment-reminder business rule, shared by the reconciliation service (which
// finds invoices with a due deposit/balance and emails the customer) and its
// tests. Kept apart from the reconciliation so the config parsing + date math stay
// pure and independently testable — the same split as `fitting-reminder.ts`, whose
// generic `reminderCutoffDate` helper the reminder pass reuses for the cutoff.

// How many days before a payment stage's due date the reminder goes out. The
// reminder pass uses this as an `on_or_before` cutoff (`now + leadDays`), so a
// stage that's due within the window OR already overdue is picked up in one query.
const DEFAULT_LEAD_DAYS = 7;

/** The reminder lead window in days. Falls back to the default for an unset,
 * non-numeric, or non-positive override. Read at call time (mirrors the other
 * env-tuned business rules), not a Studio-Settings key — same as the fitting
 * reminder's lead days. */
export function paymentReminderLeadDays(): number {
  const raw = process.env.PAYMENT_REMINDER_LEAD_DAYS?.trim();
  if (!raw) return DEFAULT_LEAD_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LEAD_DAYS;
}

/** Whether a stage's due date (ISO `yyyy-mm-dd`) is strictly before today (also
 * ISO, UTC) — i.e. the payment is overdue rather than merely coming due. Drives
 * the "was due / overdue" wording in the reminder email. String comparison is
 * safe for zero-padded ISO calendar dates. */
export function isPaymentOverdue(dueDate: string, todayIso: string): boolean {
  return dueDate < todayIso;
}
