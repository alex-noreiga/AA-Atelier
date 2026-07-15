import { describe, it, expect, afterEach } from "vitest";
import { fromAddress, atelierInbox } from "../../src/lib/resend/config.js";

const VARS = [
  "RESEND_FROM_EMAIL",
  "RESEND_CONTACT_FROM_EMAIL",
  "ATELIER_INBOX_EMAIL",
  "ATELIER_CONTACT_INBOX_EMAIL",
] as const;

afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

describe("fromAddress", () => {
  it("orders uses the base RESEND_FROM_EMAIL", () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    process.env.RESEND_CONTACT_FROM_EMAIL =
      "A.A Atelier <hello@a3iceanddance.com>";
    expect(fromAddress("orders")).toBe(
      "A.A Atelier <orders@a3iceanddance.com>",
    );
  });

  it("contact uses RESEND_CONTACT_FROM_EMAIL when set", () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    process.env.RESEND_CONTACT_FROM_EMAIL =
      "A.A Atelier <hello@a3iceanddance.com>";
    expect(fromAddress("contact")).toBe(
      "A.A Atelier <hello@a3iceanddance.com>",
    );
  });

  it("contact falls back to the base sender when its override is unset", () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    expect(fromAddress("contact")).toBe(
      "A.A Atelier <orders@a3iceanddance.com>",
    );
  });

  it("is empty when nothing is configured", () => {
    expect(fromAddress("orders")).toBe("");
    expect(fromAddress("contact")).toBe("");
  });
});

describe("atelierInbox", () => {
  it("orders uses the base ATELIER_INBOX_EMAIL", () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    process.env.ATELIER_CONTACT_INBOX_EMAIL = "hello@a3iceanddance.com";
    expect(atelierInbox("orders")).toBe("orders@a3iceanddance.com");
  });

  it("contact uses ATELIER_CONTACT_INBOX_EMAIL when set", () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    process.env.ATELIER_CONTACT_INBOX_EMAIL = "hello@a3iceanddance.com";
    expect(atelierInbox("contact")).toBe("hello@a3iceanddance.com");
  });

  it("contact falls back to the base inbox when its override is unset", () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    expect(atelierInbox("contact")).toBe("orders@a3iceanddance.com");
  });

  it("is empty when nothing is configured (callers skip the notification)", () => {
    expect(atelierInbox("orders")).toBe("");
    expect(atelierInbox("contact")).toBe("");
  });
});
