import { test, expect } from "./support/test";
import { createOrderInput, GENERIC_ERROR } from "@workspace/test-fixtures";
import { mockCreateOrder, mockColors } from "./support/mock-api";

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
}

// The intake is a three-step flow: your details, then the optional design step
// (colors + costume details), then the optional timeline step where the order
// is placed. Advance from step 0 to the design step.
async function continueToDesign(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Continue to your design/i }).click();
  await expect(
    page.getByRole("button", { name: /Continue to timeline/i }),
  ).toBeVisible();
}

// Advance from the design step to the final (timeline) step.
async function continueToTimeline(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /Continue to timeline/i }).click();
  await expect(
    page.getByRole("button", { name: "Submit Order" }),
  ).toBeVisible();
}

// Walk from step 0 to the final step, filling the one design field the fixture
// carries (the description) on the way through.
async function continueToSubmit(page: import("@playwright/test").Page) {
  await continueToDesign(page);
  await page.locator("#description").fill("A-line silhouette, ivory chiffon");
  await continueToTimeline(page);
}

test.describe("Order form", () => {
  // The intake form loads its color palette on mount; mock it so the
  // unmocked-/api guard stays satisfied on every page load in this suite.
  test.beforeEach(async ({ page }) => {
    await mockColors(page);
  });

  test("submits a valid order and shows the returned order number (API mocked)", async ({
    page,
  }) => {
    await mockCreateOrder(page, { body: { orderNumber: "ORD-TEST-0001" } });

    await page.goto("/order");
    await expect(
      page.getByRole("heading", { name: "Place an Order" }),
    ).toBeVisible();

    await fillValidOrder(page);
    await continueToSubmit(page);
    await page.getByRole("button", { name: "Submit Order" }).click();

    await expect(
      page.getByRole("heading", { name: "Order Received" }),
    ).toBeVisible();
    await expect(page.getByText(/Thank you!/)).toBeVisible();
    await expect(page.getByTestId("order-number")).toHaveText("ORD-TEST-0001");
    await expect(
      page.getByRole("link", { name: /Track order status/i }),
    ).toBeVisible();
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
    await continueToSubmit(page);
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
    await continueToSubmit(page);
    await page.getByRole("button", { name: "Submit Order" }).click();

    await expect(
      page.getByRole("heading", { name: "Order Received" }),
    ).toBeVisible({ timeout: 20_000 });

    const orderNumber = await page.getByTestId("order-number").textContent();
    expect(orderNumber).toMatch(/^ORD-[A-Z0-9]+-[A-Z0-9]+$/);
  });
});
