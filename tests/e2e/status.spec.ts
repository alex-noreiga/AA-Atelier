import { test, expect } from "@playwright/test";
import { mockOrderStatus } from "./support/mock-api";

test.describe("Order status lookup", () => {
  test("renders the timeline with the active stage highlighted", async ({
    page,
  }) => {
    await mockOrderStatus(page, {
      body: {
        orderNumber: "ORD-ABC-1",
        orderName: "Ada – Custom Dress",
        currentStage: "Sewing/Construction",
        stages: ["Consultation", "Sewing/Construction", "Delivery"],
      },
    });

    await page.goto("/shop/status");
    await page.getByTestId("input-order-number").fill("ORD-ABC-1");
    await page.getByTestId("button-lookup").click();

    const success = page.getByTestId("status-success");
    await expect(success).toBeVisible();
    await expect(success.getByText("Order ORD-ABC-1")).toBeVisible();
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

    await page.goto("/shop/status");
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
      body: {
        orderNumber: "ORD-ABC-1",
        orderName: "Ada – Custom Dress",
        currentStage: "Consultation",
        stages: ["Consultation", "Delivery"],
      },
    });

    await page.goto("/shop/status");
    await page.getByTestId("input-order-number").fill("  ord-abc-1  ");
    await page.getByTestId("button-lookup").click();

    await expect(page.getByTestId("status-success")).toBeVisible();
    expect(requestedOrderNumbers).toContain("ORD-ABC-1");
  });
});
