import { describe, it, expect } from "vitest";
import {
  extractPortfolioItem,
  extractIsPublished,
  extractCategoryOptions,
} from "../../src/lib/notion/portfolio.schema.js";
import {
  portfolioPage,
  portfolioDatabaseSchemaWithCategories,
} from "../support/fake-notion.js";

describe("extractPortfolioItem", () => {
  it("maps title, photos, category, and caption", () => {
    const page = portfolioPage({
      id: "i1",
      title: "Aurora Ice Dance Dress",
      category: "Dresses",
      caption: "Ombré chiffon with hand-set rhinestones",
      photos: ["https://img/one.jpg", "https://img/two.jpg"],
    });

    expect(extractPortfolioItem(page as never)).toEqual({
      id: "i1",
      title: "Aurora Ice Dance Dress",
      category: "Dresses",
      caption: "Ombré chiffon with hand-set rhinestones",
      photos: ["https://img/one.jpg", "https://img/two.jpg"],
    });
  });

  it("omits an absent category and caption and defaults photos to empty", () => {
    const page = portfolioPage({ id: "i2", title: "Nocturne Leotard" });

    expect(extractPortfolioItem(page as never)).toEqual({
      id: "i2",
      title: "Nocturne Leotard",
      photos: [],
    });
  });
});

describe("extractIsPublished", () => {
  it("reflects the publish checkbox", () => {
    expect(
      extractIsPublished(portfolioPage({ published: true }) as never),
    ).toBe(true);
    expect(
      extractIsPublished(portfolioPage({ published: false }) as never),
    ).toBe(false);
  });
});

describe("extractCategoryOptions", () => {
  it("returns the live Category select options in order", () => {
    const schema = portfolioDatabaseSchemaWithCategories([
      "Dresses",
      "Leotards",
      "Accessories",
    ]);
    expect(extractCategoryOptions(schema as never)).toEqual([
      "Dresses",
      "Leotards",
      "Accessories",
    ]);
  });

  it("returns an empty list when the Category property is absent", () => {
    expect(extractCategoryOptions({ properties: {} } as never)).toEqual([]);
  });
});
