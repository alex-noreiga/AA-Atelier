import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/google/calendar.repository.js", () => ({
  getScheduleConfig: vi.fn(),
  listBusyInRange: vi.fn(),
  createCalendarEvent: vi.fn(),
}));

import {
  bookAppointment,
  getAppointmentAvailability,
  getAppointmentOptions,
} from "../../src/services/appointments.service.js";
import { BadRequestError } from "../../src/lib/errors.js";
import {
  getScheduleConfig,
  listBusyInRange,
  createCalendarEvent,
} from "../../src/lib/google/calendar.repository.js";
import type { WeeklyHours } from "../../src/lib/appointments/availability.js";

const mockSchedule = vi.mocked(getScheduleConfig);
const mockBusy = vi.mocked(listBusyInRange);
const mockCreate = vi.mocked(createCalendarEvent);

// A Monday 09:00–11:00 in-person + virtual block for Alexandra and Alayna, in UTC.
const weeklyHours: WeeklyHours[] = [
  {
    staff: "Alexandra",
    weekday: "Monday",
    startMinutes: 540,
    endMinutes: 660,
    locations: ["in-person", "virtual"],
  },
  {
    staff: "Alayna",
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
  mockSchedule.mockResolvedValue({ weeklyHours, timeOff: [] });
  mockBusy.mockResolvedValue([]);
  mockCreate.mockResolvedValue({ calendarLink: "https://cal.test/event" });
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
    expect(fitting.staff).toEqual(["Alexandra", "Alayna"]);
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
    // Only the eligible staff's calendars are queried for busy time —
    // consultations are Alayna only.
    expect(mockBusy).toHaveBeenCalledWith(expect.any(Date), expect.any(Date), [
      "Alayna",
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

  it("books an open slot and writes a calendar event", async () => {
    const result = await bookAppointment(validBody as never);

    expect(result.type).toBe("Consultation");
    expect(result.staff).toBe("Alayna");
    expect(result.location).toBe("In person");
    expect(result.confirmationCode).toMatch(/^APT-/);
    expect(result.start.toISOString()).toBe("2026-07-20T09:00:00.000Z");
    expect(result.calendarLink).toBe("https://cal.test/event");

    expect(mockCreate).toHaveBeenCalledOnce();
    const [appointment, title] = mockCreate.mock.calls[0];
    expect(appointment.staff).toBe("Alayna");
    expect(appointment.location).toBe("in-person");
    expect(appointment.timeZone).toBe("UTC");
    expect(appointment.start.toISOString()).toBe("2026-07-20T09:00:00.000Z");
    expect(title).toContain("Ada Lovelace");
  });

  it("surfaces the Google Meet link for a virtual booking", async () => {
    mockCreate.mockResolvedValue({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      calendarLink: "https://cal.test/event",
    });
    const result = await bookAppointment({
      ...validBody,
      location: "virtual",
    } as never);
    expect(result.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
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

  it("rejects a slot already busy on the calendar", async () => {
    mockBusy.mockResolvedValue([
      {
        staff: "Alayna",
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
    // Alexandra doesn't do consultations — only Alayna does.
    await expect(
      bookAppointment({
        ...validBody,
        typeId: "consultation",
        staff: "Alexandra",
      } as never),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
