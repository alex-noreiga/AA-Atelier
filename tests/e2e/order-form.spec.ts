import { test, expect } from "@playwright/test";
import { createOrderInput, GENERIC_ERROR } from "@workspace/test-fixtures";
import { mockCreateOrder } from "./support/mock-api";

// Measurements come from the shared fixture, but the *identity* stays
// Playwright-specific on purpose: the opt-in live-Notion test below submits
// this same form against the real database, and the atelier team relies on
// those rows being recognisable as test writes.
const E2E_ORDER = createOrderInput({
  fullName: "Playwright Test User",
  email: "playwright@example.com",
});

async function fillValidOrder(page: import("@playwright/test").Page) {
  await page.locator("#fullName").fill(E2E_ORDER.fullName);
  await page.locator("#email").fill(E2E_ORDER.email);
  await page.locator("#phone").fill(E2E_ORDER.phone);
  await page.getByRole("button", { name: "Email" }).click();
  await page.locator("#waist").fill(String(E2E_ORDER.waist));
  await page.locator("#bust").fill(String(E2E_ORDER.bust));
  await page.locator("#hips").fill(String(E2E_ORDER.hips));
  await page.locator("#height").fill(String(E2E_ORDER.height));
  await page.locator("#bodyGirth").fill(String(E2E_ORDER.bodyGirth));
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

  test("submits without measurements when an appointment is requested (API mocked)", async ({
    page,
  }) => {
    await mockCreateOrder(page, { body: { orderNumber: "ORD-APPT-0001" } });

    await page.goto("/order");
    await page.locator("#fullName").fill(E2E_ORDER.fullName);
    await page.locator("#email").fill(E2E_ORDER.email);
    await page.locator("#phone").fill(E2E_ORDER.phone);
    await page.getByRole("button", { name: "Email" }).click();
    await page
      .getByRole("button", { name: "Take them at an appointment" })
      .click();

    // The measurement inputs are hidden in appointment mode.
    await expect(page.locator("#waist")).toHaveCount(0);

    await page.getByRole("button", { name: "Submit Order" }).click();

    await expect(
      page.getByRole("heading", { name: "Order Received" }),
    ).toBeVisible();
    await expect(
      page.getByText(/schedule your measurement appointment/i),
    ).toBeVisible();
    await expect(page.locator("p.font-mono")).toHaveText("ORD-APPT-0001");
  });

  test("shows a destructive toast when the API rejects the submission", async ({
    page,
  }) => {
    await mockCreateOrder(page, {
      status: 500,
      body: { error: GENERIC_ERROR },
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
