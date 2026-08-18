// Auth guards for the signed-in routes. The customer signs in with Supabase
// Auth (email+password / Google / magic link) in the browser; supabase-js holds
// the session and the generated API client sends its access token as a
// `Authorization: Bearer <jwt>` credential. These guards verify that JWT with
// Supabase (`auth.getClaims`, local JWKS verification) and stash the caller on
// `res.locals.customer` (mirroring how `validate` populates
// `res.locals.params/query/body`). A missing or invalid token — or an
// unconfigured portal — throws `UnauthorizedError`, which the central error
// handler renders as a 401; the frontend then redirects to the sign-in page.
//
// `requireStaff` layers the studio allowlist (see `lib/staff.ts`) on top of the
// same verification, so the internal dashboard needs no second auth vendor: a
// staff member signs in exactly like a customer and their email is what grants
// access. A valid session that isn't on the allowlist is a 403, not a 401 —
// they *are* signed in; they're just not studio staff, and re-authenticating
// wouldn't change that.

import type { Request, RequestHandler } from "express";
import {
  getSupabaseClient,
  supabaseConfigured,
} from "../lib/supabase/client.js";
import { normalizeEmail } from "../lib/email.js";
import { isStaffEmail } from "../lib/staff.js";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";
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

/**
 * Verify the request's Bearer token and resolve it to a session customer, or
 * null when there's no usable session (no token, an invalid one, an
 * unconfigured portal, or a JWKS/verification failure — all of which mean "not
 * signed in" rather than a 500). Shared by both guards below so they can't
 * drift on what counts as authenticated.
 */
async function resolveSessionCustomer(
  req: Request,
): Promise<SessionCustomer | null> {
  if (!supabaseConfigured()) return null;

  const token = readBearerToken(req);
  if (!token) return null;

  try {
    const { data, error } = await getSupabaseClient().auth.getClaims(token);
    const claims = data?.claims;
    const email = typeof claims?.email === "string" ? claims.email : "";
    const userId = typeof claims?.sub === "string" ? claims.sub : "";
    if (error || !claims || !email || !userId) return null;
    return { email: normalizeEmail(email), userId };
  } catch (err) {
    // getClaims can throw on a JWKS fetch failure or a malformed token — treat
    // any failure as "not signed in" rather than a 500.
    logger.warn({ err }, "Account auth: could not verify access token");
    return null;
  }
}

export const requireCustomer: RequestHandler = async (req, res, next) => {
  // An unconfigured portal is worth saying plainly — nothing the visitor does
  // will sign them in, so "unavailable" beats "please sign in".
  if (!supabaseConfigured()) {
    next(new UnauthorizedError("Sign-in is currently unavailable."));
    return;
  }

  const customer = await resolveSessionCustomer(req);
  if (!customer) {
    next(new UnauthorizedError("Please sign in to view your account."));
    return;
  }
  res.locals.customer = customer;
  next();
};

/**
 * Gate an internal studio surface: a valid session whose email is on the staff
 * allowlist. Not signed in → 401 (the frontend sends them to sign in); signed
 * in but not staff → 403 (signing in again wouldn't help). An unconfigured
 * allowlist admits nobody, so the internal routes are inert until the atelier
 * sets `STUDIO_STAFF_EMAILS`.
 */
export const requireStaff: RequestHandler = async (req, res, next) => {
  const customer = await resolveSessionCustomer(req);
  if (!customer) {
    next(new UnauthorizedError("Please sign in to view the studio dashboard."));
    return;
  }
  if (!isStaffEmail(customer.email)) {
    next(
      new ForbiddenError(
        "This account doesn't have access to the studio dashboard.",
      ),
    );
    return;
  }
  res.locals.customer = customer;
  next();
};
