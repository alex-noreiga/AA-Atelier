// Rate limiting for the routes that need a brake: the account-portal overview,
// the internal studio surface, and the public submission forms. Each has its own
// ceiling because each is guarding against a different thing — see the comment
// above each limiter.
//
// Sign-in itself runs on
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

/**
 * The brake on the studio surface, which is a different shape of problem.
 *
 * `/studio/*` is reached only by an authenticated session whose email is on the
 * `STUDIO_STAFF_EMAILS` allowlist, so the abuse this guards against — token
 * guessing, scraping a stranger's data — is already answered by the gate rather
 * than by the ceiling. What the ceiling has to accommodate instead is a handful
 * of people USING the page: one dashboard load is already nine reads (access,
 * analytics, materials, reviews, availability, settings, requests, newsletter,
 * guides) before anyone opens a guide, and working the request queue or the
 * review queue down is one write per decision. At the
 * account limiter's 30 that is five refreshes, or two dozen clicks, before a
 * staff member is locked out of their own dashboard for a quarter of an hour —
 * which is not a brake, it is a bug.
 *
 * So the studio routes get their own, looser limit. It is still a limit: a
 * runaway client (a render loop hammering `/studio/analytics`, whose Notion
 * scans are the most expensive read in the app) is stopped well short of doing
 * real damage. Same in-memory / per-instance caveat as above.
 */
export const studioRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300, // per IP per window across the whole studio surface
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
