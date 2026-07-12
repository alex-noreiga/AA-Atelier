import { test, expect } from "@playwright/test";

const FIRST_QUESTION = "How long does a custom costume take?";
const SECOND_QUESTION = "How do I get measured?";

// The About page fetches nothing, so no API mocking is needed here.

test.describe("About FAQ", () => {
  test("expands an answer when its question is clicked", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Frequently asked" }),
    ).toBeVisible();

    const answer = page.getByRole("region", { name: FIRST_QUESTION });
    await expect(answer).toBeHidden();

    await page.getByRole("button", { name: FIRST_QUESTION }).click();

    await expect(answer).toBeVisible();
    await expect(answer).toContainText(/six to eight weeks/i);
  });

  test("keeps only one answer open at a time", async ({ page }) => {
    await page.goto("/about");

    await page.getByRole("button", { name: FIRST_QUESTION }).click();
    await page.getByRole("button", { name: SECOND_QUESTION }).click();

    await expect(
      page.getByRole("region", { name: SECOND_QUESTION }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: FIRST_QUESTION }),
    ).toBeHidden();
  });
});
