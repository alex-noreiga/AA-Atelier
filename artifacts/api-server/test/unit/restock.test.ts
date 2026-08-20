import { describe, it, expect, afterEach } from "vitest";
import {
  restockSatisfiesRequest,
  shopProductUrl,
} from "../../src/services/restock.js";

/** A variant stub carrying just the fields the gate reads. */
function variant(
  available: boolean,
  sizes: Array<{ name: string; available: boolean }> = [],
) {
  return { available, sizes };
}

describe("restockSatisfiesRequest", () => {
  it("is false when the variant itself is not available", () => {
    expect(restockSatisfiesRequest(variant(false), "")).toBe(false);
    expect(
      restockSatisfiesRequest(
        variant(false, [{ name: "M", available: true }]),
        "M",
      ),
    ).toBe(false);
  });

  it("answers a whole-variant request as soon as the variant is back", () => {
    expect(restockSatisfiesRequest(variant(true), "")).toBe(true);
    expect(
      restockSatisfiesRequest(
        variant(true, [{ name: "M", available: false }]),
        "",
      ),
    ).toBe(true);
  });

  it("answers any request when the row tracks no size bands", () => {
    expect(restockSatisfiesRequest(variant(true), "M")).toBe(true);
  });

  it("answers a per-size request only when that band is back", () => {
    const v = variant(true, [
      { name: "S", available: false },
      { name: "M", available: true },
    ]);
    expect(restockSatisfiesRequest(v, "M")).toBe(true);
    expect(restockSatisfiesRequest(v, "S")).toBe(false);
  });

  it("fails closed for a band the row no longer offers", () => {
    const v = variant(true, [{ name: "M", available: true }]);
    expect(restockSatisfiesRequest(v, "XL")).toBe(false);
  });
});

describe("shopProductUrl", () => {
  const original = process.env.PUBLIC_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = original;
  });

  it("is undefined when PUBLIC_BASE_URL is unset (the email omits its button)", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(shopProductUrl({ id: "inv-1", group: null })).toBeUndefined();
  });

  it("links an ungrouped row by its page id, trimming a trailing slash", () => {
    process.env.PUBLIC_BASE_URL = "https://a3iceanddance.com/";
    expect(shopProductUrl({ id: "inv-1", group: null })).toBe(
      "https://a3iceanddance.com/shop/inv-1",
    );
  });

  it("links a grouped row by the same group- id the shop card uses", () => {
    process.env.PUBLIC_BASE_URL = "https://a3iceanddance.com";
    expect(shopProductUrl({ id: "inv-1", group: "Bow Fleece Soaker" })).toBe(
      "https://a3iceanddance.com/shop/group-bow-fleece-soaker",
    );
  });
});
