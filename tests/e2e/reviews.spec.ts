import { test, expect } from "@playwright/test";
import {
  reviewInput,
  reviewRecord,
  GENERIC_ERROR,
} from "@workspace/test-fixtures";
import { mockReviews, mockCreateReview } from "./support/mock-api";

const REVIEW = reviewInput();

test.describe("Reviews page", () => {
  test("displays published reviews from the API", async ({ page }) => {
    await mockReviews(page, {
      body: {
        reviews: [
          reviewRecord({ id: "r1", name: "Ada", body: "Beautiful dress." }),
        ],
      },
    });

    await page.goto("/reviews");

    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
    await expect(page.getByTestId("review-r1")).toBeVisible();
    await expect(page.getByText("Beautiful dress.")).toBeVisible();
  });

  test("shows the empty state when there are no reviews", async ({ page }) => {
    await mockReviews(page, { body: { reviews: [] } });

    await page.goto("/reviews");

    await expect(page.getByTestId("reviews-empty")).toBeVisible();
  });

  test("submits a review and shows the thank-you screen (API mocked)", async ({
    page,
  }) => {
    await mockReviews(page, { body: { reviews: [] } });
    const { requests } = await mockCreateReview(page, {
      body: { success: true },
    });

    await page.goto("/reviews");

    await page.locator("#orderNumber").fill(REVIEW.orderNumber);
    await page.locator("#email").fill(REVIEW.email);
    await page.locator("#name").fill(REVIEW.name);
    await page.getByRole("radio", { name: "5 stars" }).click();
    await page.locator("#body").fill(REVIEW.body);
    await page.getByRole("button", { name: "Submit Review" }).click();

    await expect(
      page.getByRole("heading", { name: "Thank You" }),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      orderNumber: REVIEW.orderNumber,
      email: REVIEW.email,
      rating: 5,
    });
  });

  test("shows a destructive toast when the order can't be verified", async ({
    page,
  }) => {
    await mockReviews(page, { body: { reviews: [] } });
    await mockCreateReview(page, {
      status: 403,
      body: { error: GENERIC_ERROR },
    });

    await page.goto("/reviews");

    await page.locator("#orderNumber").fill(REVIEW.orderNumber);
    await page.locator("#email").fill(REVIEW.email);
    await page.locator("#name").fill(REVIEW.name);
    await page.getByRole("radio", { name: "5 stars" }).click();
    await page.locator("#body").fill(REVIEW.body);
    await page.getByRole("button", { name: "Submit Review" }).click();

    await expect(
      page.getByText("Review couldn't be submitted", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Thank You" })).toHaveCount(
      0,
    );
  });
});
