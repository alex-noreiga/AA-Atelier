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
// `requireStaff` layers the studio gate (see `lib/staff.ts`) on top of the same
// verification, so the internal dashboard needs no second auth vendor: a staff
// member signs in exactly like a customer, and their email plus *how they signed
// in* is what grants access. A valid session that fails either check is never a
// 401 — they *are* signed in, so bouncing them to the sign-in page would just
// loop — but the two failures answer differently, on purpose (see below).

import type { Request, RequestHandler } from "express";
import {
  getSupabaseClient,
  supabaseConfigured,
} from "../lib/supabase/client.js";
import { normalizeEmail } from "../lib/email.js";
import {
  isStaffEmail,
  extractAuthMethods,
  signedInWithGoogle,
  staffRequiresGoogle,
} from "../lib/staff.js";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** The authenticated customer resolved from the Supabase access token. */
export interface SessionCustomer {
  /** Canonicalized (lowercased) email — the key every Notion/Calendar lookup
   * uses, so it must match how those records store the address. */
  email: string;
  /** The Supabase user id (`sub` claim), stable across email-case changes. */
  userId: string;
  /** How this session was established, from the token's `amr` claim (e.g.
   * `["password"]`, `["oauth"]`, `["magiclink"]`). Empty when the token
   * carries no readable claim. The studio gate requires a specific method —
   * see `lib/staff.ts`. */
  authMethods: string[];
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
    return {
      email: normalizeEmail(email),
      userId,
      authMethods: extractAuthMethods(claims),
    };
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
 * Gate an internal studio surface. Two checks, in order:
 *
 *  1. **Who** — the signed-in email must be on the staff allowlist. An
 *     unconfigured allowlist admits nobody, so the internal routes are inert
 *     until the atelier sets `STUDIO_STAFF_EMAILS`.
 *  2. **How** — by default the session must have been established with Google
 *     (see `lib/staff.ts`). The studio's addresses are published on the site,
 *     so the allowlist by itself is only as strong as the mailbox behind one;
 *     requiring the method means a leaked password or an intercepted magic link
 *     can't reach the studio's figures.
 *
 * Not signed in → 401 (the frontend sends them to sign in). Past that, the two
 * checks answer **differently**, which is the load-bearing part:
 *
 *  - **Not on the allowlist → 404**, the same answer any URL that doesn't exist
 *    gets. `/studio` is `noindex` and unlinked for everyone but staff, so the
 *    only way a customer reaches it is by typing it — and a 403 would confirm
 *    to them that an internal dashboard is there to be found. There is nothing
 *    such a caller can do about the refusal, so there is nothing to tell them.
 *  - **Allowlisted but wrong sign-in method → 403**, carrying a message the
 *    page shows verbatim. Here there *is* something to do — sign in again with
 *    Google — and only someone who already controls that mailbox can provoke
 *    it, so it discloses nothing they didn't already know.
 */
export const requireStaff: RequestHandler = async (req, res, next) => {
  const customer = await resolveSessionCustomer(req);
  if (!customer) {
    next(new UnauthorizedError("Please sign in to view the studio dashboard."));
    return;
  }
  if (!isStaffEmail(customer.email)) {
    // Deliberately indistinguishable from a mistyped URL — see above. The
    // message is what an API client sees; the SPA renders its own 404 page.
    next(new NotFoundError("Not found."));
    return;
  }
  if (staffRequiresGoogle() && !signedInWithGoogle(customer.authMethods)) {
    // Worth logging: this is a staff address that failed only on method, which
    // is either a staff member using the wrong button or a compromised password
    // being tried. Either way the atelier should be able to see it happened.
    logger.warn(
      { email: customer.email, authMethods: customer.authMethods },
      "Studio access refused: session was not established with Google",
    );
    next(
      new ForbiddenError(
        "Studio access requires signing in with Google. Please sign out and use Continue with Google.",
      ),
    );
    return;
  }
  res.locals.customer = customer;
  next();
};
