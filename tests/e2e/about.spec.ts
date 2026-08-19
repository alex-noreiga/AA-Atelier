import { test, expect } from "./support/test";
import { mockPublishedReviews } from "./support/mock-api";

const FIRST_QUESTION = "How long does a custom costume take?";
const SECOND_QUESTION = "How do I get measured?";

// The page's copy is static; the one thing it fetches is the curated
// testimonial strip, stubbed empty for the FAQ cases below.

test.describe("About FAQ", () => {
  test.beforeEach(async ({ page }) => {
    await mockPublishedReviews(page);
  });

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
    await expect(answer).toContainText(/four to eight weeks/i);
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

test.describe("About testimonials", () => {
  test("shows the reviews the atelier has published", async ({ page }) => {
    await mockPublishedReviews(page, {
      body: {
        reviews: [
          {
            id: "rev-1",
            rating: 5,
            comment: "The fit was perfect the first time on the ice.",
            customerName: "Ada L.",
            publishedAt: "2026-07-04T09:30:00.000Z",
          },
        ],
      },
    });
    await page.goto("/about");

    const testimonial = page.getByTestId("testimonial");
    await expect(testimonial).toHaveCount(1);
    await expect(testimonial).toContainText("The fit was perfect");
    await expect(testimonial).toContainText("Ada L. \u00b7 July 2026");
  });

  test("omits the section entirely when nothing is published", async ({
    page,
  }) => {
    await mockPublishedReviews(page);
    await page.goto("/about");

    // The page still renders; only the strip is absent.
    await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
    await expect(page.getByTestId("testimonials")).toHaveCount(0);
  });
});
