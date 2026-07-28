import { describe, it, expect } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  costingPage,
  materialUsagePage,
} from "../support/fake-notion.js";
import {
  getCostingItem,
  getMaterialUsageLine,
} from "../../src/lib/notion/costing.repository.js";

describe("getCostingItem", () => {
  it("fetches the costing page by id and maps labor, suggested price, and usage lines", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/costing-1") {
        return jsonResponse(
          costingPage({
            id: "costing-1",
            laborCost: 40,
            suggestedPrice: 140,
            usageLineIds: ["u1", "u2"],
          }),
        );
      }
      throw new Error(`unexpected ${path}`);
    });

    const costing = await getCostingItem("costing-1", client);
    expect(costing).toEqual({
      pageId: "costing-1",
      laborCost: 40,
      suggestedPrice: 140,
      usageLineIds: ["u1", "u2"],
    });
  });

  it("defaults missing formula values to 0", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(
        costingPage({ id: "c", laborCost: null, suggestedPrice: null }),
      ),
    );
    const costing = await getCostingItem("c", client);
    expect(costing).toMatchObject({
      laborCost: 0,
      suggestedPrice: 0,
      usageLineIds: [],
    });
  });

  it("returns null when the costing page is gone (404)", async () => {
    const client = makeFakeClient(() => errorResponse(404, "not found"));
    expect(await getCostingItem("gone", client)).toBeNull();
  });

  it("throws on other non-ok responses", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    await expect(getCostingItem("c", client)).rejects.toThrow(/status 500/);
  });
});

describe("getMaterialUsageLine", () => {
  it("fetches the usage page by id and maps name, cost, and usage type", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(
        materialUsagePage({
          id: "u1",
          name: "Red chiffon",
          materialCost: 30,
          usageType: "Material",
        }),
      ),
    );

    const usage = await getMaterialUsageLine("u1", client);
    expect(usage).toEqual({
      pageId: "u1",
      name: "Red chiffon",
      materialCost: 30,
      usageType: "Material",
    });
  });

  it("returns null when the usage page is gone (404)", async () => {
    const client = makeFakeClient(() => errorResponse(404));
    expect(await getMaterialUsageLine("gone", client)).toBeNull();
  });
});
