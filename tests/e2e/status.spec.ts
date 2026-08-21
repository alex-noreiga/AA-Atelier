import { test, expect } from "./support/test";
import { orderRecord } from "@workspace/test-fixtures";
import { mockOrderStatus, mockShopOrderStatus } from "./support/mock-api";

test.describe("Order status lookup", () => {
  test("normalizes the entered number (trim + uppercase) before querying", async ({
    page,
  }) => {
    const { requestedOrderNumbers } = await mockOrderStatus(page, {
      body: orderRecord({
        orderNumber: "ORD-ABC-1",
        currentStage: "Consultation",
        stages: ["Consultation", "Delivery"],
      }),
    });

    await page.goto("/track");
    await page.getByTestId("input-order-number").fill("  ord-abc-1  ");
    await page.getByTestId("button-lookup").click();

    await expect(page.getByTestId("status-success")).toBeVisible();
    expect(requestedOrderNumbers).toContain("ORD-ABC-1");
  });

  // The two tracking flows were consolidated onto /track; the old split URLs
  // (bookmarks, the Stripe cancel_url, the shop-success deep link) must keep
  // working by redirecting there, preserving any ?orderNumber= prefill.
  test("redirects the legacy /shop/status URL to /track", async ({ page }) => {
    await page.goto("/shop/status");

    await expect(page).toHaveURL(/\/track$/);
    await expect(page.getByTestId("input-order-number")).toBeVisible();
  });

  test("redirects the legacy shop-order URL to /track and looks up the prefilled number", async ({
    page,
  }) => {
    const { requestedOrderNumbers } = await mockShopOrderStatus(page, {
      body: {
        orderNumber: "SHP-ABC-1234",
        status: "Processing",
        statuses: ["Payment Confirmed", "Processing", "Shipped"],
        total: 44,
      },
    });

    await page.goto("/shop/order-status?orderNumber=SHP-ABC-1234");

    await expect(page).toHaveURL(/\/track\?orderNumber=SHP-ABC-1234$/);
    await expect(page.getByTestId("status-success")).toBeVisible();
    expect(requestedOrderNumbers).toContain("SHP-ABC-1234");
  });
});
