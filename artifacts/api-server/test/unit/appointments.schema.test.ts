import { describe, it, expect } from "vitest";
import {
  extractIsActive,
  extractKind,
  extractTimeOff,
  extractWeeklyHours,
} from "../../src/lib/notion/availability.schema.js";

// Raw Notion-wire-shaped page builders, kept local to this test (the same
// convention as fake-notion.ts): they're a different layer from the domain DTOs.
type Prop = Record<string, unknown>;
function page(properties: Record<string, Prop>) {
  return { properties } as never;
}
const select = (name: string) => ({ select: { name } });
const richText = (text: string) => ({ rich_text: [{ plain_text: text }] });
const multi = (...names: string[]) => ({
  multi_select: names.map((name) => ({ name })),
});

describe("extractWeeklyHours", () => {
  it("maps a complete weekly-hours row to the domain shape", () => {
    const hours = extractWeeklyHours(
      page({
        Staff: select("Alexandra"),
        Day: select("Monday"),
        "Start time": richText("09:00"),
        "End time": richText("17:00"),
        Locations: multi("In person", "Virtual"),
      }),
    );
    expect(hours).toEqual({
      staff: "Alexandra",
      weekday: "Monday",
      startMinutes: 540,
      endMinutes: 1020,
      locations: ["in-person", "virtual"],
    });
  });

  it("normalizes location labels (case/spacing/hyphen)", () => {
    const hours = extractWeeklyHours(
      page({
        Staff: select("Alayna"),
        Day: select("Tuesday"),
        "Start time": richText("10:00"),
        "End time": richText("12:00"),
        Locations: multi("in-person", "VIRTUAL"),
      }),
    );
    expect(hours?.locations).toEqual(["in-person", "virtual"]);
  });

  it("returns null when required fields are missing or inverted", () => {
    const missingDay = extractWeeklyHours(
      page({
        Staff: select("Alexandra"),
        "Start time": richText("09:00"),
        "End time": richText("17:00"),
        Locations: multi("In person"),
      }),
    );
    expect(missingDay).toBeNull();

    const inverted = extractWeeklyHours(
      page({
        Staff: select("Alexandra"),
        Day: select("Monday"),
        "Start time": richText("17:00"),
        "End time": richText("09:00"),
        Locations: multi("In person"),
      }),
    );
    expect(inverted).toBeNull();

    const noLocations = extractWeeklyHours(
      page({
        Staff: select("Alexandra"),
        Day: select("Monday"),
        "Start time": richText("09:00"),
        "End time": richText("17:00"),
        Locations: multi(),
      }),
    );
    expect(noLocations).toBeNull();
  });
});

describe("extractTimeOff", () => {
  it("reads a single-day time-off row (no end)", () => {
    const off = extractTimeOff(
      page({
        Staff: select("Alexandra"),
        Date: { date: { start: "2026-07-20", end: null } },
      }),
    );
    expect(off).toEqual({
      staff: "Alexandra",
      startDate: "2026-07-20",
      endDate: "2026-07-20",
    });
  });

  it("reads a date range and trims any time component", () => {
    const off = extractTimeOff(
      page({
        Staff: select("Alayna"),
        Date: {
          date: { start: "2026-08-01T00:00:00.000-04:00", end: "2026-08-05" },
        },
      }),
    );
    expect(off).toEqual({
      staff: "Alayna",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
    });
  });

  it("returns null without a staff or date", () => {
    expect(
      extractTimeOff(
        page({ Date: { date: { start: "2026-07-20", end: null } } }),
      ),
    ).toBeNull();
    expect(extractTimeOff(page({ Staff: select("Alexandra") }))).toBeNull();
  });
});

describe("extractKind / extractIsActive", () => {
  it("reads the discriminator and active flag", () => {
    const p = page({
      Kind: select("Weekly hours"),
      Active: { checkbox: true },
    });
    expect(extractKind(p)).toBe("Weekly hours");
    expect(extractIsActive(p)).toBe(true);
    expect(extractIsActive(page({}))).toBe(false);
  });
});
