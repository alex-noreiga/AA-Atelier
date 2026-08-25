// Telling the CDN how long it may serve a public read, in a way the CDN still
// hears when the platform rewrites `Cache-Control`.
//
// These endpoints have always set `Cache-Control: public, s-maxage=…,
// stale-while-revalidate=…` and relied on Vercel reading `s-maxage` out of it.
// On 2026-08-25 the responses started reaching the client as a bare
// `Cache-Control: public` — Vercel now consumes the CDN directives and strips
// them before the response leaves the edge. Nothing in this repo changed: the
// four routes, `app.ts`, `vercel.json` and `api/index.ts` are byte-identical
// across the deploys either side of it.
//
// That is exactly the ambiguity `CDN-Cache-Control` exists to remove. It is a
// standard (RFC 9213) header addressed to the shared cache rather than the
// browser, Vercel consumes it in preference to `Cache-Control`, and it never
// reaches the client — so what the CDN is told no longer depends on how the
// platform chooses to rewrite a header meant for somebody else.
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
