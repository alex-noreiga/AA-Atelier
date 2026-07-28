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
// Two token purposes, with very different lifetimes:
//   - "magic"   — emailed sign-in link, short-lived (minutes).
//   - "session" — the cookie set after a magic link is verified, long-lived.

import { createHmac, timingSafeEqual } from "node:crypto";

export type TokenPurpose = "magic" | "session";

/** Magic-link lifetime: long enough to open the email, short enough to limit a
 * leaked-link window. */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
/** Session lifetime: 30 days, matching the cookie `maxAge`. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

interface TokenPayload {
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
 * Sign a token carrying the given email + purpose, expiring `ttlSeconds` from
 * now. Throws when `SESSION_SECRET` is unset — callers gate on
 * {@link authConfigured} first.
 */
export function signToken(
  email: string,
  purpose: TokenPurpose,
  ttlSeconds: number,
): string {
  if (!authConfigured()) {
    throw new Error("SESSION_SECRET is not configured");
  }
  const payload: TokenPayload = {
    email,
    purpose,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verify a token and return its email when the signature is valid, the purpose
 * matches, and it hasn't expired — otherwise null. Never throws: any malformed
 * input, bad signature, wrong purpose, or expiry yields null so callers treat a
 * verification failure uniformly.
 */
export function verifyToken(
  token: string | undefined | null,
  expectedPurpose: TokenPurpose,
): { email: string } | null {
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

  return { email: payload.email };
}
