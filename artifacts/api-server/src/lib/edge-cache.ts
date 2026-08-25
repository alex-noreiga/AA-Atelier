// Telling the CDN how long it may serve a public read, in a way the CDN still
// hears when the platform rewrites `Cache-Control`.
//
// These endpoints have always set `Cache-Control: public, s-maxage=…,
// stale-while-revalidate=…` and relied on Vercel reading `s-maxage` out of it.
// On 2026-08-25 the responses started reaching the client as a bare
// `Cache-Control: public`, the directives stripped somewhere at the edge.
// Nothing in this repo changed: the routes, `app.ts`, `vercel.json` and
// `api/index.ts` are byte-identical across the deploys either side of it.
//
// The stripping was not merely cosmetic — the CDN stopped caching. Probed on
// production, `/api/services` (`s-maxage=3600`) answered `x-vercel-cache: MISS`
// with `age: 0` on two requests five seconds apart at the same PoP; a cached
// response could only have been a HIT. That follows from the symptom rather
// than being a second fault: a bare `public` carries no freshness lifetime, so
// whatever reaches the caching layer has no TTL to cache on. The preview
// deployment of this very commit ECHOES both headers back untouched, so the
// rewrite is production-only and no preview can be used to test it.
//
// That is exactly the ambiguity `CDN-Cache-Control` exists to remove. It is a
// standard (RFC 9213) header addressed to the shared cache rather than the
// browser, and Vercel reads it in preference to `Cache-Control` — so what the
// CDN is told no longer travels in a header addressed to somebody else, where
// something is free to rewrite it on the way past.
//
// Whether that is enough is the one thing this could not be tested for before
// merging, since the rewrite only happens on production. `edge-cache.smoke.ts`
// is what answers it: it now requires a real `x-vercel-cache: HIT`, so if the
// directives are still being lost the monitor says so on the next run rather
// than going quietly green.
//
// `Cache-Control` is still set, with the same directives: it is what any
// downstream cache and the browser read, and dropping it would be a behaviour
// change on a second question this fix has no opinion about. Both are written
// from ONE argument, so the two can never come to disagree about the age — a
// split that would be invisible from the outside and would take a production
// probe to notice.
//
// Deliberately not `Vercel-CDN-Cache-Control`: it would work and would take
// precedence, but it is Vercel's alone, and there is nothing about these reads
// that wants to be pinned to one host.

import type { Response } from "express";

/**
 * Declare a public read cacheable by shared caches for `directives`.
 *
 * Call it where `res.set("Cache-Control", …)` was called — after the awaited
 * read resolves, so a thrown error's response is never marked cacheable.
 *
 * @param directives the cache directives, e.g.
 *   `"public, s-maxage=120, stale-while-revalidate=600"`.
 */
export function setEdgeCache(res: Response, directives: string): void {
  res.set("Cache-Control", directives);
  res.set("CDN-Cache-Control", directives);
}
