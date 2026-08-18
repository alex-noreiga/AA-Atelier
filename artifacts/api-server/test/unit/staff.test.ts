import { describe, it, expect, afterEach } from "vitest";
import {
  staffEmails,
  staffAccessConfigured,
  isStaffEmail,
} from "../../src/lib/staff.js";

afterEach(() => {
  delete process.env.STUDIO_STAFF_EMAILS;
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
