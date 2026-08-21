import { test, expect } from "@playwright/test";

// The build-time prerender still shipped.
//
// This is the one layer of the site that NO other spec can see, because every
// other spec asserts on the JS-rendered DOM — and the prerender exists precisely
// for the clients that never run JS. A social scraper (Pinterest, Facebook,
// LinkedIn, Slack, iMessage) reads the raw HTML Vercel serves and nothing else,
// so if the `seo-prerender` plugin silently stopped emitting per-route pages,
// every page would still look perfect in a browser while every shared link
// collapsed to the home card. That regression has real precedent here: product
// pages used to fall through the SPA rewrite to the home `index.html`, so
// pinning a dress produced a card titled "Custom Figure Skating & Dance
// Costumes" (CLAUDE.md, "Social share metadata").
//
// Fetched through the API request context, which returns the raw response body
// WITHOUT executing JavaScript — the same thing a scraper sees, and the reason a
// browser-based assertion here would prove nothing. Read-only: plain GETs of
// static build output.

/** A route whose prerendered page must carry its OWN artwork, not the default. */
const PRERENDERED_ROUTES = ["/about", "/services", "/shop", "/order"];

function ogImages(html: string): string[] {
  return [...html.matchAll(/<meta property="og:image" content="([^"]+)"/g)].map(
    (m) => m[1],
  );
}

test.describe("Production smoke: SEO prerender", () => {
  test("sitemap.xml is served and lists the indexable routes", async ({
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);

    const xml = await res.text();
    expect(xml).toContain("<urlset");
    // The marketing routes that must always be indexable.
    for (const path of ["/services", "/about", "/shop", "/order", "/contact"]) {
      expect(xml, `sitemap.xml is missing ${path}`).toContain(path);
    }
  });

  test("robots.txt is served and points at the sitemap", async ({
    request,
  }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);

    const body = await res.text();
    expect(body).toMatch(/user-agent:/i);
    expect(
      body,
      "robots.txt does not reference sitemap.xml — crawlers lose the route list",
    ).toMatch(/sitemap:/i);
  });

  for (const path of PRERENDERED_ROUTES) {
    test(`${path} is prerendered with its own share card`, async ({
      request,
    }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);

      const html = await res.text();
      const images = ogImages(html);

      // Two images per route, landscape first, so a scraper that understands
      // only one takes the 1200x630 (see "Each route ships two images").
      expect(
        images.length,
        `${path} served ${images.length} og:image tag(s); expected the landscape + Pinterest pair`,
      ).toBeGreaterThanOrEqual(2);

      // The load-bearing assertion: this route's card is ITS OWN, not the home
      // fallback. If the prerender stopped running, every route would serve the
      // SPA shell's default artwork and this is what would catch it.
      const slug = path.replace(/^\//, "");
      expect(
        images[0],
        `${path} is serving "${images[0]}" — it looks like the default card, meaning this route was not prerendered`,
      ).toContain(`${slug}-og`);

      // og:image:width / :height bind to the og:image they FOLLOW, so a route
      // that lost its dimension tags would have scrapers guessing a ratio.
      expect(html).toMatch(/<meta property="og:image:width"/);
      expect(html).toMatch(/<meta property="og:image:height"/);

      // And a canonical URL, so the share resolves to one address.
      expect(html).toMatch(/<meta property="og:url"/);
    });
  }

  test("the home page serves its own card, distinct from the inner routes", async ({
    request,
  }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);

    const images = ogImages(await res.text());
    expect(images.length).toBeGreaterThanOrEqual(2);
    expect(images[0]).toContain("home-og");
  });
});

// The www -> apex redirect (vercel.json). Old print material, saved links and
// inbound backlinks use the www host; if the redirect were dropped the site
// would still work but every canonical URL, OG tag and share card would
// disagree with the address the visitor is on, splitting SEO signal silently.
test.describe("Production smoke: canonical host", () => {
  test("www redirects to the apex domain", async ({ request, baseURL }) => {
    const target = new URL(baseURL ?? "https://a3iceanddance.com");
    test.skip(
      !target.hostname.endsWith("a3iceanddance.com"),
      `Target ${target.hostname} is not the production domain — no www redirect to check.`,
    );

    const res = await request.get(`https://www.${target.hostname}/`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });

    expect(
      [301, 308],
      `www answered ${res.status()}; expected a permanent redirect to the apex`,
    ).toContain(res.status());
    expect(res.headers()["location"] ?? "").toContain(target.hostname);
  });
});
