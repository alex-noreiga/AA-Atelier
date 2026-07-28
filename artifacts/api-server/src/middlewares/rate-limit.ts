// Rate limiting for the account-portal auth routes. These are the app's only
// endpoints that either send an email to an arbitrary address (sign-in link) or
// perform authorization (magic-link verify / session-gated overview), so a brake
// on abuse — email-bombing, token guessing — belongs here.
//
// The store is `express-rate-limit`'s default in-memory store: per serverless
// instance, not shared across them (the same best-effort caveat the alert
// de-dupe in `alert.service.ts` documents). For a low-volume atelier that's an
// adequate brake; a distributed store (Upstash/Redis) is the upgrade path if the
// traffic ever warrants it. Kept as its own middleware so the limit lives in one
// place and the route files just apply it.

import rateLimit from "express-rate-limit";

export const accountRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30, // per IP per window across the account auth routes
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a few minutes." },
});
