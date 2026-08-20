import { describe, it, expect } from "vitest";
import {
  buildSchedule,
  normalizeWeekday,
  normalizeLocation,
  type ScheduleEntry,
} from "../../src/lib/appointments/staff.js";

function entry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    staff: "Alexandra",
    email: "alexandra@atelier.test",
    weekdays: ["Monday"],
    start: "10:00",
    end: "17:00",
    locations: ["In person", "Virtual"],
    ...overrides,
  };
}

describe("buildSchedule", () => {
  it("maps an entry to weekly hours + the staff→email map", () => {
    const { weeklyHours, calendars } = buildSchedule([
      entry({ weekdays: ["Monday", "Wednesday"] }),
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

  it("emits weekdays in week order however they were entered", () => {
    const { weeklyHours } = buildSchedule([
      entry({ weekdays: ["Fri", "Monday", "Wed"] }),
    ]);
    expect(weeklyHours.map((h) => h.weekday)).toEqual([
      "Monday",
      "Wednesday",
      "Friday",
    ]);
  });

  it("tolerates hand-edited abbreviations and casing", () => {
    const { weeklyHours } = buildSchedule([
      entry({ weekdays: ["sat"], locations: ["in-person", "VIRTUAL"] }),
    ]);
    expect(weeklyHours[0].weekday).toBe("Saturday");
    expect(weeklyHours[0].locations).toEqual(["in-person", "virtual"]);
  });

  it("de-dupes a weekday listed twice", () => {
    const { weeklyHours } = buildSchedule([
      entry({ weekdays: ["Monday", "Mon"] }),
    ]);
    expect(weeklyHours).toHaveLength(1);
  });

  it("records the email but no hours when the time range is invalid", () => {
    const { weeklyHours, calendars } = buildSchedule([
      entry({ start: "17:00", end: "10:00" }),
    ]);
    expect(weeklyHours).toEqual([]);
    // Email mapping is still preserved so bookings can resolve the calendar.
    expect(calendars.get("Alexandra")).toBe("alexandra@atelier.test");
  });

  it("skips an entry with no recognizable location", () => {
    const { weeklyHours } = buildSchedule([
      entry({ locations: ["carrier pigeon"] }),
    ]);
    expect(weeklyHours).toEqual([]);
  });

  it("skips an entry with no staff entirely", () => {
    const { weeklyHours, calendars } = buildSchedule([
      entry({ staff: "  ", email: "ghost@atelier.test" }),
    ]);
    expect(weeklyHours).toEqual([]);
    expect(calendars.size).toBe(0);
  });

  it("keeps the first email seen for a staff name", () => {
    const { calendars } = buildSchedule([
      entry({ weekdays: ["Monday"], email: "first@atelier.test" }),
      entry({ weekdays: ["Tuesday"], email: "second@atelier.test" }),
    ]);
    expect(calendars.get("Alexandra")).toBe("first@atelier.test");
  });

  it("returns empty for no entries", () => {
    expect(buildSchedule([])).toEqual({
      weeklyHours: [],
      calendars: new Map(),
    });
  });
});

describe("normalizeWeekday / normalizeLocation", () => {
  it("accepts the forms a Notion row can hold", () => {
    expect(normalizeWeekday("Tue")).toBe("Tuesday");
    expect(normalizeWeekday("tuesday")).toBe("Tuesday");
    expect(normalizeWeekday("Someday")).toBeNull();
    expect(normalizeLocation("In person")).toBe("in-person");
    expect(normalizeLocation("virtual")).toBe("virtual");
    expect(normalizeLocation("studio")).toBeNull();
  });
});
