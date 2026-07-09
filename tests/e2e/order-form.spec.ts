import { test, expect } from "@playwright/test";

test.describe("Order form end-to-end", () => {
  test("submits a valid order and shows a real order number on the success screen", async ({
    page,
  }) => {
    await page.goto("/order");

    await expect(page.getByRole("heading", { name: "Place an Order" })).toBeVisible();

    await page.locator("#fullName").fill("Playwright Test User");
    await page.locator("#email").fill("playwright@example.com");
    await page.locator("#phone").fill("+1 555 000 1234");

    await page.getByRole("button", { name: "Email" }).click();

    await page.locator("#waist").fill("28");
    await page.locator("#bust").fill("36");
    await page.locator("#hips").fill("38");
    await page.locator("#height").fill("65");
    await page.locator("#bodyGirth").fill("32");

    await page.locator("#description").fill("A-line silhouette, ivory chiffon — automated test order");

    await page.getByRole("button", { name: "Submit Order" }).click();

    await expect(page.getByRole("heading", { name: "Order Received" })).toBeVisible({
      timeout: 20_000,
    });

    await expect(page.getByText(/Thank you!/)).toBeVisible();

    const orderNumberEl = page.locator("p.font-mono");
    await expect(orderNumberEl).toBeVisible();

    const orderNumber = await orderNumberEl.textContent();
    expect(orderNumber).toMatch(/^ORD-[A-Z0-9]+-[A-Z0-9]+$/);

    await expect(page.getByRole("link", { name: /Track order status/i })).toBeVisible();
  });
});
