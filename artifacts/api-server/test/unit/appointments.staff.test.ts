import { describe, it, expect, beforeEach } from "vitest";
import {
  calendarEmailFor,
  staffCalendars,
  weeklyHoursFromConfig,
} from "../../src/lib/appointments/staff.js";

const CONFIG = [
  {
    name: "Alexandra",
    email: "alexandra@atelier.test",
    hours: [
      {
        days: ["Mon", "Wed"],
        start: "10:00",
        end: "17:00",
        locations: ["in-person", "virtual"],
      },
      // A malformed block (inverted range) — should be skipped, not throw.
      {
        days: ["Fri"],
        start: "17:00",
        end: "10:00",
        locations: ["in-person"],
      },
    ],
  },
  {
    name: "Alayna",
    email: "alayna@atelier.test",
    hours: [
      {
        days: ["Saturday"],
        start: "11:00",
        end: "16:00",
        locations: ["virtual"],
      },
    ],
  },
];

beforeEach(() => {
  process.env.APPOINTMENT_STAFF = JSON.stringify(CONFIG);
});

describe("staffCalendars / calendarEmailFor", () => {
  it("lists staff and resolves a calendar email by name", () => {
    expect(staffCalendars()).toEqual([
      { name: "Alexandra", email: "alexandra@atelier.test" },
      { name: "Alayna", email: "alayna@atelier.test" },
    ]);
    expect(calendarEmailFor("Alayna")).toBe("alayna@atelier.test");
    expect(calendarEmailFor("Nobody")).toBeUndefined();
  });
});

describe("weeklyHoursFromConfig", () => {
  it("expands each block into one WeeklyHours per weekday (abbrev + full names)", () => {
    const hours = weeklyHoursFromConfig();
    expect(hours).toEqual([
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
      {
        staff: "Alayna",
        weekday: "Saturday",
        startMinutes: 660,
        endMinutes: 960,
        locations: ["virtual"],
      },
    ]);
  });
});

describe("config errors", () => {
  it("throws when APPOINTMENT_STAFF is unset", () => {
    delete process.env.APPOINTMENT_STAFF;
    expect(() => weeklyHoursFromConfig()).toThrow(/APPOINTMENT_STAFF/);
  });

  it("throws on invalid JSON", () => {
    process.env.APPOINTMENT_STAFF = "{not json";
    expect(() => staffCalendars()).toThrow(/valid JSON/);
  });

  it("throws when the shape is wrong (missing email)", () => {
    process.env.APPOINTMENT_STAFF = JSON.stringify([
      { name: "Alexandra", hours: [] },
    ]);
    expect(() => staffCalendars()).toThrow(/invalid/);
  });
});
