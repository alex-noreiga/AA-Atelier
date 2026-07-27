// Magic-link verification. This is the URL inside the sign-in email — the
// customer's browser navigates to it directly (a top-level GET, not a fetch), so
// it's mounted directly on the app OUTSIDE the OpenAPI contract / generated
// client (like the Stripe webhook and cron buttons), and it responds with a
// redirect rather than JSON. A valid, unexpired magic token is exchanged for a
// long-lived session cookie; anything else bounces back to the sign-in page.

import type { RequestHandler } from "express";
import {
  signToken,
  verifyToken,
  SESSION_TTL_SECONDS,
} from "../lib/auth/tokens.js";
import { setSessionCookie } from "../lib/auth/cookies.js";

export const verifyMagicLinkHandler: RequestHandler = (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const verified = verifyToken(token, "magic");

  if (!verified) {
    // Expired, tampered, wrong purpose, or missing — send them back to request a
    // fresh link. The frontend reads `?error` to explain what happened.
    res.redirect("/account/login?error=expired");
    return;
  }

  // Exchange the one-time magic token for a durable session cookie, then land the
  // customer on their dashboard.
  const session = signToken(verified.email, "session", SESSION_TTL_SECONDS);
  setSessionCookie(res, session);
  res.redirect("/account");
};
