// Rate limiting for the account-portal overview route. Sign-in itself runs on
// Supabase Auth in the browser, so the one server endpoint left here just
// performs authorization (verifying the Supabase access token before returning
// the customer's data); a brake on abuse — token guessing, scraping — belongs here.
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
  limit: 30, // per IP per window on the account overview route
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a few minutes." },
});

// A tighter brake for the public, anonymous submission forms (contact,
// back-in-stock notify, newsletter). A real visitor submits one of these a
// handful of times at most, so a low per-IP ceiling backstops the honeypot +
// timing filter without ever getting in a human's way. Same in-memory /
// per-instance caveat as above.
export const submissionRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 5, // per IP per window across the public submission forms
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a few minutes." },
});
