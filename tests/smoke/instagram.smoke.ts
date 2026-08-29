import { test, expect } from "@playwright/test";

// The social-proof strip's read — `GET /api/instagram` against the live
// Instagram Graph API, rendered by `components/instagram-feed.tsx` on the home
// and shop pages.
//
// Worth monitoring for the same reason as the testimonials, only more so. That
// strip renders nothing on a failure, and so does this one — but this one has a
// failure the others don't: the access token expires 60 days after it is minted.
// If the nightly refresh ever stops working, the feed goes quiet on a schedule,
// with no error state, no empty state, and nothing on the page that looks
// different from a studio that never set Instagram up. The refresh pass alerts
// the inbox when IT fails; this is the check on the outcome.
//
// Read-only: a GET of the studio's own public posts.

// Opt-in strictness, exactly like SMOKE_EXPECT_REVIEWS. The endpoint is
// degrade-safe by design — an unconfigured integration, an expired token and an
// Instagram outage all answer 200 with an empty list — so an empty feed here is
// genuinely ambiguous and the API cannot tell the cases apart. Once the strip is
// live on the site, set SMOKE_EXPECT_INSTAGRAM=1: from then on an empty list is
// a real failure, which is what turns the ambiguous signal into a monitor of the
// token's renewal.
const EXPECT_POSTS = process.env.SMOKE_EXPECT_INSTAGRAM === "1";

type InstagramPost = {
  id?: string;
  permalink?: string;
  imageUrl?: string;
  mediaType?: string;
  caption?: string;
  postedAt?: string;
  productId?: string;
  productTitle?: string;
};

test.describe("Production smoke: Instagram feed", () => {
  test("the social strip's read answers with a well-formed list", async ({
    request,
  }) => {
    const res = await request.get("/api/instagram");
    expect(
      res.status(),
      "GET /api/instagram did not answer 200 — the home and shop pages would silently drop their Instagram strip",
    ).toBe(200);

    const body = (await res.json()) as { posts?: InstagramPost[] };
    expect(Array.isArray(body.posts)).toBe(true);

    const posts = body.posts ?? [];

    if (EXPECT_POSTS) {
      expect(
        posts.length,
        "SMOKE_EXPECT_INSTAGRAM=1 but the site is serving no posts — the likeliest cause by far is that the access token expired and the nightly refresh is not renewing it",
      ).toBeGreaterThan(0);
    }

    for (const post of posts) {
      expect(typeof post.id).toBe("string");
      // Every tile is an image and a link; a post missing either renders as a
      // visibly broken square, so the shape IS the regression signal.
      expect(post.permalink).toMatch(/^https:\/\//);
      expect(post.imageUrl).toMatch(/^https:\/\//);
      expect(["image", "video", "carousel"]).toContain(post.mediaType);

      // The shop link is all-or-nothing: an id with no name renders "Shop
      // undefined", and a name with no id renders a link to nowhere.
      expect(Boolean(post.productId)).toBe(Boolean(post.productTitle));
    }
  });
});
