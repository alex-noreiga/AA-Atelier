// Auth guard for the account-portal routes. The customer signs in with Supabase
// Auth (email+password / Google / magic link) in the browser; supabase-js holds
// the session and the generated API client sends its access token as a
// `Authorization: Bearer <jwt>` credential. This guard verifies that JWT with
// Supabase (`auth.getClaims`, local JWKS verification) and stashes the customer
// on `res.locals.customer` (mirroring how `validate` populates
// `res.locals.params/query/body`). A missing or invalid token — or an
// unconfigured portal — throws `UnauthorizedError`, which the central error
// handler renders as a 401; the frontend then redirects to the sign-in page.

import type { Request, RequestHandler } from "express";
import {
  getSupabaseClient,
  supabaseConfigured,
} from "../lib/supabase/client.js";
import { normalizeEmail } from "../lib/email.js";
import { UnauthorizedError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** The authenticated customer resolved from the Supabase access token. */
export interface SessionCustomer {
  /** Canonicalized (lowercased) email — the key every Notion/Calendar lookup
   * uses, so it must match how those records store the address. */
  email: string;
  /** The Supabase user id (`sub` claim), stable across email-case changes. */
  userId: string;
}

/** Pull the raw bearer token from the Authorization header, or null. */
function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export const requireCustomer: RequestHandler = async (req, res, next) => {
  if (!supabaseConfigured()) {
    next(new UnauthorizedError("Sign-in is currently unavailable."));
    return;
  }

  const token = readBearerToken(req);
  if (!token) {
    next(new UnauthorizedError("Please sign in to view your account."));
    return;
  }

  try {
    const { data, error } = await getSupabaseClient().auth.getClaims(token);
    const claims = data?.claims;
    const email = typeof claims?.email === "string" ? claims.email : "";
    const userId = typeof claims?.sub === "string" ? claims.sub : "";
    if (error || !claims || !email || !userId) {
      next(new UnauthorizedError("Please sign in to view your account."));
      return;
    }
    res.locals.customer = {
      email: normalizeEmail(email),
      userId,
    } satisfies SessionCustomer;
    next();
  } catch (err) {
    // getClaims can throw on a JWKS fetch failure or a malformed token — treat
    // any failure as "not signed in" rather than a 500.
    logger.warn({ err }, "Account auth: could not verify access token");
    next(new UnauthorizedError("Please sign in to view your account."));
  }
};
