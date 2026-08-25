import { test, expect, type APIRequestContext } from "@playwright/test";

// The four public reads that are supposed to be served by Vercel's CDN rather
// than by a serverless function.
//
// This exists because the failure it watches for is invisible from the outside:
// the site stays completely correct when the edge cache stops working, it just
// gets slow — every visitor pays a cold start on a Hobby-plan function that,
// at this traffic level, is essentially never warm. Nothing errors, nothing
// logs, and the pages look identical. The only observable difference is in the
// response headers, which is what this asserts.
//
// It was written after exactly that regression: the generated API client
// attached `Authorization: Bearer <jwt>` to every request once a visitor was
// signed in, and Vercel does not serve cached content to a request carrying
// that header — so all four of these re-entered the function for every
// signed-in visitor despite correctly setting `s-maxage`. Seven days of
// production logs showed `cache=BYPASS` on every single request.
//
// Scope, stated plainly: this run is ANONYMOUS, so it verifies the server-side
// half — that the responses are still cacheable and that the CDN is still
// willing to cache them. It cannot catch the client-side half (a signed-in
// visitor's requests carrying a token again), because signing in is neither
// available to nor appropriate for a read-only production monitor. That half is
// guarded on every PR by `web-app/test/api-auth.test.ts`, which pins the
// client's allowlist to the OpenAPI spec's own `security` blocks.
//
// Read-only: four GETs of public marketing data, the same ones any visitor
// makes on a first page load.

/** The public reads whose routes set an `s-maxage` edge cache. */
const CACHED_READS = [
  { path: "/api/reviews", route: "routes/reviews.ts" },
  { path: "/api/services", route: "routes/services.ts" },
  { path: "/api/colors", route: "routes/colors.ts" },
  { path: "/api/products", route: "routes/products.ts" },
];

/**
 * `x-vercel-cache` values that mean the CDN is participating. HIT and STALE are
 * the win; MISS/REVALIDATED/PRERENDER are normal states of a working cache
 * (a cold key, a background refresh). BYPASS is the one that means "this
 * response was treated as uncacheable" — the regression.
 */
const PARTICIPATING = ["HIT", "STALE", "MISS", "REVALIDATED", "PRERENDER"];

async function cacheStateOf(
  request: APIRequestContext,
  path: string,
): Promise<{ status: number; cacheControl: string; vercelCache: string }> {
  const res = await request.get(path);
  const headers = res.headers();
  return {
    status: res.status(),
    cacheControl: headers["cache-control"] ?? "",
    vercelCache: (headers["x-vercel-cache"] ?? "").toUpperCase(),
  };
}

test.describe("Production smoke: edge caching of the public reads", () => {
  for (const { path, route } of CACHED_READS) {
    test(`${path} is served as cacheable`, async ({ request }) => {
      const first = await cacheStateOf(request, path);

      expect(
        first.status,
        `GET ${path} did not answer 200 — checked here because an error response is deliberately never cached`,
      ).toBe(200);

      // The route's own contract. If this disappears the CDN can never cache
      // the response no matter what else is right, and the only symptom is a
      // slower site. Asserts presence, not a specific age: retuning the age in
      // `${route}` is a deliberate change and must not fail the monitor.
      expect(
        first.cacheControl,
        `GET ${path} no longer sets s-maxage (${route}) — every request will now hit a cold serverless function`,
      ).toContain("s-maxage");
      expect(first.cacheControl).toContain("public");

      // Ask again so a cold cache key has been populated. The value itself is
      // not asserted — a second PoP, or an age that has just elapsed, can
      // legitimately MISS twice — only that the CDN did not refuse to cache.
      const second = await cacheStateOf(request, path);

      // Only assert when Vercel actually sent the header; a platform that stops
      // reporting cache state must not read as a site regression.
      if (second.vercelCache) {
        expect(
          PARTICIPATING,
          `GET ${path} reported x-vercel-cache: ${second.vercelCache}. BYPASS means the CDN treated the response as uncacheable — check for an Authorization header, a Set-Cookie, or a lost s-maxage. See CLAUDE.md, "Session transport is a Bearer JWT".`,
        ).toContain(second.vercelCache);
      }
    });
  }

  test("an anonymous read is not answered with a cookie", async ({
    request,
  }) => {
    // A `Set-Cookie` on one of these would make it permanently uncacheable —
    // the same class of silent slowdown as the Authorization header, and just
    // as invisible. Nothing in the app sets one (Supabase holds the session in
    // localStorage), so this should stay true.
    for (const { path } of CACHED_READS) {
      const res = await request.get(path);
      expect(
        res.headers()["set-cookie"],
        `GET ${path} answered with Set-Cookie, which makes it uncacheable at the edge`,
      ).toBeUndefined();
    }
  });
});
