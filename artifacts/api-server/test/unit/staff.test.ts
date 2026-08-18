import { describe, it, expect, afterEach } from "vitest";
import {
  staffEmails,
  staffAccessConfigured,
  isStaffEmail,
  staffRequiresGoogle,
  extractAuthMethods,
  signedInWithGoogle,
} from "../../src/lib/staff.js";

afterEach(() => {
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
});

describe("studio staff allowlist", () => {
  it("admits nobody when unconfigured (fails closed)", () => {
    expect(staffAccessConfigured()).toBe(false);
    expect(staffEmails()).toEqual([]);
    expect(isStaffEmail("alexandra@a3iceanddance.com")).toBe(false);
  });

  it("admits nobody for a blank or comma-only value", () => {
    process.env.STUDIO_STAFF_EMAILS = " , ,";
    expect(staffAccessConfigured()).toBe(false);
    expect(isStaffEmail("alexandra@a3iceanddance.com")).toBe(false);
  });

  it("parses a comma-separated list, dropping blanks", () => {
    process.env.STUDIO_STAFF_EMAILS = "one@studio.com, two@studio.com,,";
    expect(staffEmails()).toEqual(["one@studio.com", "two@studio.com"]);
    expect(staffAccessConfigured()).toBe(true);
  });

  it("matches on the canonical email, whichever side is oddly cased", () => {
    process.env.STUDIO_STAFF_EMAILS = " Alexandra@A3IceAndDance.com ";
    expect(isStaffEmail("alexandra@a3iceanddance.com")).toBe(true);
    expect(isStaffEmail("ALEXANDRA@a3iceanddance.com")).toBe(true);
  });

  it("rejects an address that isn't listed, and a blank one", () => {
    process.env.STUDIO_STAFF_EMAILS = "one@studio.com";
    expect(isStaffEmail("skater@example.com")).toBe(false);
    expect(isStaffEmail("")).toBe(false);
  });

  it("is read fresh, so an env change takes effect without a restart", () => {
    process.env.STUDIO_STAFF_EMAILS = "one@studio.com";
    expect(isStaffEmail("two@studio.com")).toBe(false);
    process.env.STUDIO_STAFF_EMAILS = "one@studio.com,two@studio.com";
    expect(isStaffEmail("two@studio.com")).toBe(true);
  });
});

describe("staffRequiresGoogle", () => {
  it("is on by default — an access-control default you must remember isn't one", () => {
    expect(staffRequiresGoogle()).toBe(true);
  });

  it("stays on for an empty or unrecognized value", () => {
    process.env.STUDIO_REQUIRE_GOOGLE = "";
    expect(staffRequiresGoogle()).toBe(true);
    process.env.STUDIO_REQUIRE_GOOGLE = "maybe";
    expect(staffRequiresGoogle()).toBe(true);
    process.env.STUDIO_REQUIRE_GOOGLE = "true";
    expect(staffRequiresGoogle()).toBe(true);
  });

  it("can be switched off explicitly (the recovery hatch)", () => {
    for (const value of ["false", "FALSE", "0", "no", " off "]) {
      process.env.STUDIO_REQUIRE_GOOGLE = value;
      expect(staffRequiresGoogle()).toBe(false);
    }
  });
});

describe("extractAuthMethods", () => {
  it("reads the RFC-8176 string form", () => {
    expect(extractAuthMethods({ amr: ["password", "otp"] })).toEqual([
      "password",
      "otp",
    ]);
  });

  it("reads the timestamped-entry form", () => {
    expect(
      extractAuthMethods({
        amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
      }),
    ).toEqual(["oauth"]);
  });

  it("reads a mixed array, skipping entries it can't understand", () => {
    expect(
      extractAuthMethods({
        amr: ["password", { method: "totp" }, {}, 7, null],
      }),
    ).toEqual(["password", "totp"]);
  });

  it("returns nothing for claims with no usable amr", () => {
    expect(extractAuthMethods({})).toEqual([]);
    expect(extractAuthMethods({ amr: "oauth" })).toEqual([]);
    expect(extractAuthMethods(null)).toEqual([]);
    expect(extractAuthMethods(undefined)).toEqual([]);
    expect(extractAuthMethods("nonsense")).toEqual([]);
  });
});

describe("signedInWithGoogle", () => {
  it("accepts a session established through OAuth", () => {
    expect(signedInWithGoogle(["oauth"])).toBe(true);
    expect(signedInWithGoogle(["password", "oauth"])).toBe(true);
  });

  it("rejects password and magic-link sessions", () => {
    expect(signedInWithGoogle(["password"])).toBe(false);
    expect(signedInWithGoogle(["magiclink"])).toBe(false);
  });

  it("fails closed when the method is unknown", () => {
    expect(signedInWithGoogle([])).toBe(false);
  });
});
