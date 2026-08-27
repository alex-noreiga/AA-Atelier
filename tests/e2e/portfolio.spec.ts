import { test, expect } from "./support/test";
import {
  mockInstagramFeed,
  mockPortfolio,
  mockPublishedReviews,
} from "./support/mock-api";

// The gallery in a real browser: the chips the server derived actually narrow
// the grid, and combining two of them ANDs. The render states (loading, error,
// empty) are covered far faster in jsdom by `portfolio.test.tsx`; what's left
// here is the real routing + interaction path, plus the one thing jsdom can't
// show — that a visitor reaches the page from the navbar at all.
//
// Only /api/portfolio is mocked, so the real generated-client fetch runs.

const GALLERY = {
  pieces: [
    {
      id: "piece-1",
      title: "Toothless",
      images: ["https://notion.test/toothless.png"],
      facets: [
        { id: "type", values: ["Completed Dress"] },
        { id: "discipline", values: ["Freestyle"] },
      ],
      publishedAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "piece-2",
      title: "Knight of Midnight",
      images: ["https://notion.test/knight.png"],
      facets: [
        { id: "type", values: ["Preliminary Sketch"] },
        { id: "discipline", values: ["Ice Dance"] },
      ],
      publishedAt: "2026-05-01T00:00:00.000Z",
    },
  ],
  filters: [
    {
      id: "type",
      label: "Type",
      options: ["Completed Dress", "Preliminary Sketch"],
    },
    {
      id: "discipline",
      label: "Discipline",
      options: ["Freestyle", "Ice Dance"],
    },
  ],
};

test.describe("Portfolio gallery", () => {
  test("reaches the gallery from the navbar", async ({ page, isMobile }) => {
    await mockPortfolio(page, { body: GALLERY });
    // The home page renders the testimonial strip, which fetches on its own.
    await mockPublishedReviews(page);
    await mockInstagramFeed(page);

    await page.goto("/");
    if (isMobile) {
      await page.getByTestId("button-menu").click();
      await page.getByTestId("nav-mobile-portfolio").click();
    } else {
      await page.getByTestId("nav-portfolio").click();
    }

    await expect(page).toHaveURL(/\/portfolio$/);
    await expect(page.getByTestId("portfolio-piece")).toHaveCount(2);
  });

  test("narrows the grid by one chip, then ANDs a second", async ({ page }) => {
    await mockPortfolio(page, { body: GALLERY });
    await page.goto("/portfolio");

    await expect(page.getByTestId("portfolio-piece")).toHaveCount(2);

    await page.getByTestId("portfolio-filter-type-completed-dress").click();
    await expect(page.getByTestId("portfolio-piece")).toHaveCount(1);
    await expect(page.getByText("Toothless")).toBeVisible();

    // "Completed Dress" + "Ice Dance" describes neither piece.
    await page.getByTestId("portfolio-filter-discipline-ice-dance").click();
    await expect(page.getByTestId("portfolio-piece")).toHaveCount(0);
    await expect(page.getByTestId("portfolio-no-results")).toBeVisible();

    // And the All chip is always the way back out.
    await page.getByTestId("portfolio-filter-discipline-all").click();
    await expect(page.getByTestId("portfolio-piece")).toHaveCount(1);
  });

  test("opens a piece's images in the lightbox", async ({ page }) => {
    await mockPortfolio(page, { body: GALLERY });
    await page.goto("/portfolio");

    await page.getByTestId("portfolio-view-piece-1").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Toothless")).toBeVisible();
  });
});
