import { describe, it, expect, afterEach } from "vitest";
import {
  signToken,
  verifyToken,
  authConfigured,
  APPOINTMENT_MANAGE_TTL_SECONDS,
} from "../../src/lib/auth/tokens.js";

// The setup file sets SESSION_SECRET; restore it after any test that changes it.
const SECRET = process.env.SESSION_SECRET;
afterEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("auth tokens", () => {
  it("signs and verifies an appointment token, returning the email", () => {
    const token = signToken(
      "skater@example.com",
      "appointment",
      APPOINTMENT_MANAGE_TTL_SECONDS,
      { eventId: "evt-1", staff: "Alayna" },
    );
    expect(verifyToken(token, "appointment")).toEqual({
      email: "skater@example.com",
      eventId: "evt-1",
      staff: "Alayna",
    });
  });

  it("carries appointment claims (eventId + staff) through sign/verify", () => {
    const token = signToken("skater@example.com", "appointment", 3600, {
      eventId: "evt-123",
      staff: "Alayna",
    });
    expect(verifyToken(token, "appointment")).toEqual({
      email: "skater@example.com",
      eventId: "evt-123",
      staff: "Alayna",
    });
  });

  it("rejects an expired token", () => {
    const token = signToken("a@b.com", "appointment", -1);
    expect(verifyToken(token, "appointment")).toBeNull();
  });

  it("rejects a token with a tampered signature", () => {
    const token = signToken("a@b.com", "appointment", 3600);
    const [payload] = token.split(".");
    expect(verifyToken(`${payload}.deadbeef`, "appointment")).toBeNull();
  });

  it("rejects a token whose payload was altered after signing", () => {
    const token = signToken("a@b.com", "appointment", 3600);
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        email: "attacker@evil.com",
        purpose: "appointment",
        exp: Math.floor(Date.now() / 1000) + 999,
      }),
    ).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, "appointment")).toBeNull();
  });

  it("rejects malformed and empty tokens", () => {
    expect(verifyToken("", "appointment")).toBeNull();
    expect(verifyToken("nodot", "appointment")).toBeNull();
    expect(verifyToken(undefined, "appointment")).toBeNull();
  });

  it("does not cross-verify tokens signed under a different secret", () => {
    const token = signToken("a@b.com", "appointment", 3600);
    process.env.SESSION_SECRET = "a-different-secret";
    expect(verifyToken(token, "appointment")).toBeNull();
  });

  it("is inert when SESSION_SECRET is unset", () => {
    delete process.env.SESSION_SECRET;
    expect(authConfigured()).toBe(false);
    expect(() => signToken("a@b.com", "appointment", 3600)).toThrow();
    expect(verifyToken("anything.anything", "appointment")).toBeNull();
  });
});
