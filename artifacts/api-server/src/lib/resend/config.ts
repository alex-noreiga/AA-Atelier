// Per-category email address resolution, kept out of the pure builders and the
// transport client. Two categories — "orders" (order + back-in-stock mail) and
// "contact" (contact-form mail) — each resolve a sender ("from") and an atelier
// notification inbox from the environment.
//
// Every category-specific var is OPTIONAL and falls back to the base var, so an
// unset override behaves exactly as before it existed:
//   from:  RESEND_CONTACT_FROM_EMAIL   -> RESEND_FROM_EMAIL
//   inbox: ATELIER_CONTACT_INBOX_EMAIL -> ATELIER_INBOX_EMAIL
//
// Read `process.env` fresh each call (no memoization) so values can't be pinned
// by first-use ordering — the same rationale as the previous `getAtelierInbox`.

export type EmailCategory = "orders" | "contact";

/**
 * The sender address for a category. "orders" uses the base `RESEND_FROM_EMAIL`;
 * "contact" uses `RESEND_CONTACT_FROM_EMAIL` when set, else the base. Empty string
 * when nothing is configured (the client then also has no base `from`, so it is
 * treated as unconfigured and the send is skipped/swallowed).
 */
export function fromAddress(category: EmailCategory): string {
  const base = process.env.RESEND_FROM_EMAIL ?? "";
  if (category === "contact") {
    return process.env.RESEND_CONTACT_FROM_EMAIL || base;
  }
  return base;
}

/**
 * The atelier's own inbox for internal new-submission notifications in a category.
 * "orders" uses the base `ATELIER_INBOX_EMAIL`; "contact" uses
 * `ATELIER_CONTACT_INBOX_EMAIL` when set, else the base. Empty string when unset —
 * callers skip the notification rather than send to nobody.
 */
export function atelierInbox(category: EmailCategory): string {
  const base = process.env.ATELIER_INBOX_EMAIL ?? "";
  if (category === "contact") {
    return process.env.ATELIER_CONTACT_INBOX_EMAIL || base;
  }
  return base;
}
