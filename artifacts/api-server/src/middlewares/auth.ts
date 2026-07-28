// Auth guard for the account-portal routes. Reads the session cookie, verifies
// the signed session token, and stashes the customer on `res.locals.customer`
// (mirroring how `validate` populates `res.locals.params/query/body`). A missing
// or invalid session throws `UnauthorizedError`, which the central error handler
// renders as a 401 — the frontend then redirects to the sign-in page.

import type { RequestHandler } from "express";
import { readSessionToken } from "../lib/auth/cookies.js";
import { verifyToken } from "../lib/auth/tokens.js";
import { UnauthorizedError } from "../lib/errors.js";

/** The authenticated customer resolved from the session cookie. */
export interface SessionCustomer {
  email: string;
}

export const requireCustomer: RequestHandler = (req, res, next) => {
  const session = verifyToken(readSessionToken(req), "session");
  if (!session) {
    next(new UnauthorizedError("Please sign in to view your account."));
    return;
  }
  res.locals.customer = { email: session.email } satisfies SessionCustomer;
  next();
};
