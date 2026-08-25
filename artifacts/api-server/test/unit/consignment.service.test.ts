import { describe, it, expect } from "vitest";
import {
  summarizeConsignment,
  unitsAtShop,
  CONSIGNMENT_ITEMS_LIMIT,
} from "../../src/services/consignment.service.js";
import type { ConsignmentRecord } from "../../src/lib/notion/consignment.schema.js";

let seq = 0;

function placement(
  overrides: Partial<ConsignmentRecord> = {},
): ConsignmentRecord {
  seq += 1;
  return {
    id: `placement-${seq}`,
    placement: `Placement ${seq}`,
    itemId: "inv-1",
    delivered: 0,
    returned: null,
    sold: null,
    settled: false,
    settledOn: "",
    deliveredOn: "2026-07-01",
    retailPrice: null,
    payout: null,
    ...overrides,
  };
}

const WINDOW = { from: "2026-01-01", to: "2026-12-31" };

describe("unitsAtShop", () => {
  it("is what was delivered, less what came back and what sold", () => {
    expect(
      unitsAtShop(placement({ delivered: 10, returned: 2, sold: 3 })),
    ).toBe(5);
  });

  it("treats a blank returned/sold as nothing counted yet", () => {
    expect(unitsAtShop(placement({ delivered: 6 }))).toBe(6);
  });

  it("is zero once the placement is settled, whatever the numbers say", () => {
    // The shelf was counted and the placement closed, so anything unaccounted
    // for was resolved at the visit — it isn't still sitting there.
    expect(
      unitsAtShop(
        placement({ delivered: 10, returned: 1, sold: 2, settled: true }),
      ),
    ).toBe(0);
  });

  it("never goes negative on a miscounted row", () => {
    expect(unitsAtShop(placement({ delivered: 2, sold: 5 }))).toBe(0);
  });
});

describe("summarizeConsignment — the shelf", () => {
  it("counts open placements, their units and their shelf value", () => {
    const summary = summarizeConsignment(
      [
        placement({ delivered: 4, retailPrice: 30 }),
        placement({ delivered: 3, sold: 1, retailPrice: 20, itemId: "inv-2" }),
      ],
      WINDOW,
    );

    expect(summary.openPlacements).toBe(2);
    expect(summary.atShopUnits).toBe(6);
    // Retail, not the studio's share: nothing has sold, so there is no payout
    // to quote — this is stock standing somewhere else.
    expect(summary.atShopRetail).toBe(4 * 30 + 2 * 20);
  });

  it("leaves a settled placement off the shelf entirely", () => {
    const summary = summarizeConsignment(
      [
        placement({
          delivered: 5,
          sold: 5,
          settled: true,
          settledOn: "2026-06-01",
        }),
      ],
      WINDOW,
    );

    expect(summary.openPlacements).toBe(0);
    expect(summary.atShopUnits).toBe(0);
  });
});

describe("summarizeConsignment — the takings", () => {
  it("reads the payout off the atelier's own formula", () => {
    // Half of retail today — but the split is their deal with the shop, so the
    // figure is read rather than re-derived from a rate held in the app.
    const summary = summarizeConsignment(
      [
        placement({
          delivered: 4,
          sold: 3,
          settled: true,
          settledOn: "2026-06-14",
          retailPrice: 30,
          payout: 45,
        }),
      ],
      WINDOW,
    );

    expect(summary.settledUnits).toBe(3);
    expect(summary.settledPayout).toBe(45);
    expect(summary.payoutUnknownPlacements).toBe(0);
  });

  it("names a settled placement whose payout formula produced nothing", () => {
    const summary = summarizeConsignment(
      [
        placement({
          sold: 2,
          settled: true,
          settledOn: "2026-06-14",
          payout: null,
        }),
      ],
      WINDOW,
    );

    // The units are still reported; the money simply isn't claimed, and the
    // gap is named rather than left as a total that quietly under-reads.
    expect(summary.settledUnits).toBe(2);
    expect(summary.settledPayout).toBe(0);
    expect(summary.payoutUnknownPlacements).toBe(1);
  });

  it("doesn't flag a settled placement that sold nothing", () => {
    const summary = summarizeConsignment(
      [placement({ sold: 0, settled: true, settledOn: "2026-06-14" })],
      WINDOW,
    );
    expect(summary.payoutUnknownPlacements).toBe(0);
  });

  it("leaves a settlement outside the window out of the takings", () => {
    const summary = summarizeConsignment(
      [
        placement({
          sold: 3,
          settled: true,
          settledOn: "2025-06-14",
          payout: 60,
        }),
      ],
      WINDOW,
    );

    expect(summary.settledUnits).toBe(0);
    expect(summary.settledPayout).toBe(0);
  });

  it("leaves a settled placement with no date out of every month", () => {
    // Guessing a month would move real money into a period it didn't happen in.
    const summary = summarizeConsignment(
      [placement({ sold: 3, settled: true, settledOn: "", payout: 60 })],
      WINDOW,
    );

    expect(summary.settledPayout).toBe(0);
  });

  it("matches a settlement recorded as a full instant", () => {
    const summary = summarizeConsignment(
      [
        placement({
          sold: 1,
          settled: true,
          settledOn: "2026-06-14T15:30:00.000Z",
          payout: 15,
        }),
      ],
      WINDOW,
    );

    expect(summary.settledPayout).toBe(15);
  });
});

describe("summarizeConsignment — the piece list", () => {
  it("folds a piece's placements together, most on the shelf first", () => {
    const summary = summarizeConsignment(
      [
        placement({ itemId: "inv-1", delivered: 2 }),
        placement({ itemId: "inv-1", delivered: 3 }),
        placement({ itemId: "inv-2", delivered: 9 }),
        placement({
          itemId: "inv-1",
          sold: 4,
          settled: true,
          settledOn: "2026-05-02",
        }),
      ],
      WINDOW,
    );

    expect(summary.items).toEqual([
      { itemId: "inv-2", atShop: 9, sold: 0 },
      { itemId: "inv-1", atShop: 5, sold: 4 },
    ]);
  });

  it("leaves out a piece with nothing out and nothing sold", () => {
    const summary = summarizeConsignment(
      [placement({ itemId: "inv-1", delivered: 0 })],
      WINDOW,
    );
    expect(summary.items).toEqual([]);
  });

  it("caps the list", () => {
    const summary = summarizeConsignment(
      Array.from({ length: CONSIGNMENT_ITEMS_LIMIT + 3 }, (_, i) =>
        placement({ itemId: `inv-${i}`, delivered: i + 1 }),
      ),
      WINDOW,
    );
    expect(summary.items).toHaveLength(CONSIGNMENT_ITEMS_LIMIT);
  });

  it("still counts a placement whose item relation is empty", () => {
    const summary = summarizeConsignment(
      [placement({ itemId: undefined, delivered: 3, retailPrice: 10 })],
      WINDOW,
    );

    // Countable but nameless: the totals hold it, and the caller drops the
    // unnamed row from the list rather than showing a bare page id.
    expect(summary.atShopUnits).toBe(3);
    expect(summary.items).toEqual([{ atShop: 3, sold: 0 }]);
  });
});
