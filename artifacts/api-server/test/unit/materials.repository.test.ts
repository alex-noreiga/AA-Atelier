import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listMaterials,
  materialsConfigured,
  __resetMaterialsCache,
} from "../../src/lib/notion/materials.repository.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

function materialPage(name: string, id = "mat-1") {
  return {
    id,
    properties: {
      "Item Name": { type: "title", title: [{ plain_text: name }] },
      "Stock on Hand": { type: "formula", formula: { number: 2 } },
      "Minimum Stock": { type: "number", number: 1 },
    },
  };
}

beforeEach(() => {
  __resetMaterialsCache();
});

describe("materialsConfigured", () => {
  it("is false when the materials database id is unset", () => {
    expect(
      materialsConfigured(makeFakeClient(() => jsonResponse({}), "")),
    ).toBe(false);
  });

  it("is true when a database id is configured", () => {
    expect(materialsConfigured(makeFakeClient(() => jsonResponse({})))).toBe(
      true,
    );
  });
});

describe("listMaterials", () => {
  it("throws when the materials database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(listMaterials(client)).rejects.toThrow(
      /NOTION_MATERIALS_DATABASE_ID is not configured/,
    );
  });

  it("scans the database and maps every row", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [materialPage("Black Fleece")],
        has_more: false,
      }),
    );

    const materials = await listMaterials(client);

    expect(materials).toHaveLength(1);
    expect(materials[0].name).toBe("Black Fleece");
    expect(client.calls[0].path).toBe("/v1/databases/test-db-id/query");
  });

  it("follows the cursor across pages", async () => {
    let call = 0;
    const client = makeFakeClient(() => {
      call += 1;
      return call === 1
        ? jsonResponse({
            results: [materialPage("Black Fleece", "a")],
            has_more: true,
            next_cursor: "cursor-2",
          })
        : jsonResponse({
            results: [materialPage("White Fleece", "b")],
            has_more: false,
          });
    });

    const materials = await listMaterials(client);
    expect(materials.map((m) => m.name)).toEqual([
      "Black Fleece",
      "White Fleece",
    ]);
  });

  it("serves the cached scan within the TTL rather than re-reading", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [materialPage("Black Fleece")],
        has_more: false,
      }),
    );

    await listMaterials(client);
    await listMaterials(client);

    expect(client.calls).toHaveLength(1);
  });

  // A Notion blip should degrade to slightly stale numbers, not an empty
  // shopping list that reads as "nothing is low".
  it("falls back to the cached scan when a later read fails", async () => {
    let fail = false;
    const client = makeFakeClient(() =>
      fail
        ? errorResponse(502, "bad gateway")
        : jsonResponse({
            results: [materialPage("Black Fleece")],
            has_more: false,
          }),
    );

    vi.useFakeTimers();
    try {
      await listMaterials(client);
      // Past the 60s TTL, so the next call really re-reads — and fails.
      vi.advanceTimersByTime(61_000);
      fail = true;

      const materials = await listMaterials(client);
      expect(materials.map((m) => m.name)).toEqual(["Black Fleece"]);
      expect(client.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when the read fails and nothing has ever been cached", async () => {
    const client = makeFakeClient(() => errorResponse(502, "bad gateway"));
    await expect(listMaterials(client)).rejects.toThrow();
  });
});
