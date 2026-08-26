import { describe, it, expect } from "vitest";
import {
  attributeItem,
  itemValue,
  resolveStageMakers,
  summarizeProductionPay,
} from "../../src/services/production-pay.service.js";
import type {
  ProductionStageId,
  WorkDistributionRecord,
} from "../../src/lib/notion/work-distribution.schema.js";
import type { PaySplitRecord } from "../../src/lib/notion/pay-splits.schema.js";

let seq = 0;

/** The atelier's real dress split: 15 / 10 / 20 / 35 / 20, totalling the piece. */
const DRESS: PaySplitRecord = {
  id: "cat-dress",
  category: "Dress",
  shares: {
    consult: 0.15,
    sourcing: 0.1,
    cutting: 0.2,
    sewing: 0.35,
    detailing: 0.2,
  },
};

/** Their soaker split: no consult, no sourcing, no detailing — 30 / 70. */
const SOAKERS: PaySplitRecord = {
  id: "cat-soakers",
  category: "Skate Soakers",
  shares: {
    consult: 0,
    sourcing: 0,
    cutting: 0.3,
    sewing: 0.7,
    detailing: 0,
  },
};

const ROSTER = ["Alayna", "Alexandra"];

function row(
  overrides: Partial<WorkDistributionRecord> = {},
): WorkDistributionRecord {
  seq += 1;
  return {
    id: `work-${seq}`,
    item: `Item ${seq}`,
    product: "",
    salePrice: 500,
    units: 1,
    categoryId: DRESS.id,
    orderStage: "",
    assignees: {
      consult: "Alexandra",
      sourcing: "Alayna",
      cutting: "Alayna",
      sewing: "Alexandra",
      detailing: "Alayna",
    },
    paid: {},
    notes: "",
    ...overrides,
  };
}

function assignees(value: string): Record<ProductionStageId, string> {
  return {
    consult: value,
    sourcing: value,
    cutting: value,
    sewing: value,
    detailing: value,
  };
}

describe("resolveStageMakers", () => {
  it("gives a named maker the whole stage", () => {
    expect(resolveStageMakers("Alexandra", ROSTER)).toEqual(["Alexandra"]);
  });

  it("divides a Split across the whole roster", () => {
    expect(resolveStageMakers("Split", ROSTER)).toEqual(ROSTER);
  });

  it("assigns a blank stage to nobody", () => {
    expect(resolveStageMakers("", ROSTER)).toEqual([]);
    expect(resolveStageMakers("   ", ROSTER)).toEqual([]);
  });

  it("assigns a Split with no roster to nobody, rather than inventing one", () => {
    expect(resolveStageMakers("Split", [])).toEqual([]);
  });
});

describe("itemValue", () => {
  it("is the sale price times the units", () => {
    expect(itemValue(row({ salePrice: 40, units: 3 }))).toBe(120);
  });

  it("is null when the row carries no price — unknown is never zero", () => {
    expect(itemValue(row({ salePrice: null }))).toBeNull();
  });
});

