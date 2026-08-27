import { test, expect } from "./support/test";
import {
  mockInstagramFeed,
  mockProducts,
  mockPublishedReviews,
} from "./support/mock-api";

// A 1x1 transparent GIF, served for every tile. Real Instagram CDN URLs are not
// reachable offline, and the component DROPS a tile whose image errors — so a
// spec that let the images 404 would be asserting against an empty grid without
// noticing.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

const FEED = {
  posts: [
    {
      id: "media-1",
      permalink: "https://www.instagram.com/p/AAA111/",
      imageUrl: "https://cdn.instagram.test/a.jpg",
      mediaType: "image",
      caption: "Aurora, finished\n\n#figureskating",
      productId: "row-soaker",
      productTitle: "Aurora Soaker",
    },
    {
      id: "media-2",
      permalink: "https://www.instagram.com/reel/BBB222/",
      imageUrl: "https://cdn.instagram.test/b.jpg",
      mediaType: "video",
      caption: "Behind the scenes",
    },
  ],
};

test.describe("Instagram strip", () => {
  test.beforeEach(async ({ page }) => {
    await mockPublishedReviews(page);
    await page.route("https://cdn.instagram.test/**", (route) =>
      route.fulfill({ contentType: "image/gif", body: PIXEL }),
    );
  });

  test("shows the studio's posts and links a tagged one into the shop", async ({
    page,
  }) => {
    await mockInstagramFeed(page, { body: FEED });
    await page.goto("/");

    const tiles = page.getByTestId("instagram-post");
    await expect(tiles).toHaveCount(2);

    // The photograph goes to Instagram…
    await expect(
      page.getByTestId("instagram-post-link").first(),
    ).toHaveAttribute("href", "https://www.instagram.com/p/AAA111/");

    // …and only the post the atelier tied to a piece offers the shop link.
    const shop = page.getByTestId("instagram-post-shop");
    await expect(shop).toHaveCount(1);
    await expect(shop).toHaveText("Shop Aurora Soaker");

    // That link is a real route into the catalogue, not just an href. The shop
    // page it lands on reads the catalogue; what it finds there is beside the
    // point, so an empty one keeps the assertion about the navigation.
    await mockProducts(page, { body: { products: [], categories: [] } });
    await shop.click();
    await expect(page).toHaveURL(/\/shop\/row-soaker$/);
  });

  test("is absent entirely when there is nothing to show", async ({ page }) => {
    // The same state as an unconfigured integration, an expired token, or an
    // Instagram outage — the server answers all of them with an empty list, and
    // the page must read as though the section never existed.
    await mockInstagramFeed(page, { body: { posts: [] } });
    await page.goto("/");

    await expect(page.getByTestId("shop-teaser")).toBeVisible();
    await expect(page.getByTestId("instagram-feed")).toHaveCount(0);
  });
});
