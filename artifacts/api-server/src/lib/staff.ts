// Who counts as studio staff — the allowlist behind the internal, auth-gated
// surfaces (today: the studio analytics dashboard).
//
// Identity is the same Supabase Auth session the customer portal uses: a staff
// member signs in exactly like a customer, and this list is what promotes their
// email to studio access. That deliberately avoids a second auth vendor, a
// staff user table, and the shared-secret-in-a-URL pattern the atelier buttons
// use (see the roadmap's "Staff authentication for internal tools").
//
// Three load-bearing rules:
//
//  1. **Env only — never a Studio Setting.** The atelier-editable settings
//     database is for non-secret business tunables; access control is not one.
//     Anyone who can edit the Notion workspace could otherwise grant themselves
//     the studio's revenue figures, so the allowlist lives where the secrets
//     live (Vercel env), same reasoning that keeps `RESEND_*_FROM_EMAIL` out of
//     Studio Settings.
//  2. **Fail closed.** An unset or empty `STUDIO_STAFF_EMAILS` means *nobody*
//     is staff, so the dashboard is inert until it's configured — the opposite
//     of the optional integrations, which degrade to "feature off" by doing
//     nothing. Here doing nothing must mean "no access", not "open access".
//  3. **Compared on the canonical email.** Entries are normalized with the same
//     `normalizeEmail` the CRM and portal lookups use, so a differently-cased
//     address in the env var still matches the address on the token.

import { normalizeEmail } from "./email.js";

/**
 * The configured studio staff addresses, canonicalized. Read fresh from env on
 * every call (like `rushSurchargeRate()` / the appointment settings) so a Vercel
 * env change takes effect on the next request rather than the next cold start.
 * Blank entries are dropped, so `"a@x.com,,"` is a one-address list.
 */
export function staffEmails(): string[] {
  const raw = process.env.STUDIO_STAFF_EMAILS ?? "";
  return raw
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
}

/** Whether any staff address is configured at all. False ⇒ the internal
 * surfaces are unreachable for everyone (see rule 2 above). */
export function staffAccessConfigured(): boolean {
  return staffEmails().length > 0;
}

/** Whether the signed-in email is on the staff allowlist. */
export function isStaffEmail(email: string): boolean {
  const candidate = normalizeEmail(email);
  if (!candidate) return false;
  return staffEmails().includes(candidate);
}
