import { describe, it, expect } from "vitest";
import {
  FACET_DEFINITIONS,
  PORTFOLIO_PUBLISH_PROPERTY,
  derivePortfolioFilters,
  extractFacetValues,
  extractPortfolioPieces,
  isPublishable,
  type NotionPortfolioPage,
} from "../../src/lib/notion/portfolio.schema.js";

/** A published row, with only the properties a test cares about overridden. */
function piecePage(
  overrides: Record<string, unknown> = {},
  meta: { id?: string; created_time?: string } = {},
): NotionPortfolioPage {
  return {
    id: meta.id ?? "piece-1",
    ...(meta.created_time === undefined
      ? { created_time: "2026-06-01T00:00:00.000Z" }
      : { created_time: meta.created_time }),
    properties: {
      Name: { type: "title", title: [{ plain_text: "Toothless" }] },
      "Image / Sketch": {
        type: "files",
        files: [{ type: "file", file: { url: "https://notion.test/a.png" } }],
      },
      [PORTFOLIO_PUBLISH_PROPERTY]: { type: "checkbox", checkbox: true },
      ...overrides,
    },
  } as NotionPortfolioPage;
}

describe("isPublishable", () => {
  it("publishes a ticked row that has an image", () => {
    expect(isPublishable(piecePage())).toBe(true);
  });

  it("withholds a row whose checkbox is unticked", () => {
    expect(
      isPublishable(
        piecePage({
          [PORTFOLIO_PUBLISH_PROPERTY]: { type: "checkbox", checkbox: false },
        }),
      ),
    ).toBe(false);
  });

  it("withholds a row when the publish property does not exist at all", () => {
    // The atelier hasn't added the column yet: the database predates the
    // gallery, and every row in it must read as private until they opt one in.
    const page = piecePage();
    delete page.properties[PORTFOLIO_PUBLISH_PROPERTY];
    expect(isPublishable(page)).toBe(false);
  });

  it("withholds a ticked row with no image, so the grid never shows a hole", () => {
    expect(
      isPublishable(
        piecePage({ "Image / Sketch": { type: "files", files: [] } }),
      ),
    ).toBe(false);
  });
});

describe("extractFacetValues", () => {
  it("reads every option off a multi_select", () => {
    const page = piecePage({
      Discipline: {
        type: "multi_select",
        multi_select: [{ name: "Ice Dance" }, { name: "Freestyle" }],
      },
    });
    expect(extractFacetValues(page, "Discipline")).toEqual([
      "Ice Dance",
      "Freestyle",
    ]);
  });

  it("reads a single-select the same way, so the property's type can't silently cost a facet", () => {
    const page = piecePage({
      Discipline: { type: "select", select: { name: "Ice Dance" } },
    });
    expect(extractFacetValues(page, "Discipline")).toEqual(["Ice Dance"]);
  });

  it("reads rich_text, for a competition name typed rather than picked", () => {
    const page = piecePage({
      Competition: {
        type: "rich_text",
        rich_text: [{ plain_text: "Midwest " }, { plain_text: "Sectionals" }],
      },
    });
    expect(extractFacetValues(page, "Competition")).toEqual([
      "Midwest Sectionals",
    ]);
  });

  it("yields nothing for a property the database doesn't have", () => {
    expect(extractFacetValues(piecePage(), "Colorway")).toEqual([]);
  });

  it("drops blanks and duplicates", () => {
    const page = piecePage({
      Colorway: {
        type: "multi_select",
        multi_select: [
          { name: "Emerald" },
          { name: "  " },
          { name: " Emerald " },
        ],
      },
    });
    expect(extractFacetValues(page, "Colorway")).toEqual(["Emerald"]);
  });
});

