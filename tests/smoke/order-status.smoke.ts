import { test, expect } from "@playwright/test";

// Exercises the real order-lookup read path — `GET /api/orders/:n` against live
// Notion — without needing a known order number or writing anything. We look up
// a deliberately nonexistent number and assert the not-found UI renders: that
// proves the frontend, the serverless function, and the Notion `rich_text`
// order-number filter are all wired correctly (a broken filter or an unshared
// DB would 500 into `status-error` with a different message, or hang).

test.describe("Production smoke: order status lookup", () => {
  test("a nonexistent order number returns the not-found state", async ({
    page,
  }) => {
    await page.goto("/track");

    await page
      .getByTestId("input-order-number")
      .fill("SMOKE-TEST-NO-SUCH-ORDER");
    await page.getByTestId("button-lookup").click();

    // The lookup resolves to the error card (a 404 from Notion), not a hang and
    // not a success. `track.tsx` renders the 404 body text here.
    const error = page.getByTestId("status-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText(/couldn't find|no order|not found/i);
    // And it definitely did not resolve a real order.
    await expect(page.getByTestId("status-success")).toBeHidden();
  });
});
