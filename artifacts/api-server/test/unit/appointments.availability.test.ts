import { describe, it, expect } from "vitest";
import {
  computeSlots,
  type Booking,
  type ComputeSlotsArgs,
  type TimeOff,
  type WeeklyHours,
} from "../../src/lib/appointments/availability.js";
import type { AppointmentTypeDef } from "../../src/lib/appointments/catalog.js";

// A Monday, so a "Monday" weekly block applies. Times are UTC to keep the
// wall-clock ⇄ instant mapping trivial in these assertions.
const MONDAY = "2026-07-20";
const TZ = "UTC";

const consultation: AppointmentTypeDef = {
  id: "consultation",
  name: "Consultation",
  durationMinutes: 60,
  description: "",
  staff: ["Alexandra", "Alayna"],
  locations: ["in-person", "virtual"],
};

function baseArgs(overrides: Partial<ComputeSlotsArgs> = {}): ComputeSlotsArgs {
  const weeklyHours: WeeklyHours[] = [
    {
      staff: "Alexandra",
      weekday: "Monday",
      startMinutes: 540, // 09:00
      endMinutes: 660, // 11:00
      locations: ["in-person", "virtual"],
    },
  ];
  return {
    type: consultation,
    location: "in-person",
    staffFilter: undefined,
    fromDate: MONDAY,
    days: 1,
    now: new Date("2026-07-01T00:00:00Z"), // well before, lead satisfied
    timeZone: TZ,
    minLeadMinutes: 0,
    slotStepMinutes: 30,
    weeklyHours,
    timeOff: [],
    bookings: [],
    ...overrides,
  };
}

describe("computeSlots", () => {
  it("steps through a working block, fitting the full duration", () => {
    const slots = computeSlots(baseArgs());
    // 09:00, 09:30, 10:00 (10:00 + 60m = 11:00, still within the block).
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-07-20T09:00:00.000Z",
      "2026-07-20T09:30:00.000Z",
      "2026-07-20T10:00:00.000Z",
    ]);
    expect(slots[0].end.toISOString()).toBe("2026-07-20T10:00:00.000Z");
    expect(slots[0].staff).toBe("Alexandra");
  });

  it("excludes slots before the lead-time cutoff", () => {
    const slots = computeSlots(
      baseArgs({
        now: new Date("2026-07-20T09:00:00Z"),
        minLeadMinutes: 60, // earliest bookable is 10:00
      }),
    );
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-07-20T10:00:00.000Z",
    ]);
  });

  it("removes slots that overlap an existing booking", () => {
    const bookings: Booking[] = [
      {
        staff: "Alexandra",
        start: new Date("2026-07-20T09:30:00Z"),
        end: new Date("2026-07-20T10:30:00Z"),
      },
    ];
    const slots = computeSlots(baseArgs({ bookings }));
    // 09:00 (ends 10:00, no overlap with 09:30–10:30? 09:00–10:00 overlaps
    // 09:30) — actually 09:00–10:00 DOES overlap 09:30, so only nothing before.
    // 09:30 and 10:00 overlap the booking; 09:00–10:00 overlaps at 09:30 too.
    expect(slots.map((s) => s.start.toISOString())).toEqual([]);
  });

  it("keeps a non-overlapping booking's neighbours", () => {
    const bookings: Booking[] = [
      {
        staff: "Alexandra",
        start: new Date("2026-07-20T09:00:00Z"),
        end: new Date("2026-07-20T10:00:00Z"),
      },
    ];
    const slots = computeSlots(baseArgs({ bookings }));
    // 09:00 and 09:30 overlap [09:00,10:00); 10:00 starts exactly at 10:00 → free.
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-07-20T10:00:00.000Z",
    ]);
  });

  it("skips an entire day the staff member has off", () => {
    const timeOff: TimeOff[] = [
      { staff: "Alexandra", startDate: MONDAY, endDate: MONDAY },
    ];
    expect(computeSlots(baseArgs({ timeOff }))).toEqual([]);
  });

  it("honours the location on a working block", () => {
    const weeklyHours: WeeklyHours[] = [
      {
        staff: "Alexandra",
        weekday: "Monday",
        startMinutes: 540,
        endMinutes: 660,
        locations: ["virtual"], // in-person requested below → no match
      },
    ];
    expect(
      computeSlots(baseArgs({ weeklyHours, location: "in-person" })),
    ).toEqual([]);
    expect(
      computeSlots(baseArgs({ weeklyHours, location: "virtual" })).length,
    ).toBe(3);
  });

  it("returns nothing when the block is shorter than the duration", () => {
    const weeklyHours: WeeklyHours[] = [
      {
        staff: "Alexandra",
        weekday: "Monday",
        startMinutes: 540,
        endMinutes: 570, // only 30m, needs 60m
        locations: ["in-person"],
      },
    ];
    expect(computeSlots(baseArgs({ weeklyHours }))).toEqual([]);
  });

  it("filters to a specific staff member", () => {
    const weeklyHours: WeeklyHours[] = [
      {
        staff: "Alexandra",
        weekday: "Monday",
        startMinutes: 540,
        endMinutes: 660,
        locations: ["virtual"],
      },
      {
        staff: "Alayna",
        weekday: "Monday",
        startMinutes: 540,
        endMinutes: 660,
        locations: ["virtual"],
      },
    ];
    const slots = computeSlots(
      baseArgs({ weeklyHours, location: "virtual", staffFilter: "Alayna" }),
    );
    expect(slots.every((s) => s.staff === "Alayna")).toBe(true);
    expect(slots.length).toBe(3);
  });

  it("collapses same-time slots for 'no preference', preferring staff order", () => {
    const weeklyHours: WeeklyHours[] = [
      {
        staff: "Alexandra",
        weekday: "Monday",
        startMinutes: 540,
        endMinutes: 660,
        locations: ["virtual"],
      },
      {
        staff: "Alayna",
        weekday: "Monday",
        startMinutes: 540,
        endMinutes: 660,
        locations: ["virtual"],
      },
    ];
    const slots = computeSlots(
      baseArgs({ weeklyHours, location: "virtual", staffFilter: undefined }),
    );
    // Distinct times only, each assigned to Alexandra (first in staff order).
    expect(slots.length).toBe(3);
    expect(slots.every((s) => s.staff === "Alexandra")).toBe(true);
  });

  it("rejects a staff filter that doesn't offer the type", () => {
    expect(computeSlots(baseArgs({ staffFilter: "Nobody" }))).toEqual([]);
  });
});
