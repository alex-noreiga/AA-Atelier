import { test, expect, type APIRequestContext } from "@playwright/test";

// The five public reads that are supposed to be served by Vercel's CDN rather
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
// that header — so all of these re-entered the function for every signed-in
// visitor despite correctly setting `s-maxage`. Seven days of production logs
// showed `cache=BYPASS` on every single request.
//
// WHAT IT ASSERTS, AND WHY IT CHANGED (2026-08-25). It used to read the age
// straight back off the response: `Cache-Control` had to still contain
// `s-maxage`. That stopped being observable — Vercel now consumes the CDN
// directives and strips them, so a correctly-cached read answers a bare
// `Cache-Control: public` and the old assertion failed against a healthy site.
// Re-asserting the same idea on the request side was not an option either:
// `CDN-Cache-Control`, which the routes now send, is addressed to the CDN and
// never comes back.
//
// So it asserts the OUTCOME instead of the instruction — that the CDN actually
// served the response. That is a stronger check than the one it replaces, and
// deliberately so: a "still sets s-maxage" assertion could only ever prove the
// route asked, never that the platform agreed, and the second is the thing
// worth waking up for. It also subsumes the cases the string check used to
// cover, since a read that lost its cache header cannot come back HIT.
//
// Scope, stated plainly: this run is ANONYMOUS, so it verifies the server-side
// half. It cannot catch the client-side half (a signed-in visitor's requests
// carrying a token again), because signing in is neither available to nor
// appropriate for a read-only production monitor. That half is guarded on
// every PR by `web-app/test/api-auth.test.ts`, which pins the client's
// allowlist to the OpenAPI spec's own `security` blocks.
//
// Read-only: GETs of public marketing data, the same ones any visitor makes on
// a first page load.

/** The public reads whose routes declare an edge cache via `setEdgeCache`. */
const CACHED_READS = [
  { path: "/api/reviews", route: "routes/reviews.ts" },
  { path: "/api/services", route: "routes/services.ts" },
  { path: "/api/colors", route: "routes/colors.ts" },
  { path: "/api/products", route: "routes/products.ts" },
  { path: "/api/capacity", route: "routes/capacity.ts" },
];

/**
 * `x-vercel-cache` values that prove the CDN served the response itself, which
 * is the whole point of the exercise. MISS and REVALIDATED are normal on a cold
 * or just-expired key, so they are not failures on their own — they are only a
 * failure when every attempt reports one, which is what "nothing is being
 * cached" looks like. BYPASS is the outright refusal the original regression
 * produced.
 */
const SERVED_BY_CDN = ["HIT", "STALE"];

/**
 * How many times to ask before concluding the CDN is not caching. The first
 * request may legitimately populate a cold key; the rest should then be served
 * from it. Every route's `s-maxage` is at least 60s, so a key populated on the
 * first attempt is still fresh for all of them.
 */
const ATTEMPTS = 5;

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
    test(`${path} is served from the CDN`, async ({ request }) => {
      const first = await cacheStateOf(request, path);

      expect(
        first.status,
        `GET ${path} did not answer 200 — checked here because an error response is deliberately never cached`,
      ).toBe(200);

      // Ask repeatedly, stopping as soon as the CDN answers one itself. The
      // requests share a context, so they share a connection and land on the
      // same PoP; a key populated by the first is the one the rest read.
      const seen: string[] = [first.vercelCache || "(absent)"];
      let servedByCdn = SERVED_BY_CDN.includes(first.vercelCache);

      for (let attempt = 1; attempt < ATTEMPTS && !servedByCdn; attempt += 1) {
        const next = await cacheStateOf(request, path);
        seen.push(next.vercelCache || "(absent)");
        servedByCdn = SERVED_BY_CDN.includes(next.vercelCache);
      }

      // A platform that stops reporting cache state must not read as a site
      // regression — the same judgement this spec has always made about the
      // header. With nothing to read, the check has no opinion and says so
      // rather than inventing one.
      if (seen.every((state) => state === "(absent)")) {
        test.skip(
          true,
          `GET ${path} returned no x-vercel-cache header on ${ATTEMPTS} attempts, so cache state could not be read.`,
        );
      }

      expect(
        servedByCdn,
        `GET ${path} was never served from the CDN in ${ATTEMPTS} attempts (x-vercel-cache: ${seen.join(", ")}). ` +
          `Every request is reaching a cold serverless function. Check that ${route} still calls setEdgeCache, ` +
          `and that nothing has made the response uncacheable — an Authorization header, a Set-Cookie, or a Vary. ` +
          `BYPASS specifically means the CDN refused: see CLAUDE.md, "Session transport is a Bearer JWT".`,
      ).toBe(true);
    });
  }

  test("an anonymous read is not answered with a cookie", async ({
    request,
  }) => {
    // A `Set-Cookie` on one of these would make it permanently uncacheable —
    // the same class of silent slowdown as the Authorization header, and just
    // as invisible. Nothing in the app sets one (Supabase holds the session in
    // localStorage), so this should stay true. Kept as its own test because it
    // names the cause directly, where the check above would only report that
    // nothing was cached.
    for (const { path } of CACHED_READS) {
      const res = await request.get(path);
      expect(
        res.headers()["set-cookie"],
        `GET ${path} answered with Set-Cookie, which makes it uncacheable at the edge`,
      ).toBeUndefined();
    }
  });
});
