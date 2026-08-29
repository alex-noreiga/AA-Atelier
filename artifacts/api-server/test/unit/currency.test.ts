// The studio's reporting currency.
//
// Small, but it is the assumption the money aggregations were already making
// with nothing written down — so what's pinned here is the tolerant direction of
// `isStudioCurrency`: an absent currency counts as the studio's, because every
// row predating the columns was in it and treating unknown as foreign would drop
// real money out of the figures.

import { describe, it, expect } from "vitest";
import { STUDIO_CURRENCY, isStudioCurrency } from "../../src/lib/currency.js";

describe("isStudioCurrency", () => {
  it("accepts the studio's own currency", () => {
    expect(isStudioCurrency(STUDIO_CURRENCY)).toBe(true);
  });

  it("accepts it whatever the case — Stripe answers lowercase, a backfill may not", () => {
    expect(isStudioCurrency("USD")).toBe(true);
    expect(isStudioCurrency("Usd")).toBe(true);
  });

  it("treats an absent currency as the studio's, not as foreign", () => {
    // Every row predating the currency columns was in it; reading unknown as
    // foreign would silently drop that money out of the figures.
    expect(isStudioCurrency(undefined)).toBe(true);
    expect(isStudioCurrency(null)).toBe(true);
    expect(isStudioCurrency("")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isStudioCurrency("eur")).toBe(false);
    expect(isStudioCurrency("cad")).toBe(false);
  });
});
