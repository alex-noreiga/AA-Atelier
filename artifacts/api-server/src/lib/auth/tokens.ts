// Stateless, signed tokens for the passwordless account portal.
//
// There is no user table (identity IS the customer's email — see CLAUDE.md), and
// the app runs on serverless with no session store, so both the magic-link token
// and the session token are self-contained HMAC-signed blobs rather than
// server-side sessions. A token is `base64url(payload) . base64url(HMAC-SHA256)`,
// where the payload is `{ email, purpose, exp }`. Verification recomputes the MAC
// (timing-safe) and checks the purpose + expiry — nothing is persisted.
//
// The signing secret is `SESSION_SECRET`, read at call time (like the Notion/
// Resend clients) so the module imports without it and tests can set it. When it
// is unset the portal is inert: signing throws and verification returns null.
//
// Token purposes, with very different lifetimes:
//   - "magic"       — emailed sign-in link, short-lived (minutes).
//   - "session"     — the cookie set after a magic link is verified, long-lived.
//   - "appointment" — the link in an appointment confirmation email that lets the
//                     customer reschedule/cancel without signing in. Carries the
//                     calendar event id + staff alongside the email so possession
//                     of the signed link is the only handle needed (there is no
//                     appointments database — the event on the staff calendar is
//                     the sole record).

import { createHmac, timingSafeEqual } from "node:crypto";

export type TokenPurpose = "magic" | "session" | "appointment";

/** Magic-link lifetime: long enough to open the email, short enough to limit a
 * leaked-link window. */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
/** Session lifetime: 30 days, matching the cookie `maxAge`. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Appointment manage-link lifetime: 60 days, comfortably covering the max
 * booking-advance window (`APPOINTMENT_MAX_ADVANCE_DAYS`, default 45) plus a
 * buffer. The calendar event itself gates real validity — a cancelled/past event
 * is rejected downstream — so this is a generous outer bound, not the real check. */
export const APPOINTMENT_MANAGE_TTL_SECONDS = 60 * 24 * 60 * 60;

/** Extra, purpose-specific claims signed alongside the email. Only appointment
 * links use these today (the account tokens carry email + purpose alone). */
export interface TokenClaims {
  /** The Google Calendar event id the appointment link acts on. */
  eventId?: string;
  /** The staff member whose calendar holds the event (to address it). */
  staff?: string;
}

interface TokenPayload extends TokenClaims {
  email: string;
  purpose: TokenPurpose;
  /** Expiry as a Unix timestamp in seconds. */
  exp: number;
}

/** The secret used to sign tokens, read fresh each call (no memoization). */
function secret(): string {
  return process.env.SESSION_SECRET ?? "";
}

/** Whether the portal's signing secret is configured. When false the sign-in
 * flow is disabled (the route reports it) and verification always fails. */
export function authConfigured(): boolean {
  return secret().length > 0;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

/**
 * Sign a token carrying the given email + purpose (+ optional purpose-specific
 * claims), expiring `ttlSeconds` from now. Throws when `SESSION_SECRET` is unset
 * — callers gate on {@link authConfigured} first.
 */
export function signToken(
  email: string,
  purpose: TokenPurpose,
  ttlSeconds: number,
  claims: TokenClaims = {},
): string {
  if (!authConfigured()) {
    throw new Error("SESSION_SECRET is not configured");
  }
  const payload: TokenPayload = {
    email,
    purpose,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    ...(claims.eventId ? { eventId: claims.eventId } : {}),
    ...(claims.staff ? { staff: claims.staff } : {}),
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verify a token and return its email (plus any signed claims) when the
 * signature is valid, the purpose matches, and it hasn't expired — otherwise
 * null. Never throws: any malformed input, bad signature, wrong purpose, or
 * expiry yields null so callers treat a verification failure uniformly. The
 * account routes read only `.email`; the appointment routes also read the
 * `eventId` / `staff` claims (and validate they're present).
 */
export function verifyToken(
  token: string | undefined | null,
  expectedPurpose: TokenPurpose,
): { email: string; eventId?: string; staff?: string } | null {
  if (!token || !authConfigured()) return null;

  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  const expectedSig = sign(payloadB64);
  const provided = Buffer.from(providedSig);
  const expected = Buffer.from(expectedSig);
  // timingSafeEqual requires equal-length buffers; a length mismatch is already
  // a mismatch, so short-circuit rather than let it throw.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as TokenPayload;
  } catch {
    return null;
  }

  if (payload.purpose !== expectedPurpose) return null;
  if (
    typeof payload.exp !== "number" ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  if (typeof payload.email !== "string" || !payload.email) return null;

  return {
    email: payload.email,
    ...(typeof payload.eventId === "string"
      ? { eventId: payload.eventId }
      : {}),
    ...(typeof payload.staff === "string" ? { staff: payload.staff } : {}),
  };
}
