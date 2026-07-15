import { describe, it, expect } from "vitest";
import {
  addCalendarDays,
  dateInZone,
  parseTimeToMinutes,
  weekdayName,
  zonedWallClockToInstant,
} from "../../src/lib/appointments/time.js";

describe("parseTimeToMinutes", () => {
  it("parses HH:MM to minutes since midnight", () => {
    expect(parseTimeToMinutes("09:00")).toBe(540);
    expect(parseTimeToMinutes("17:30")).toBe(1050);
    expect(parseTimeToMinutes("0:05")).toBe(5);
  });

  it("rejects malformed or out-of-range values", () => {
    expect(parseTimeToMinutes("9am")).toBeNull();
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(parseTimeToMinutes("10:75")).toBeNull();
    expect(parseTimeToMinutes("")).toBeNull();
  });
});

describe("addCalendarDays", () => {
  it("adds days across month and year boundaries", () => {
    expect(addCalendarDays("2026-07-20", 1)).toBe("2026-07-21");
    expect(addCalendarDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("weekdayName", () => {
  it("returns the long weekday name of a calendar date", () => {
    expect(weekdayName("2026-07-20")).toBe("Monday");
    expect(weekdayName("2026-01-15")).toBe("Thursday");
  });
});

describe("zonedWallClockToInstant", () => {
  it("treats wall-clock as UTC when the zone is UTC", () => {
    const instant = zonedWallClockToInstant("2026-07-20", 600, "UTC");
    expect(instant.toISOString()).toBe("2026-07-20T10:00:00.000Z");
  });

  it("applies the correct DST offset for a US Eastern summer date", () => {
    // 10:00 EDT (UTC-4) on 2026-07-20 is 14:00Z.
    const instant = zonedWallClockToInstant(
      "2026-07-20",
      600,
      "America/New_York",
    );
    expect(instant.toISOString()).toBe("2026-07-20T14:00:00.000Z");
  });

  it("applies standard time in winter", () => {
    // 10:00 EST (UTC-5) on 2026-01-15 is 15:00Z.
    const instant = zonedWallClockToInstant(
      "2026-01-15",
      600,
      "America/New_York",
    );
    expect(instant.toISOString()).toBe("2026-01-15T15:00:00.000Z");
  });
});

describe("dateInZone", () => {
  it("returns the local calendar date an instant falls on", () => {
    // 01:00Z on 2026-07-21 is still 2026-07-20 in New York (21:00 EDT).
    const instant = new Date("2026-07-21T01:00:00.000Z");
    expect(dateInZone(instant, "America/New_York")).toBe("2026-07-20");
    expect(dateInZone(instant, "UTC")).toBe("2026-07-21");
  });
});
