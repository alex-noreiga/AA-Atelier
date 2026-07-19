import { test, expect } from "./support/test";

// The navbar fetches nothing, and neither the order form nor the status page
// calls the API until it is submitted — so no API mocking is needed here.

test.describe("Navbar", () => {
  test("reaches the order form through the Services dropdown", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByTestId("nav-place-an-order")).toBeHidden();

    await page.getByTestId("nav-services").click();
    await page.getByTestId("nav-place-an-order").click();

    await expect(page).toHaveURL(/\/order$/);
    await expect(page.getByTestId("nav-services")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  test("reaches order tracking through the Services dropdown", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByTestId("nav-services").click();
    await page.getByTestId("nav-track-your-order").click();

    await expect(page).toHaveURL(/\/track$/);
    await expect(page.getByTestId("input-order-number")).toBeVisible();
    // /track belongs to Services, not Shop.
    await expect(page.getByTestId("nav-shop")).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  test("closes the dropdown on Escape", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("nav-services").click();
    await expect(page.getByTestId("nav-overview")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("nav-overview")).toBeHidden();
  });

  test("exposes the Services children inline in the mobile menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await page.getByTestId("button-menu").click();
    await expect(page.getByTestId("nav-mobile-place-an-order")).toBeVisible();

    await page.getByTestId("nav-mobile-track-your-order").click();

    await expect(page).toHaveURL(/\/track$/);
    await expect(page.getByTestId("input-order-number")).toBeVisible();
  });
});
