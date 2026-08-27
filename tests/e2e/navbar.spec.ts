import { test, expect } from "./support/test";
import { mockInstagramFeed, mockPublishedReviews } from "./support/mock-api";

// The navbar fetches nothing, and the status page calls the API only on submit.
// Two endpoints still need stubbing to satisfy the unmocked-/api guard: the home
// page these specs start from fetches its testimonial strip and its Instagram
// strip. Both render nothing when empty, which is what these specs want.
//
// Only what a real browser can settle lives here — that a dropdown item actually
// navigates, and that Escape dismisses the menu. The link set, the active-state
// highlighting, and the mobile menu's inline children are covered in
// web-app/test/navbar.test.tsx.

test.describe("Navbar", () => {
  test.beforeEach(async ({ page }) => {
    await mockPublishedReviews(page);
    await mockInstagramFeed(page);
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
});
