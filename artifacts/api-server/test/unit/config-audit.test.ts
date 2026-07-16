import { describe, it, expect } from "vitest";
import {
  missingOptionValues,
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

describe("SIZED_CATEGORY_NAMES", () => {
  it("covers both the current live value and the planned singular", () => {
    // The "Dresses" (live) → "Dress" (planned) drift is exactly what bit before;
    // both must stay listed so the size chart survives on either side of the
    // future rename. Mirrors SIZED_CATEGORIES in web-app/src/pages/shop.tsx.
    expect(SIZED_CATEGORY_NAMES).toContain("Dress");
    expect(SIZED_CATEGORY_NAMES).toContain("Dresses");
    expect(SIZED_CATEGORY_NAMES).toContain("Ready to Wear");
  });
});
