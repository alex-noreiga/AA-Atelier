// Per-category email address resolution, kept out of the pure builders and the
// transport client. Three categories — "orders" (order + back-in-stock mail),
// "contact" (contact-form mail), and "appointments" (booking mail) — each
// resolve a sender ("from") and an atelier notification inbox from the
// environment.
//
// Every category-specific var is OPTIONAL and falls back to the base var, so an
// unset override behaves exactly as before it existed:
//   from:  RESEND_CONTACT_FROM_EMAIL       -> RESEND_FROM_EMAIL
//   inbox: ATELIER_CONTACT_INBOX_EMAIL     -> ATELIER_INBOX_EMAIL
//   from:  RESEND_APPOINTMENTS_FROM_EMAIL  -> RESEND_FROM_EMAIL
//   inbox: ATELIER_APPOINTMENTS_INBOX_EMAIL-> ATELIER_INBOX_EMAIL
//
// Read `process.env` fresh each call (no memoization) so values can't be pinned
// by first-use ordering — the same rationale as the previous `getAtelierInbox`.
//
// The atelier notification INBOXES additionally resolve from the live "Studio
// Settings" Notion rows first (so the atelier can change where notifications land
// without a redeploy — see lib/settings/store.ts); the SENDER addresses stay
// env-only, because they're coupled to Resend domain verification and a wrong
// value would silently break delivery.

import { settingValue } from "../settings/store.js";

export type EmailCategory = "orders" | "contact" | "appointments";

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
  if (category === "appointments") {
    return process.env.RESEND_APPOINTMENTS_FROM_EMAIL || base;
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
  const base =
    settingValue("ATELIER_INBOX_EMAIL") ??
    process.env.ATELIER_INBOX_EMAIL ??
    "";
  if (category === "contact") {
    const override =
      settingValue("ATELIER_CONTACT_INBOX_EMAIL") ??
      process.env.ATELIER_CONTACT_INBOX_EMAIL;
    return override || base;
  }
  if (category === "appointments") {
    const override =
      settingValue("ATELIER_APPOINTMENTS_INBOX_EMAIL") ??
      process.env.ATELIER_APPOINTMENTS_INBOX_EMAIL;
    return override || base;
  }
  return base;
}

/**
 * The Resend **Marketing** Audience id newsletter opt-ins are synced into
 * (`RESEND_AUDIENCE_ID`), or empty string when unset. Read fresh from
 * `process.env`, same as the address resolvers above. Empty ⇒ the audience sync
 * self-gates off and the opt-in is still captured in Notion — the same
 * degrade-when-unconfigured contract as the optional integrations elsewhere.
 */
export function audienceId(): string {
  return process.env.RESEND_AUDIENCE_ID ?? "";
}
