import { test, expect } from "./support/test";
import { orderRecord } from "@workspace/test-fixtures";
import { mockOrderStatus, mockShopOrderStatus } from "./support/mock-api";

test.describe("Order status lookup", () => {
  test("renders the timeline with the active stage highlighted", async ({
    page,
  }) => {
    await mockOrderStatus(page, {
      body: orderRecord({
        orderNumber: "ORD-ABC-1",
        estimatedCompletion: "2026-08-01",
        milestones: [{ stage: "Delivery", targetDate: "2026-08-01" }],
      }),
    });

    await page.goto("/track");
    await page.getByTestId("input-order-number").fill("ORD-ABC-1");
    await page.getByTestId("button-lookup").click();

    const success = page.getByTestId("status-success");
    await expect(success).toBeVisible();
    await expect(success.getByText("Order ORD-ABC-1")).toBeVisible();

    // The atelier's target completion date is surfaced on the timeline.
    await expect(page.getByTestId("estimated-completion")).toContainText(
      "August 1, 2026",
    );
    // A per-stage milestone date renders on its stage row.
    await expect(page.getByTestId("stage-target-2")).toContainText(
      "August 1, 2026",
    );
    await expect(
      success.getByRole("heading", { name: "Ada – Custom Dress" }),
    ).toBeVisible();

    // All three stages render, in order.
    await expect(page.getByTestId("row-stage-0")).toContainText("Consultation");
    await expect(page.getByTestId("row-stage-1")).toContainText(
      "Sewing/Construction",
    );
    await expect(page.getByTestId("row-stage-2")).toContainText("Delivery");

    // The active stage shows its description; completed stages read "Completed".
    await expect(page.getByTestId("row-stage-1")).toContainText(
      "sewing and constructing",
    );
    await expect(page.getByTestId("row-stage-0")).toContainText("Completed");
  });

  test("shows a not-found message and can reset for a missing order", async ({
    page,
  }) => {
    await mockOrderStatus(page, {
      status: 404,
      body: { message: "We couldn't find an order with that number." },
    });

    await page.goto("/track");
    await page.getByTestId("input-order-number").fill("ORD-NOPE");
    await page.getByTestId("button-lookup").click();

    const error = page.getByTestId("status-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("couldn't find an order");

    // Reset returns to the lookup form.
    await page.getByTestId("button-try-again").click();
    await expect(page.getByTestId("input-order-number")).toBeVisible();
  });

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
