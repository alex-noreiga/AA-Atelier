import { describe, it, expect } from "vitest";
import {
  missingOptionValues,
  auditNotionConfig,
  SIZED_CATEGORY_NAMES,
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
    itemTypeOptions: ["Dress", "Ready to Wear", "Skate Soakers"],
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

  it("flags the size-chart categories missing from Item Type", () => {
    const findings = auditNotionConfig({
      ...healthy,
      itemTypeOptions: ["Skate Soakers"],
    });
    const sized = findings.find((f) => f.label.includes("Size-chart"));
    expect(sized?.missing).toEqual([...SIZED_CATEGORY_NAMES]);
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

describe("SIZED_CATEGORY_NAMES", () => {
  it("names the canonical sized Item Type values (server-side fallback)", () => {
    // The inventory "Item Type" options were unified to the singular "Dress"
    // (was "Dresses"), so the fallback must name "Dress" exactly — otherwise the
    // nightly config-check would falsely report "Dress"/"Dresses" drift. This
    // list is only used when the Notion "Product Categories" DB is unconfigured.
    expect(SIZED_CATEGORY_NAMES).toEqual(["Dress", "Ready to Wear"]);
  });
});
