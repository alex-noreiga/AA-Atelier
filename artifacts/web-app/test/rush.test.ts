import { describe, it, expect } from "vitest";
import { isRushNeededBy, RUSH_WINDOW_DAYS } from "@/lib/rush";

// A fixed "today" so the window math is deterministic regardless of the run
// clock. The default window is 21 days, so the cutoff is 2026-08-19 (exclusive).
const today = new Date("2026-07-29T12:00:00");

describe("isRushNeededBy", () => {
  it("is false for a missing or blank date", () => {
    expect(isRushNeededBy(undefined, today)).toBe(false);
    expect(isRushNeededBy("", today)).toBe(false);
  });

  it("is false for an unparseable date", () => {
    expect(isRushNeededBy("not-a-date", today)).toBe(false);
  });

  it("is true for a date inside the rush window", () => {
    expect(isRushNeededBy("2026-08-05", today)).toBe(true); // 7 days out
  });

  it("is true for today itself", () => {
    expect(isRushNeededBy("2026-07-29", today)).toBe(true);
  });

  it("is false at the window boundary and beyond", () => {
    const cutoff = new Date(today);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() + RUSH_WINDOW_DAYS);
    const iso = cutoff.toISOString().split("T")[0];
    expect(isRushNeededBy(iso, today)).toBe(false);
    expect(isRushNeededBy("2026-12-01", today)).toBe(false);
  });

  it("is false for a past date", () => {
    expect(isRushNeededBy("2026-07-01", today)).toBe(false);
  });
});