describe("extractPortfolioPieces", () => {
  it("maps a published row to its public projection", () => {
    const [piece] = extractPortfolioPieces([
      piecePage({
        "Image / Sketch": {
          type: "files",
          files: [
            { type: "file", file: { url: "https://notion.test/a.png" } },
            { type: "external", external: { url: "https://cdn.test/b.jpg" } },
          ],
        },
        Type: { type: "select", select: { name: "Completed Dress" } },
      }),
    ]);

    expect(piece).toEqual({
      id: "piece-1",
      title: "Toothless",
      images: ["https://notion.test/a.png", "https://cdn.test/b.jpg"],
      facets: [{ id: "type", values: ["Completed Dress"] }],
      publishedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("drops every row that isn't published", () => {
    expect(
      extractPortfolioPieces([
        piecePage({
          [PORTFOLIO_PUBLISH_PROPERTY]: { type: "checkbox", checkbox: false },
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps a published row the atelier hasn't named — the photograph is the point", () => {
    const [piece] = extractPortfolioPieces([
      piecePage({ Name: { type: "title", title: [] } }),
    ]);
    expect(piece?.title).toBe("");
    expect(piece?.images).toHaveLength(1);
  });

  it("omits a dimension the piece carries no value for, rather than sending it empty", () => {
    const [piece] = extractPortfolioPieces([piecePage()]);
    expect(piece?.facets).toEqual([]);
  });

  it("orders newest first regardless of the order Notion paged them in", () => {
    const pieces = extractPortfolioPieces([
      piecePage({}, { id: "old", created_time: "2026-01-01T00:00:00.000Z" }),
      piecePage({}, { id: "new", created_time: "2026-08-01T00:00:00.000Z" }),
      piecePage({}, { id: "mid", created_time: "2026-04-01T00:00:00.000Z" }),
    ]);
    expect(pieces.map((p) => p.id)).toEqual(["new", "mid", "old"]);
  });

  it("omits publishedAt when Notion returned no created time", () => {
    const [piece] = extractPortfolioPieces([
      piecePage({}, { created_time: "" }),
    ]);
    expect(piece).not.toHaveProperty("publishedAt");
  });
});

describe("derivePortfolioFilters", () => {
  const withType = (id: string, type: string) =>
    extractPortfolioPieces([
      piecePage({ Type: { type: "select", select: { name: type } } }, { id }),
    ])[0]!;

  it("offers a dimension the published work varies along, options alphabetical", () => {
    const filters = derivePortfolioFilters([
      withType("a", "Preliminary Sketch"),
      withType("b", "Completed Dress"),
    ]);

    expect(filters).toEqual([
      {
        id: "type",
        label: "Type",
        options: ["Completed Dress", "Preliminary Sketch"],
      },
    ]);
  });

  it("omits a dimension every piece answers the same way — a chip that filters nothing", () => {
    expect(
      derivePortfolioFilters([
        withType("a", "Completed Dress"),
        withType("b", "Completed Dress"),
      ]),
    ).toEqual([]);
  });

  it("omits a dimension no piece carries at all", () => {
    expect(
      derivePortfolioFilters(extractPortfolioPieces([piecePage()])),
    ).toEqual([]);
  });

  it("returns dimensions in the catalog's declared order, not discovery order", () => {
    const page = piecePage({
      Type: { type: "select", select: { name: "Completed Dress" } },
      Discipline: {
        type: "multi_select",
        multi_select: [{ name: "Ice Dance" }],
      },
    });
    const other = piecePage(
      {
        Type: { type: "select", select: { name: "Digital Mockup" } },
        Discipline: {
          type: "multi_select",
          multi_select: [{ name: "Freestyle" }],
        },
      },
      { id: "piece-2" },
    );

    const ids = derivePortfolioFilters(
      extractPortfolioPieces([other, page]),
    ).map((f) => f.id);

    expect(ids).toEqual(["type", "discipline"]);
    expect(FACET_DEFINITIONS.map((f) => f.id).slice(0, 2)).toEqual(ids);
  });

  it("never offers an option no served piece carries", () => {
    const pieces = extractPortfolioPieces([
      piecePage(
        { Type: { type: "select", select: { name: "A" } } },
        { id: "1" },
      ),
      piecePage(
        { Type: { type: "select", select: { name: "B" } } },
        { id: "2" },
      ),
    ]);
    const options = derivePortfolioFilters(pieces)[0]!.options;

    for (const option of options) {
      expect(
        pieces.some((p) =>
          p.facets.some((f) => f.id === "type" && f.values.includes(option)),
        ),
      ).toBe(true);
    }
  });
});
