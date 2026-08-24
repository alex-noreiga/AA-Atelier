import { describe, it, expect } from "vitest";
import {
  FACET_DEFINITIONS,
  PORTFOLIO_PUBLISH_PROPERTY,
  derivePortfolioFilters,
  extractFacetValues,
  extractPortfolioImages,
  extractPortfolioPieces,
  isPublishable,
  portfolioSortKey,
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
    expect(extractFacetValues(page, ["Discipline"])).toEqual([
      "Ice Dance",
      "Freestyle",
    ]);
  });

  it("reads a single-select the same way, so the property's type can't silently cost a facet", () => {
    const page = piecePage({
      Discipline: { type: "select", select: { name: "Ice Dance" } },
    });
    expect(extractFacetValues(page, ["Discipline"])).toEqual(["Ice Dance"]);
  });

  it("reads rich_text, for a competition name typed rather than picked", () => {
    const page = piecePage({
      Competition: {
        type: "rich_text",
        rich_text: [{ plain_text: "Midwest " }, { plain_text: "Sectionals" }],
      },
    });
    expect(extractFacetValues(page, ["Competition"])).toEqual([
      "Midwest Sectionals",
    ]);
  });

  it("yields nothing for a property the database doesn't have", () => {
    expect(extractFacetValues(piecePage(), ["Colorway"])).toEqual([]);
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
    expect(extractFacetValues(page, ["Colorway"])).toEqual(["Emerald"]);
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
        label: "Stage",
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

describe("facet property aliases", () => {
  it("reads the renamed property when the atelier has moved on", () => {
    const page = piecePage({
      Stage: { type: "select", select: { name: "Delivered" } },
    });
    delete page.properties.Type;

    expect(extractFacetValues(page, ["Stage", "Type"])).toEqual(["Delivered"]);
  });

  it("still reads the old property when the rename hasn't happened yet", () => {
    const page = piecePage({
      Type: { type: "select", select: { name: "Completed Dress" } },
    });

    expect(extractFacetValues(page, ["Stage", "Type"])).toEqual([
      "Completed Dress",
    ]);
  });

  it("prefers the first listed property when a row carries both", () => {
    const page = piecePage({
      Stage: { type: "select", select: { name: "Delivered" } },
      Type: { type: "select", select: { name: "Completed Dress" } },
    });

    expect(extractFacetValues(page, ["Stage", "Type"])).toEqual(["Delivered"]);
  });

  it("declares Season and Technique alongside the original four", () => {
    expect(FACET_DEFINITIONS.map((f) => f.id)).toEqual([
      "type",
      "discipline",
      "season",
      "colorway",
      "technique",
      "competition",
    ]);
  });
});

describe("extractPortfolioImages", () => {
  const files = (...urls: string[]) => ({
    type: "files",
    files: urls.map((url) => ({ type: "file", file: { url } })),
  });

  it("gathers a design's pictures across every image property", () => {
    const page = piecePage({
      Sketch: files("https://notion.test/sketch.png"),
      Mockup: files("https://notion.test/mockup.png"),
      Finished: files("https://notion.test/finished.png"),
      "Image / Sketch": files("https://notion.test/general.png"),
    });

    // Cover order: the finished photograph always leads, then whatever sits in
    // the general property, then the mockup and the sketch it began as.
    expect(extractPortfolioImages(page)).toEqual([
      "https://notion.test/finished.png",
      "https://notion.test/general.png",
      "https://notion.test/mockup.png",
      "https://notion.test/sketch.png",
    ]);
  });

  it("still works with everything in the one original property", () => {
    const page = piecePage({
      "Image / Sketch": files(
        "https://notion.test/a.png",
        "https://notion.test/b.png",
      ),
    });

    expect(extractPortfolioImages(page)).toEqual([
      "https://notion.test/a.png",
      "https://notion.test/b.png",
    ]);
  });

  it("counts the same file in two properties once", () => {
    const page = piecePage({
      Finished: files("https://notion.test/same.png"),
      "Image / Sketch": files("https://notion.test/same.png"),
    });

    expect(extractPortfolioImages(page)).toEqual([
      "https://notion.test/same.png",
    ]);
  });

  it("publishes a row whose only picture is in a new property", () => {
    const page = piecePage({
      Finished: files("https://notion.test/finished.png"),
      "Image / Sketch": { type: "files", files: [] },
    });

    expect(isPublishable(page)).toBe(true);
  });
});

describe("portfolioSortKey", () => {
  const dated = (id: string, completed: string, created: string) =>
    extractPortfolioPieces([
      piecePage(
        { Completed: { type: "date", date: { start: completed } } },
        { id, created_time: created },
      ),
    ])[0]!;

  it("orders by when the piece was finished, not when the row was typed", () => {
    // The regression this exists for: a piece made first but recorded later
    // used to lead the gallery purely because its row was newer.
    const pieces = extractPortfolioPieces([
      piecePage(
        { Completed: { type: "date", date: { start: "2026-01-10" } } },
        { id: "made-first", created_time: "2026-08-01T00:00:00.000Z" },
      ),
      piecePage(
        { Completed: { type: "date", date: { start: "2026-07-10" } } },
        { id: "made-second", created_time: "2026-02-01T00:00:00.000Z" },
      ),
    ]);

    expect(pieces.map((p) => p.id)).toEqual(["made-second", "made-first"]);
  });

  it("falls back to the row's created time when a piece isn't dated", () => {
    const [piece] = extractPortfolioPieces([
      piecePage(
        {},
        { id: "undated", created_time: "2026-03-01T00:00:00.000Z" },
      ),
    ]);

    expect(piece).not.toHaveProperty("completedAt");
    expect(portfolioSortKey(piece!)).toBe("2026-03-01T00:00:00.000Z");
  });

  it("orders dated and undated pieces against each other", () => {
    const pieces = extractPortfolioPieces([
      piecePage(
        {},
        { id: "undated-2026-04", created_time: "2026-04-01T00:00:00.000Z" },
      ),
      piecePage(
        { Completed: { type: "date", date: { start: "2026-06-01" } } },
        { id: "dated-2026-06", created_time: "2026-01-01T00:00:00.000Z" },
      ),
      piecePage(
        { Completed: { type: "date", date: { start: "2026-02-01" } } },
        { id: "dated-2026-02", created_time: "2026-12-01T00:00:00.000Z" },
      ),
    ]);

    expect(pieces.map((p) => p.id)).toEqual([
      "dated-2026-06",
      "undated-2026-04",
      "dated-2026-02",
    ]);
  });

  it("carries the completion date on the record", () => {
    expect(
      dated("d", "2026-05-05", "2026-01-01T00:00:00.000Z").completedAt,
    ).toBe("2026-05-05");
  });
});
