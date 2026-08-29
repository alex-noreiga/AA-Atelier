import { describe, it, expect, vi, beforeEach } from "vitest";

// The tracking lookup names the order's pieces only at the one moment the page
// asks the question — which makes "when is `items` present?" the behaviour worth
// pinning, since that presence is also what the page reads as "this order can be
// reviewed".
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderByNumber: vi.fn(),
  fetchLiveShopOrderStatuses: vi.fn(),
}));
vi.mock("../../src/services/products.service.js", () => ({
  findVariantNames: vi.fn(),
}));

import { getShopOrderStatus } from "../../src/services/shop-orders.service.js";
import {
  findShopOrderByNumber,
  fetchLiveShopOrderStatuses,
  type ShopOrderRecord,
} from "../../src/lib/notion/shop-orders.repository.js";
import { findVariantNames } from "../../src/services/products.service.js";
import { NotFoundError } from "../../src/lib/errors.js";

const mockFind = vi.mocked(findShopOrderByNumber);
const mockStatuses = vi.mocked(fetchLiveShopOrderStatuses);
const mockNames = vi.mocked(findVariantNames);

function order(overrides: Partial<ShopOrderRecord> = {}): ShopOrderRecord {
  return {
    orderNumber: "SHP-ABC-1234",
    status: "Delivered",
    itemIds: ["inv-a", "inv-b"],
    ...overrides,
  };
}

beforeEach(() => {
  mockStatuses.mockResolvedValue(["Paid", "Shipped", "Delivered"]);
  mockNames.mockResolvedValue(
    new Map([
      ["inv-a", "Aurora Soaker"],
      ["inv-b", "Blade Towel"],
    ]),
  );
  mockFind.mockResolvedValue(order());
});

describe("getShopOrderStatus — the pieces on the order", () => {
  it("names them once the order has reached its final status", async () => {
    const view = await getShopOrderStatus("SHP-ABC-1234");

    expect(view.items).toEqual([
      { id: "inv-a", name: "Aurora Soaker" },
      { id: "inv-b", name: "Blade Towel" },
    ]);
  });

  it("names none while the order is still on its way", async () => {
    mockFind.mockResolvedValue(order({ status: "Shipped" }));

    const view = await getShopOrderStatus("SHP-ABC-1234");

    expect(view.items).toBeUndefined();
    // And it doesn't pay for the inventory read to find that out.
    expect(mockNames).not.toHaveBeenCalled();
  });

  it("names none on a cancelled order", async () => {
    mockFind.mockResolvedValue(order({ cancelled: true }));

    const view = await getShopOrderStatus("SHP-ABC-1234");

    expect(view.items).toBeUndefined();
  });

  it("names none for a legacy order with no linked pieces", async () => {
    mockFind.mockResolvedValue(order({ itemIds: [] }));

    const view = await getShopOrderStatus("SHP-ABC-1234");

    expect(view.items).toBeUndefined();
  });

  // A piece the shop can't name can't be offered as a choice — but the rest of
  // the order still can.
  it("drops a piece the inventory read couldn't name", async () => {
    mockNames.mockResolvedValue(new Map([["inv-b", "Blade Towel"]]));

    const view = await getShopOrderStatus("SHP-ABC-1234");

    expect(view.items).toEqual([{ id: "inv-b", name: "Blade Towel" }]);
  });

  it("still throws NotFoundError for an unknown order number", async () => {
    mockFind.mockResolvedValue(null);
    await expect(getShopOrderStatus("SHP-NOPE")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
