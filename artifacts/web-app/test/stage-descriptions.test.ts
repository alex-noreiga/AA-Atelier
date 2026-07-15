import { describe, it, expect } from "vitest";
import { getStageDescription } from "@/lib/stage-descriptions";

describe("getStageDescription", () => {
  it("returns the specific copy for a known stage", () => {
    expect(getStageDescription("Sewing/Construction")).toMatch(
      /sewing and constructing/i,
    );
    expect(getStageDescription("Delivery")).toMatch(/delivered/i);
  });

  it("falls back to a generic line for an unknown stage", () => {
    expect(getStageDescription("Some New Stage")).toBe(
      "Carefully working on this stage of your garment.",
    );
  });

  it("uses the fallback for an empty stage name", () => {
    expect(getStageDescription("")).toBe(
      "Carefully working on this stage of your garment.",
    );
  });
});
