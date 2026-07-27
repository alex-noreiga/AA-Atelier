// Session-cookie plumbing for the account portal. Setting a cookie uses
// Express's native `res.cookie`; reading parses the `Cookie` header by hand so we
// don't pull in `cookie-parser` for a single cookie (the repo keeps deps pruned).
//
// The session token (see `tokens.ts`) rides in an httpOnly cookie so it's never
// exposed to page JavaScript — the intended web-app auth path the generated
// client is built for (`custom-fetch.ts` sends credentials; the bearer-token
// getter is reserved for the mobile bundle). `secure` is on outside development
// so the cookie is only sent over HTTPS in production, and `sameSite: "lax"`
// lets the cookie ride the top-level navigation from the emailed magic link.

import type { Request, Response } from "express";
import { SESSION_TTL_SECONDS } from "./tokens.js";

export const SESSION_COOKIE = "aa_session";

/** Parse a raw `Cookie` header into a name→value map (values URL-decoded). */
export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** The session token from the request's cookies, or null when absent. */
export function readSessionToken(req: Request): string | null {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Set the httpOnly session cookie carrying the signed session token. */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

/** Clear the session cookie (sign-out). Matches the attributes used to set it so
 * the browser reliably removes it. */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
  });
}
