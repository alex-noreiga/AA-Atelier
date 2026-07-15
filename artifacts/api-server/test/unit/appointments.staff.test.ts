import { describe, it, expect } from "vitest";
import {
  parseScheduleRows,
  type ScheduleRow,
} from "../../src/lib/appointments/staff.js";

function row(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    staff: "Alexandra",
    email: "alexandra@atelier.test",
    day: "Mon",
    start: "10:00",
    end: "17:00",
    locations: "in-person, virtual",
    ...overrides,
  };
}

describe("parseScheduleRows", () => {
  it("maps a row to weekly hours + the staff→email map", () => {
    const { weeklyHours, calendars } = parseScheduleRows([
      row({ day: "Mon,Wed" }),
    ]);
    expect(weeklyHours).toEqual([
      {
        staff: "Alexandra",
        weekday: "Monday",
        startMinutes: 600,
        endMinutes: 1020,
        locations: ["in-person", "virtual"],
      },
      {
        staff: "Alexandra",
        weekday: "Wednesday",
        startMinutes: 600,
        endMinutes: 1020,
        locations: ["in-person", "virtual"],
      },
    ]);
    expect(calendars.get("Alexandra")).toBe("alexandra@atelier.test");
  });

  it("expands a day range (Mon-Fri) in week order", () => {
    const { weeklyHours } = parseScheduleRows([row({ day: "Mon-Fri" })]);
    expect(weeklyHours.map((h) => h.weekday)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
  });

  it("accepts full day names and normalizes location labels/case", () => {
    const { weeklyHours } = parseScheduleRows([
      row({ day: "Saturday", locations: "In person, VIRTUAL" }),
    ]);
    expect(weeklyHours[0].weekday).toBe("Saturday");
    expect(weeklyHours[0].locations).toEqual(["in-person", "virtual"]);
  });

  it("records the email but no hours when the time range is invalid", () => {
    const { weeklyHours, calendars } = parseScheduleRows([
      row({ start: "17:00", end: "10:00" }),
    ]);
    expect(weeklyHours).toEqual([]);
    // Email mapping is still preserved so bookings can resolve the calendar.
    expect(calendars.get("Alexandra")).toBe("alexandra@atelier.test");
  });

  it("skips a row with no valid location", () => {
    const { weeklyHours } = parseScheduleRows([
      row({ locations: "carrier pigeon" }),
    ]);
    expect(weeklyHours).toEqual([]);
  });

  it("skips a row with no staff entirely", () => {
    const { weeklyHours, calendars } = parseScheduleRows([
      row({ staff: "  ", email: "ghost@atelier.test" }),
    ]);
    expect(weeklyHours).toEqual([]);
    expect(calendars.size).toBe(0);
  });

  it("keeps the first email seen for a staff name", () => {
    const { calendars } = parseScheduleRows([
      row({ day: "Mon", email: "first@atelier.test" }),
      row({ day: "Tue", email: "second@atelier.test" }),
    ]);
    expect(calendars.get("Alexandra")).toBe("first@atelier.test");
  });

  it("returns empty for no rows", () => {
    expect(parseScheduleRows([])).toEqual({
      weeklyHours: [],
      calendars: new Map(),
    });
  });
});