describe("attributeItem", () => {
  it("pays each stage's share of the item value to whoever did it", () => {
    // A $500 dress: Alexandra took consult (15%) + sewing (35%) = $250;
    // Alayna took sourcing (10%) + cutting (20%) + detailing (20%) = $250.
    const item = attributeItem(row(), DRESS, ROSTER);

    expect(item?.value).toBe(500);
    // Equal shares, so they tie — and a tie sorts by name, not by whichever
    // stage happened to be attributed first.
    expect(item?.makers).toEqual([
      expect.objectContaining({ maker: "Alayna", amount: 250 }),
      expect.objectContaining({ maker: "Alexandra", amount: 250 }),
    ]);
    expect(item?.unassigned).toBe(0);
  });

  it("names the stages the money is for", () => {
    const item = attributeItem(row(), DRESS, ROSTER);
    const alexandra = item?.makers.find((m) => m.maker === "Alexandra");

    expect(alexandra?.stages).toEqual([
      { stage: "consult", amount: 75, shared: false },
      { stage: "sewing", amount: 175, shared: false },
    ]);
  });

  it("halves a Split stage between the two makers, and marks it shared", () => {
    const item = attributeItem(
      row({ assignees: { ...assignees(""), sewing: "Split" } }),
      DRESS,
      ROSTER,
    );

    // 35% of $500 is $175, so $87.50 each.
    expect(item?.makers).toEqual([
      expect.objectContaining({ maker: "Alayna", amount: 87.5 }),
      expect.objectContaining({ maker: "Alexandra", amount: 87.5 }),
    ]);
    expect(item?.makers[0]?.stages[0]?.shared).toBe(true);
  });

  it("holds a stage nobody is assigned to as unassigned, never dropping it", () => {
    const item = attributeItem(
      row({ assignees: { ...assignees("Alexandra"), sewing: "" } }),
      DRESS,
      ROSTER,
    );

    expect(item?.unassigned).toBe(175);
    // The rest is still attributed — one blank stage doesn't cost the row.
    expect(item?.makers[0]?.amount).toBe(325);
  });

  it("skips a stage the category gives no share of", () => {
    const item = attributeItem(
      row({ categoryId: SOAKERS.id }),
      SOAKERS,
      ROSTER,
    );

    // Nobody is paid for consulting on a pair of soakers, even though the row
    // names someone against it.
    const stages = item?.makers.flatMap((m) => m.stages.map((s) => s.stage));
    expect(stages).not.toContain("consult");
    expect(stages).not.toContain("sourcing");
  });

  it("multiplies through the units", () => {
    const item = attributeItem(
      row({ salePrice: 40, units: 3, categoryId: SOAKERS.id }),
      SOAKERS,
      ROSTER,
    );
    expect(item?.value).toBe(120);
  });

  it("reads a maker with no Paid column as unpaid", () => {
    const item = attributeItem(row({ paid: {} }), DRESS, ROSTER);
    expect(item?.makers.every((m) => m.paid === false)).toBe(true);
  });

  it("reads a ticked Paid checkbox as settled, per maker", () => {
    const item = attributeItem(
      row({ paid: { Alexandra: true } }),
      DRESS,
      ROSTER,
    );

    expect(item?.makers.find((m) => m.maker === "Alexandra")?.paid).toBe(true);
    expect(item?.makers.find((m) => m.maker === "Alayna")?.paid).toBe(false);
  });

  it("cannot attribute a row with no sale price", () => {
    expect(attributeItem(row({ salePrice: null }), DRESS, ROSTER)).toBeNull();
  });

  it("cannot attribute a row with no pay split", () => {
    expect(attributeItem(row(), undefined, ROSTER)).toBeNull();
  });
});

