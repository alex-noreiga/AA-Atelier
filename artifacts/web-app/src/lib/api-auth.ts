// Which API calls carry the customer's Supabase access token.
//
// The generated client attaches `Authorization: Bearer <jwt>` through the
// `setAuthTokenGetter` seam (wired in `auth-context.tsx`). That seam used to
// fire for *every* request once a session existed, which had a cost well beyond
// an unused header: Vercel's CDN does not serve cached content to a request
// carrying an `Authorization` header, so a signed-in visitor bypassed the edge
// cache on the four public, `s-maxage`-cached GETs (`/reviews`, `/services`,
// `/colors`, `/products`) and hit a cold serverless function for each one. It
// also awaited `supabase.auth.getSession()` ahead of every call.
//
// So the token is scoped to the endpoints that actually verify one. Only two
// surfaces do — `requireCustomer` on `/account/*` and `requireStaff` on
// `/studio/*` — and `test/api-auth.test.ts` checks that against the OpenAPI
// spec's own `security` blocks, so an authenticated endpoint added outside
// these prefixes fails CI rather than 401-ing in production.

/** The path the generated client mounts every operation under. */
const API_ROOT = "/api";

/** Path prefixes (below `API_ROOT`) whose operations verify a Bearer token. */
const AUTHENTICATED_PREFIXES = ["/account", "/studio"];

/**
 * The pathname of a request URL, which may be root-relative (the web app) or
 * absolute (an Expo bundle that called `setBaseUrl`). The base is only there to
 * satisfy `URL`; it is never used for a relative path's own host.
 */
function pathnameOf(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    // Not parseable as a URL — fall back to the raw string, minus any query.
    return url.split("?", 1)[0];
  }
}

/**
 * Whether a request to `url` should carry the access token.
 *
 * Fails *closed* on an unrecognized path (no token), which surfaces as a loud
 * 401 in development rather than a silently uncached public response.
 */
export function requiresAuthToken(url: string): boolean {
  const path = pathnameOf(url);
  const route = path.startsWith(API_ROOT) ? path.slice(API_ROOT.length) : path;

  return AUTHENTICATED_PREFIXES.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  );
}
