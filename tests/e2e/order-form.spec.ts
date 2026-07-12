import { test, expect } from "@playwright/test";
import { mockCreateOrder } from "./support/mock-api";

async function fillValidOrder(page: import("@playwright/test").Page) {
  await page.locator("#fullName").fill("Playwright Test User");
  await page.locator("#email").fill("playwright@example.com");
  await page.locator("#phone").fill("+1 555 000 1234");
  await page.getByRole("button", { name: "Email" }).click();
  await page.locator("#waist").fill("28");
  await page.locator("#bust").fill("36");
  await page.locator("#hips").fill("38");
  await page.locator("#height").fill("65");
  await page.locator("#bodyGirth").fill("32");
  await page.locator("#description").fill("A-line silhouette, ivory chiffon");
}

test.describe("Order form", () => {
  test("submits a valid order and shows the returned order number (API mocked)", async ({
    page,
  }) => {
    await mockCreateOrder(page, { body: { orderNumber: "ORD-TEST-0001" } });

    await page.goto("/order");
    await expect(
      page.getByRole("heading", { name: "Place an Order" }),
    ).toBeVisible();

    await fillValidOrder(page);
    await page.getByRole("button", { name: "Submit Order" }).click();

    await expect(
      page.getByRole("heading", { name: "Order Received" }),
    ).toBeVisible();
    await expect(page.getByText(/Thank you!/)).toBeVisible();
    await expect(page.locator("p.font-mono")).toHaveText("ORD-TEST-0001");
    await expect(
      page.getByRole("link", { name: /Track order status/i }),
    ).toBeVisible();
  });

  test("shows a destructive toast when the API rejects the submission", async ({
    page,
  }) => {
    await mockCreateOrder(page, {
      status: 500,
      body: { error: "Something went wrong. Please try again later." },
    });

    await page.goto("/order");
    await fillValidOrder(page);
    await page.getByRole("button", { name: "Submit Order" }).click();

    // `exact` avoids matching sonner's aria-live announcement span, which
    // concatenates the toast title and description into one text node.
    await expect(
      page.getByText("Submission failed", { exact: true }),
    ).toBeVisible();
    // Stays on the form; no success screen.
    await expect(
      page.getByRole("heading", { name: "Order Received" }),
    ).toHaveCount(0);
  });

  test("blocks submission and surfaces validation errors for an empty form", async ({
    page,
  }) => {
    let apiCalled = false;
    await page.route("**/api/orders", (route) => {
      apiCalled = true;
      return route.fallback();
    });

    await page.goto("/order");
    await page.getByRole("button", { name: "Submit Order" }).click();

    await expect(page.getByText("Full name is required")).toBeVisible();
    await expect(
      page.getByText("Please enter a valid email address"),
    ).toBeVisible();
    expect(apiCalled).toBe(false);
  });
});

// Opt-in smoke test against the real Notion write path. Skipped by default so
// the suite stays deterministic and side-effect-free; run with
// `E2E_LIVE_NOTION=1` (and a running api-server) to exercise it.
test.describe("Order form — live Notion (opt-in)", () => {
  test.skip(
    !process.env.E2E_LIVE_NOTION,
    "Set E2E_LIVE_NOTION=1 to run the live Notion write smoke test",
  );

  test("submits a real order and returns a live ORD- number", async ({
    page,
  }) => {
    await page.goto("/order");
    await fillValidOrder(page);
    await page.getByRole("button", { name: "Submit Order" }).click();

    await expect(
      page.getByRole("heading", { name: "Order Received" }),
    ).toBeVisible({ timeout: 20_000 });

    const orderNumber = await page.locator("p.font-mono").textContent();
    expect(orderNumber).toMatch(/^ORD-[A-Z0-9]+-[A-Z0-9]+$/);
  });
});