describe("summarizeProductionPay", () => {
  it("totals what is owed per maker, and across the studio", () => {
    const summary = summarizeProductionPay([row(), row()], [DRESS], ROSTER);

    expect(summary.totalOwed).toBe(1000);
    expect(summary.totalPaid).toBe(0);
    expect(summary.makers).toEqual([
      expect.objectContaining({ maker: "Alayna", owed: 500, owedItems: 2 }),
      expect.objectContaining({ maker: "Alexandra", owed: 500, owedItems: 2 }),
    ]);
  });

  it("moves a ticked row out of owed and into paid", () => {
    const summary = summarizeProductionPay(
      [row({ paid: { Alexandra: true, Alayna: true } })],
      [DRESS],
      ROSTER,
    );

    expect(summary.totalOwed).toBe(0);
    expect(summary.totalPaid).toBe(500);
    expect(summary.makers.every((m) => m.owedItems === 0)).toBe(true);
  });

  it("breaks the owed figure down by stage, ignoring settled work", () => {
    const summary = summarizeProductionPay(
      [row(), row({ paid: { Alexandra: true } })],
      [DRESS],
      ROSTER,
    );
    const alexandra = summary.makers.find((m) => m.maker === "Alexandra");

    expect(alexandra?.owed).toBe(250);
    expect(alexandra?.total).toBe(500);
    // Only the unsettled row's stages — the breakdown explains `owed`.
    expect(alexandra?.owedByStage).toEqual([
      { stage: "sewing", amount: 175 },
      { stage: "consult", amount: 75 },
    ]);
  });

  it("gives a maker with no work a row at nought, so the roster reads as the roster", () => {
    const summary = summarizeProductionPay([], [DRESS], ["Sam", "Alexandra"]);

    expect(summary.makers.map((m) => m.maker).sort()).toEqual([
      "Alexandra",
      "Sam",
    ]);
    expect(summary.makers.every((m) => m.owed === 0)).toBe(true);
  });

  it("still pays a maker the roster read missed", () => {
    // The roster comes from the live select options; a schema read that failed
    // hands an empty one, and nobody's pay may vanish because of it.
    const summary = summarizeProductionPay([row()], [DRESS], []);

    expect(summary.totalOwed).toBe(500);
    expect(summary.makers.map((m) => m.maker)).toEqual(["Alayna", "Alexandra"]);
  });

  it("names a row with no sale price rather than dropping it", () => {
    const summary = summarizeProductionPay(
      [row({ id: "w-1", item: "Unpriced", salePrice: null })],
      [DRESS],
      ROSTER,
    );

    expect(summary.needsAttention).toEqual([
      { id: "w-1", item: "Unpriced", reason: "no-sale-price" },
    ]);
    expect(summary.itemCount).toBe(0);
  });

  it("names a row whose category has no pay split", () => {
    const summary = summarizeProductionPay(
      [row({ id: "w-2", item: "Uncategorised", categoryId: undefined })],
      [DRESS],
      ROSTER,
    );

    expect(summary.needsAttention[0]).toMatchObject({
      id: "w-2",
      reason: "no-pay-split",
    });
  });

  it("names a row holding money nobody is assigned to, and still counts the rest", () => {
    const summary = summarizeProductionPay(
      [
        row({
          id: "w-3",
          assignees: { ...assignees("Alexandra"), sewing: "" },
        }),
      ],
      [DRESS],
      ROSTER,
    );

    expect(summary.needsAttention).toEqual([
      {
        id: "w-3",
        item: expect.any(String),
        reason: "unassigned-stages",
        unassigned: 175,
      },
    ]);
    // The row is still an item and its attributed pay is still owed.
    expect(summary.itemCount).toBe(1);
    expect(summary.totalOwed).toBe(325);
  });

  it("flags a category whose five shares don't total the whole piece", () => {
    const short: PaySplitRecord = {
      id: "cat-short",
      category: "Bag",
      shares: {
        consult: 0,
        sourcing: 0,
        cutting: 0.3,
        sewing: 0.4,
        detailing: 0.2,
      },
    };
    const summary = summarizeProductionPay([], [DRESS, short], ROSTER);

    expect(summary.unbalancedSplits).toEqual([{ category: "Bag", total: 0.9 }]);
  });

  it("does not flag a split whose parts only sum to one in floating point", () => {
    // 0.15 + 0.1 + 0.2 + 0.35 + 0.2 is not exactly 1 in IEEE 754.
    const summary = summarizeProductionPay([], [DRESS], ROSTER);
    expect(summary.unbalancedSplits).toEqual([]);
  });

  it("ranks items by what they still owe", () => {
    const summary = summarizeProductionPay(
      [
        row({ id: "settled", paid: { Alexandra: true, Alayna: true } }),
        row({ id: "owing" }),
      ],
      [DRESS],
      ROSTER,
    );

    expect(summary.items.map((item) => item.id)).toEqual(["owing", "settled"]);
  });
});
