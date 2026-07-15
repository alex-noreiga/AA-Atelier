import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/notion/availability.repository.js", () => ({
  getAvailabilityConfig: vi.fn(),
}));
vi.mock("../../src/lib/notion/appointments.repository.js", () => ({
  listBookingsInRange: vi.fn(),
  createAppointment: vi.fn(),
}));

import {
  bookAppointment,
  getAppointmentAvailability,
  getAppointmentOptions,
} from "../../src/services/appointments.service.js";
import { BadRequestError } from "../../src/lib/errors.js";
import { getAvailabilityConfig } from "../../src/lib/notion/availability.repository.js";
import {
  listBookingsInRange,
  createAppointment,
} from "../../src/lib/notion/appointments.repository.js";
import type { WeeklyHours } from "../../src/lib/appointments/availability.js";

const mockConfig = vi.mocked(getAvailabilityConfig);
const mockList = vi.mocked(listBookingsInRange);
const mockCreate = vi.mocked(createAppointment);

// A Monday 09:00–11:00 in-person + virtual block for Alexandra, in UTC.
const weeklyHours: WeeklyHours[] = [
  {
    staff: "Alexandra",
    weekday: "Monday",
    startMinutes: 540,
    endMinutes: 660,
    locations: ["in-person", "virtual"],
  },
];

beforeEach(() => {
  process.env.APPOINTMENT_TIMEZONE = "UTC";
  process.env.APPOINTMENT_MIN_LEAD_HOURS = "0";
  process.env.APPOINTMENT_SLOT_STEP_MINUTES = "30";
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.ATELIER_INBOX_EMAIL;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
  mockConfig.mockResolvedValue({ weeklyHours, timeOff: [] });
  mockList.mockResolvedValue([]);
  mockCreate.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getAppointmentOptions", () => {
  it("returns the type catalog and timezone", () => {
    const options = getAppointmentOptions();
    expect(options.timezone).toBe("UTC");
    expect(options.types.map((t) => t.id)).toContain("consultation");
    const fitting = options.types.find((t) => t.id === "fitting")!;
    expect(fitting.locations).toEqual(["in-person"]);
    expect(fitting.staff).toEqual(["Alexandra"]);
  });
});

describe("getAppointmentAvailability", () => {
  it("returns open slots for a valid type + location", async () => {
    const result = await getAppointmentAvailability({
      typeId: "consultation",
      location: "in-person",
      from: "2026-07-20",
      days: 1,
    } as never);
    expect(result.timezone).toBe("UTC");
    expect(result.slots.map((s) => s.start.toISOString())).toEqual([
      "2026-07-20T09:00:00.000Z",
      "2026-07-20T09:30:00.000Z",
      "2026-07-20T10:00:00.000Z",
      "2026-07-20T10:30:00.000Z",
    ]);
  });

  it("rejects an unknown type", async () => {
    await expect(
      getAppointmentAvailability({
        typeId: "nope",
        location: "in-person",
      } as never),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects a location the type isn't offered at", async () => {
    await expect(
      getAppointmentAvailability({
        typeId: "fitting",
        location: "virtual",
      } as never),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("bookAppointment", () => {
  const validBody = {
    typeId: "consultation",
    location: "in-person" as const,
    start: new Date("2026-07-20T09:00:00.000Z"),
    fullName: "Ada Lovelace",
    email: "ada@example.com",
  };

  it("books an open slot and persists it", async () => {
    const result = await bookAppointment(validBody as never);

    expect(result.type).toBe("Consultation");
    expect(result.staff).toBe("Alexandra");
    expect(result.location).toBe("In person");
    expect(result.confirmationCode).toMatch(/^APT-/);
    expect(result.start.toISOString()).toBe("2026-07-20T09:00:00.000Z");
    expect(result.end.toISOString()).toBe("2026-07-20T09:30:00.000Z");

    expect(mockCreate).toHaveBeenCalledOnce();
    const [appointment, title] = mockCreate.mock.calls[0];
    expect(appointment.staff).toBe("Alexandra");
    expect(appointment.start.toISOString()).toBe("2026-07-20T09:00:00.000Z");
    expect(title).toContain("Ada Lovelace");
  });

  it("rejects a start time that isn't an open slot", async () => {
    await expect(
      bookAppointment({
        ...validBody,
        start: new Date("2026-07-20T09:15:00.000Z"), // off the 30-min grid
      } as never),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a slot already taken by a booking", async () => {
    mockList.mockResolvedValue([
      {
        staff: "Alexandra",
        start: new Date("2026-07-20T09:00:00.000Z"),
        end: new Date("2026-07-20T09:30:00.000Z"),
      },
    ]);
    await expect(bookAppointment(validBody as never)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a staff member who doesn't offer the type", async () => {
    // Alayna doesn't do fittings — only Alexandra does.
    await expect(
      bookAppointment({
        ...validBody,
        typeId: "fitting",
        staff: "Alayna",
      } as never),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
