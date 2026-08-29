import { describe, it, expect } from "vitest";

import {
  PARCEL_PRESETS,
  findParcelPreset,
  weightProblem,
  MAX_PARCEL_WEIGHT_OZ,
} from "../../src/lib/shipping/parcels.js";

describe("the parcel catalog", () => {
  it("carries no weight, because what goes in a box varies and the box doesn't", () => {
    for (const preset of PARCEL_PRESETS) {
      expect(preset).not.toHaveProperty("weight");
      expect(preset).not.toHaveProperty("weightOz");
    }
  });

  it("has unique ids, since the id is what a rate request sends back", () => {
    const ids = PARCEL_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists smallest first, which is also cheapest first", () => {
    const volumes = PARCEL_PRESETS.map(
      (preset) => preset.length * preset.width * preset.height,
    );
    expect([...volumes].sort((a, b) => a - b)).toEqual(volumes);
  });

  it("gives every size real dimensions and a hint to pick it by", () => {
    for (const preset of PARCEL_PRESETS) {
      expect(preset.length).toBeGreaterThan(0);
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.height).toBeGreaterThan(0);
      expect(preset.hint.trim()).not.toBe("");
    }
  });

  it("resolves an id, ignoring the whitespace a paste brings", () => {
    expect(findParcelPreset(" box-small ")?.name).toBe("Small box");
  });

  it("resolves nothing for a size this build doesn't have", () => {
    expect(findParcelPreset("crate")).toBeUndefined();
  });
});

describe("weightProblem", () => {
  it("accepts a real weight", () => {
    expect(weightProblem(12)).toBeNull();
    expect(weightProblem(0.5)).toBeNull();
    expect(weightProblem(MAX_PARCEL_WEIGHT_OZ)).toBeNull();
  });

  it("refuses zero rather than treating it as unset", () => {
    // A carrier rating a 0 oz package prices a document envelope, so the
    // atelier is told to weigh it instead of being sold the wrong postage.
    expect(weightProblem(0)).toContain("has to weigh something");
    expect(weightProblem(-3)).toContain("has to weigh something");
  });

  it("refuses a weight that is almost certainly pounds typed as ounces", () => {
    const problem = weightProblem(MAX_PARCEL_WEIGHT_OZ + 1);
    expect(problem).toContain("ounces, not pounds");
  });

  it("refuses a non-number, which is what a blank field parses to", () => {
    expect(weightProblem(Number.NaN)).toContain("weight in ounces");
  });
});
