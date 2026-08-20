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

// --- Second factor: how the staff member signed in ---
//
// The allowlist alone is only as strong as the mailbox behind the address, and
// the studio's addresses are published on the site. Requiring the *method* —
// not just the identity — closes that: a leaked password or a stolen magic
// link can't reach the studio surfaces, because the session has to have been
// established through Google, where the studio enforces 2-step verification in
// Workspace admin. That's real MFA without an enrollment flow of our own.
//
// The signal is the access token's `amr` ("authentication methods reference")
// claim, which Supabase stamps with what actually established THIS session —
// unlike `app_metadata.provider`, which only says what's linked to the account.
// Supabase reports an OAuth sign-in as `oauth`; it does not name the provider,
// so this means "Google" precisely because Google is the only OAuth provider
// enabled on the project. Enable a second one and this check widens with it.

/** The `amr` method Supabase records for an OAuth (Google) sign-in. */
export const OAUTH_AMR_METHOD = "oauth";

/**
 * Whether staff sessions must have been established with Google.
 *
 * **Defaults to ON.** An access-control default that has to be remembered isn't
 * one, so this is opt-*out*: set `STUDIO_REQUIRE_GOOGLE` to `false`/`0`/`no`/
 * `off` to fall back to any sign-in method. The escape hatch matters — it's the
 * recovery path if Google sign-in is ever unavailable — but the safe state is
 * the one you get by doing nothing.
 */
export function staffRequiresGoogle(): boolean {
  const raw = (process.env.STUDIO_REQUIRE_GOOGLE ?? "").trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(raw);
}

/**
 * The authentication methods recorded on a verified access token's claims.
 *
 * Supabase emits `amr` in either shape — a plain RFC-8176 string array, or
 * entries carrying a timestamp — so both are read. Anything unrecognizable
 * yields an empty list, which the caller treats as "can't confirm the method".
 */
export function extractAuthMethods(claims: unknown): string[] {
  if (!claims || typeof claims !== "object") return [];
  const amr = (claims as { amr?: unknown }).amr;
  if (!Array.isArray(amr)) return [];

  const methods: string[] = [];
  for (const entry of amr) {
    if (typeof entry === "string") {
      methods.push(entry);
    } else if (entry && typeof entry === "object") {
      const method = (entry as { method?: unknown }).method;
      if (typeof method === "string") methods.push(method);
    }
  }
  return methods;
}

/**
 * Whether a session established with these methods came through Google.
 *
 * **Fails closed**: an empty list (a token with no readable `amr`) can't prove
 * how the session was created, so it doesn't pass. If a project somehow never
 * emits the claim, the symptom is a 403 for staff with an actionable message,
 * and `STUDIO_REQUIRE_GOOGLE=false` is the way out — never a silent downgrade
 * to "any password will do".
 */
export function signedInWithGoogle(methods: string[]): boolean {
  return methods.includes(OAUTH_AMR_METHOD);
}
