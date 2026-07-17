import { describe, it, expect } from "vitest";
import {
  missingOptionValues,
  auditNotionConfig,
} from "../../src/lib/config-audit.js";

describe("missingOptionValues", () => {
  it("returns [] when every expected value is present in the live list", () => {
    expect(
      missingOptionValues(
        ["Dress", "Ready to Wear"],
        ["Skate Soakers", "Dress", "Ready to Wear", "Other"],
      ),
    ).toEqual([]);
  });

  it("returns the expected values absent from the live list, in order", () => {
    expect(
      missingOptionValues(
        ["Ready to Wear", "Dress"],
        ["Dresses", "Skate Soakers"],
      ),
    ).toEqual(["Ready to Wear", "Dress"]);
  });

  it("is case-sensitive, matching Notion's option identity", () => {
    // A rename that only changes case is still drift the guard should catch.
    expect(missingOptionValues(["Dress"], ["dress"])).toEqual(["Dress"]);
  });

  it("treats an empty live list as everything missing", () => {
    expect(missingOptionValues(["Dress", "Ready to Wear"], [])).toEqual([
      "Dress",
      "Ready to Wear",
    ]);
  });
});

describe("auditNotionConfig", () => {
  const healthy = {
    statusOptions: ["Planned", "In Stock", "Sold"],
    stageOptions: ["Sketching", "Cutting/Pinning", "Sewing/Construction"],
    statusInStock: "In Stock",
    measurementLockStage: "Cutting/Pinning",
  };

  it("returns no findings when every named value is present", () => {
    expect(auditNotionConfig(healthy)).toEqual([]);
  });

  it("flags the sellable status when it's missing from the live Status options", () => {
    const findings = auditNotionConfig({
      ...healthy,
      statusOptions: ["Planned", "Sold"],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].missing).toEqual(["In Stock"]);
    expect(findings[0].label).toMatch(/status/i);
  });

  it("flags the measurement-lock stage when it's renamed away", () => {
    const findings = auditNotionConfig({
      ...healthy,
      stageOptions: ["Sketching", "Sewing/Construction"],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].missing).toEqual(["Cutting/Pinning"]);
  });

  it("collects multiple findings in one pass", () => {
    const findings = auditNotionConfig({
      ...healthy,
      statusOptions: ["Sold"],
      stageOptions: ["Sketching"],
    });
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });
});
