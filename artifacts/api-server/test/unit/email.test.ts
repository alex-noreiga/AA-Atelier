import { describe, it, expect } from "vitest";
import { normalizeEmail } from "../../src/lib/email.js";

describe("normalizeEmail", () => {
  it("lowercases and trims so mixed-case addresses collapse to one", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("leaves an already-canonical address unchanged", () => {
    expect(normalizeEmail("ada@example.com")).toBe("ada@example.com");
  });

  it("is idempotent", () => {
    expect(normalizeEmail(normalizeEmail("A@B.Com"))).toBe(
      normalizeEmail("A@B.Com"),
    );
  });
});
