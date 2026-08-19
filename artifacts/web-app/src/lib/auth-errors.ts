// Turning a failed Supabase Auth redirect into something a customer can act on.
//
// When a sign-in doesn't complete, Supabase redirects back to our callback with
// the reason in the URL (`error`, `error_code`, `error_description`) — in the
// query string for the PKCE flow, or the hash fragment for older/implicit ones.
// `pages/account-callback.tsx` used to read none of that: it only checked
// whether a session existed and, finding none, reported "that sign-in link has
// expired or already been used" for every failure. That copy is right for a
// stale magic link and wrong for everything else, which is what made a
// misconfigured Google provider (`server_error`) read as an expired link.
//
// So: `parseAuthCallbackError` recovers the reason, and `authErrorMessage` maps
// it to copy written for a customer rather than an operator. Unrecognized codes
// fall through to a neutral message — the map is a courtesy, never a gate.
//
// Note on timing (load-bearing): read the URL during render, not in an effect.
// supabase-js clears the auth params off the URL once it has processed them, so
// anything reading `window.location` later can find them already gone.

export interface AuthCallbackError {
  /** Supabase's `error_code` when present, else the coarser `error`. */
  code: string;
  /** Supabase's human-readable `error_description`, when it sent one. */
  description?: string;
}

/**
 * Recover the failure reason from a Supabase Auth redirect. Reads the query
 * string first, then the hash. Returns null when neither carries an error —
 * which is the ordinary success path.
 */
export function parseAuthCallbackError(
  search: string,
  hash: string,
): AuthCallbackError | null {
  for (const source of [search, hash]) {
    if (!source) continue;
    const params = new URLSearchParams(source.replace(/^[?#]/, ""));
    const code = params.get("error_code") ?? params.get("error");
    if (!code) continue;
    return {
      code,
      description: params.get("error_description") ?? undefined,
    };
  }
  return null;
}

/**
 * The reason a customer can be expected to recognize and resolve themselves —
 * a link they sat on too long, a consent screen they backed out of. Everything
 * else is ours to fix, and gets the reference line so they can quote it to us.
 */
const SELF_EXPLANATORY = new Set([
  "expired",
  "otp_expired",
  "access_denied",
  "bad_oauth_state",
]);

const MESSAGES: Record<string, string> = {
  // A magic link / verification link that timed out or was already followed.
  expired:
    "That sign-in link has expired or already been used. Sign in again below.",
  otp_expired:
    "That sign-in link has expired or already been used. Sign in again below.",
  // The customer backed out of the provider's consent screen.
  access_denied:
    "That sign-in was cancelled before it finished. You can try again below.",
  // Started in one tab and finished in another, or storage was cleared midway.
  bad_oauth_state:
    "That sign-in couldn't be completed, which can happen if it was started in another tab or window. Please try again below.",
  // The provider handed us back an error — misconfiguration, an outage, a
  // rejected token exchange. Never the customer's fault.
  server_error:
    "We couldn't finish signing you in. This one is on our end — please try again in a moment, or email us and we'll get you in.",
  // e.g. the provider isn't enabled on our side.
  validation_failed:
    "That sign-in method isn't available right now. Please use your email and password below, or email us and we'll help.",
  provider_email_needs_verification:
    "Please confirm your email address with that provider, then sign in again below.",
};

export const DEFAULT_AUTH_ERROR_MESSAGE =
  "We couldn't finish signing you in. Please try again below.";

/** Customer-facing copy for a failure code. */
export function authErrorMessage(code: string | null | undefined): string {
  if (!code) return DEFAULT_AUTH_ERROR_MESSAGE;
  return MESSAGES[code] ?? DEFAULT_AUTH_ERROR_MESSAGE;
}

/**
 * Whether to show the raw code alongside the message. True for the failures a
 * customer can't explain on their own, so they have something exact to quote
 * when they write in — and so the cause is legible from the page during setup.
 */
export function showsAuthErrorReference(
  code: string | null | undefined,
): boolean {
  if (!code) return false;
  return !SELF_EXPLANATORY.has(code);
}
