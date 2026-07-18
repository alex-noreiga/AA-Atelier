import { test, expect } from "@playwright/test";

// Exercises the live inventory read path end to end: `GET /api/products` hits
// the real Notion inventory + Product Categories databases and the page renders
// the result. We assert the page settled WITHOUT its error state rather than
// asserting specific products — the catalogue is atelier-managed and may be
// legitimately empty, but a broken Notion read (bad key, unshared DB, missing
// categories DB) surfaces as `shop-error`, which is the real regression signal.

test.describe("Production smoke: shop inventory", () => {
  test("loads live inventory without an error state", async ({ page }) => {
    await page.goto("/shop");

    // Wait for the loading spinner to resolve (react-query retries the fetch a
    // few times with backoff before settling), then assert the read succeeded.
    await expect(page.getByTestId("shop-loading")).toBeHidden({
      timeout: 30_000,
    });

    // Page chrome rendered...
    await expect(page.getByTestId("cta-commission")).toBeVisible();
    // ...and the inventory fetch did not error.
    await expect(page.getByTestId("shop-error")).toBeHidden();

    // Either real products rendered or the catalogue is intentionally empty —
    // both are healthy; only `shop-error` is a failure.
    const products = page.locator('[data-testid^="product-"]');
    const empty = page.getByTestId("shop-empty");
    await expect
      .poll(
        async () => (await products.count()) > 0 || (await empty.isVisible()),
      )
      .toBe(true);
  });
});
