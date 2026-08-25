import { test, expect } from "@playwright/test";

// The portfolio read — `GET /api/portfolio` against the live Notion "Design
// Portfolio & Sketch Library", rendered by `pages/portfolio.tsx`.
//
// Worth monitoring for the same reason the testimonials read is: the endpoint
// is DEGRADE-SAFE in both the states a human has to fix. An unset
// `NOTION_PORTFOLIO_DATABASE_ID` and a Notion 404 (the integration was never
// shared with the database) both answer 200 with an empty gallery rather than
// erroring — deliberately, so a marketing page never 500s over configuration.
// The cost of that choice is exactly this ambiguity: an empty list means EITHER
// "nothing is published yet" OR "the read is broken". The API cannot tell those
// apart, so neither can this test until the atelier opts in below.
//
// Read-only throughout: the app never writes this database, and the projection
// carries no customer, order, or email — a piece's Notion row relates to the
// order it was made for and none of that is served.

// Opt-in strictness, the same gate as SMOKE_EXPECT_REVIEWS. Set
// SMOKE_EXPECT_PORTFOLIO=1 once the atelier has ticked "Show on website" on at
// least one piece, and this stops accepting an empty gallery — which is what
// turns the ambiguous signal above into a real one.
const EXPECT_PIECES = process.env.SMOKE_EXPECT_PORTFOLIO === "1";

type PortfolioFacet = { id?: string; values?: string[] };
type PortfolioPiece = {
  id?: string;
  title?: string;
  images?: string[];
  facets?: PortfolioFacet[];
  publishedAt?: string;
};
type PortfolioFilter = { id?: string; label?: string; options?: string[] };

test.describe("Production smoke: portfolio gallery", () => {
  test("the gallery read answers with a well-formed payload", async ({
    request,
  }) => {
    const res = await request.get("/api/portfolio");
    expect(
      res.status(),
      "GET /api/portfolio did not answer 200 — the portfolio page would render its error state",
    ).toBe(200);

    const body = (await res.json()) as {
      pieces?: PortfolioPiece[];
      filters?: PortfolioFilter[];
    };
    expect(Array.isArray(body.pieces)).toBe(true);
    expect(Array.isArray(body.filters)).toBe(true);

    const pieces = body.pieces ?? [];
    const filters = body.filters ?? [];

    if (EXPECT_PIECES) {
      expect(
        pieces.length,
        "SMOKE_EXPECT_PORTFOLIO=1 but the site is serving no pieces — either the Notion read is failing, the database was never shared with the integration, or every piece was unpublished",
      ).toBeGreaterThan(0);
    }

    for (const piece of pieces) {
      expect(typeof piece.id).toBe("string");
      expect(typeof piece.title).toBe("string");

      // A published piece always has at least one image — `isPublishable`
      // refuses a row without one precisely so the grid never shows a hole.
      expect(Array.isArray(piece.images)).toBe(true);
      expect(
        piece.images?.length,
        `portfolio piece ${piece.id} was served with no image`,
      ).toBeGreaterThan(0);
      for (const image of piece.images ?? []) {
        expect(typeof image).toBe("string");
        expect(image).toMatch(/^https:\/\//);
      }

      // A facet is omitted when empty rather than sent blank, so an empty
      // `values` here means the projection has drifted.
      for (const facet of piece.facets ?? []) {
        expect(typeof facet.id).toBe("string");
        expect(facet.values?.length).toBeGreaterThan(0);
      }

      // The row relates to the order it was made for. None of that is in the
      // contract; if it ever appears, the projection has widened past it.
      expect(piece).not.toHaveProperty("email");
      expect(piece).not.toHaveProperty("orderNumber");
      expect(piece).not.toHaveProperty("customerName");
    }

    // Every chip has to be backed by a piece in the same response — the filters
    // are derived from the pieces served, so an option nothing carries would
    // mean a visitor can click their way to a guaranteed-empty grid.
    for (const filter of filters) {
      expect(typeof filter.label).toBe("string");
      expect(
        filter.options?.length,
        `filter ${filter.id} was served with fewer than two options, so it filters nothing`,
      ).toBeGreaterThan(1);

      for (const option of filter.options ?? []) {
        const backed = pieces.some((piece) =>
          piece.facets?.some(
            (facet) => facet.id === filter.id && facet.values?.includes(option),
          ),
        );
        expect(
          backed,
          `filter ${filter.id} offers "${option}", which no served piece carries`,
        ).toBe(true);
      }
    }
  });

  test("the gallery page renders", async ({ page }) => {
    await page.goto("/portfolio");
    await expect(
      page.getByRole("heading", { name: "The Portfolio", level: 1 }),
    ).toBeVisible();
    // One of the four terminal states must render — never a page still
    // spinning, which is what a hung read looks like to a visitor.
    await expect(
      page
        .getByTestId("portfolio-grid")
        .or(page.getByTestId("portfolio-empty"))
        .or(page.getByTestId("portfolio-error")),
    ).toBeVisible();
  });
});
