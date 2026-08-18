import { test, expect } from "@playwright/test";

// The shop-order counterpart to `order-status.smoke.ts`. The unified `/track`
// page serves BOTH custom (`ORD-…`) and shop (`SHP-…`) orders, and the two route
// to entirely separate backends: a `SHP-` prefix drives `useGetShopOrderStatus`
// → `GET /api/shop-orders/:n`, reading the "Shop Orders" Notion database and its
// own live fulfillment-status list — a different DB, filter, and status workflow
// than the custom-order path. That whole path was previously unsmoked.
//
// We look up a deliberately nonexistent `SHP-` number and assert the shop
// not-found card renders: read-only (no write), and it proves the frontend, the
// serverless function, and the Shop Orders Notion read are all wired (a broken
// filter or unshared DB would 500 into a different message, or hang).

test.describe("Production smoke: shop-order status lookup", () => {
  test("a nonexistent shop order number returns the not-found state", async ({
    page,
  }) => {
    await page.goto("/track");

    // The SHP- prefix is what routes the lookup to the shop-order backend.
    await page
      .getByTestId("input-order-number")
      .fill("SHP-SMOKE-TEST-NO-SUCH-ORDER");
    await page.getByTestId("button-lookup").click();

    const error = page.getByTestId("status-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    // track.tsx renders the shop-specific 404 copy for a missing SHP- number.
    await expect(error).toContainText(/couldn't find a shop order|not found/i);
    await expect(page.getByTestId("status-success")).toBeHidden();
  });
});
