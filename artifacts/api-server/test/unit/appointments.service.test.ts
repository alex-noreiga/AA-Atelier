import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/google/calendar.repository.js", () => ({
  getScheduleConfig: vi.fn(),
  listBusyInRange: vi.fn(),
  createCalendarEvent: vi.fn(),
}));

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderVerification: vi.fn(),
}));

// The text-alert opt-in records consent on the Client CRM. Mocked so the test
// drives the booking service's own decision about when to record it.
vi.mock("../../src/services/sms.service.js", () => ({
  recordSmsConsent: vi.fn(),
}));

import {
  bookAppointment,
  getAppointmentAvailability,
  getAppointmentOptions,
} from "../../src/services/appointments.service.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from "../../src/lib/errors.js";
import {
  getScheduleConfig,
  listBusyInRange,
  createCalendarEvent,
} from "../../src/lib/google/calendar.repository.js";
import { findOrderVerification } from "../../src/lib/notion/orders.repository.js";
import { recordSmsConsent } from "../../src/services/sms.service.js";
import type { WeeklyHours } from "../../src/lib/appointments/availability.js";

const mockSchedule = vi.mocked(getScheduleConfig);
const mockBusy = vi.mocked(listBusyInRange);
const mockCreate = vi.mocked(createCalendarEvent);
const mockVerify = vi.mocked(findOrderVerification);
const mockConsent = vi.mocked(recordSmsConsent);

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

  it("flags the gate on each type", () => {
    const options = getAppointmentOptions();
    const byId = (id: string) => options.types.find((t) => t.id === id)!;
    // Order-scoped types are locked behind an order number.
    expect(byId("fitting").requiresOrder).toBe(true);
    expect(byId("design-review").requiresOrder).toBe(true);
    // New-customer types ask for project details instead.
    expect(byId("consultation").requiresProjectDetails).toBe(true);
    expect(byId("general").requiresProjectDetails).toBe(true);
    // The two gates are mutually exclusive per type.
    expect(byId("fitting").requiresProjectDetails).toBeUndefined();
    expect(byId("consultation").requiresOrder).toBeUndefined();
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
  // Consultations require project details (the new-customer funnel gate).
  const validBody = {
    typeId: "consultation",
    location: "in-person" as const,
    start: new Date("2026-07-20T09:00:00.000Z"),
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    projectDetails: "A competition dress in navy for December.",
  };

  // A fitting is order-scoped: it needs an order number + matching email.
  const validFitting = {
    typeId: "fitting",
    location: "in-person" as const,
    start: new Date("2026-07-20T09:00:00.000Z"),
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    orderNumber: "000123",
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

  it("rejects an unknown appointment type", async () => {
    await expect(
      bookAppointment({ ...validBody, typeId: "mystery" } as never),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized location", async () => {
    await expect(
      bookAppointment({ ...validBody, location: "moon" } as never),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a location the type isn't offered at", async () => {
    // Fittings are in-person only.
    await expect(
      bookAppointment({
        ...validBody,
        typeId: "fitting",
        location: "virtual",
      } as never),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid (unparseable) start time", async () => {
    await expect(
      bookAppointment({ ...validBody, start: new Date("not-a-date") } as never),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("also emails the atelier inbox when one is configured", async () => {
    process.env.ATELIER_INBOX_EMAIL = "studio@atelier.test";

    const result = await bookAppointment(validBody as never);

    // Booking still succeeds; the notification is a best-effort side effect.
    expect(result.confirmationCode).toMatch(/^APT-/);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  // --- Funnel gate: new-customer types require project details -------------
  describe("project-details gate", () => {
    it("rejects a consultation with no project details", async () => {
      await expect(
        bookAppointment({ ...validBody, projectDetails: "  " } as never),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(mockCreate).not.toHaveBeenCalled();
      // Never touches the order lookup — the funnel gate isn't order-scoped.
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it("records the project details on the calendar event", async () => {
      await bookAppointment(validBody as never);
      const [appointment] = mockCreate.mock.calls[0];
      expect(appointment.projectDetails).toBe(
        "A competition dress in navy for December.",
      );
    });
  });

  // --- Order gate: order-scoped types require a verified order -------------
  describe("order gate", () => {
    it("rejects a fitting with no order number", async () => {
      await expect(
        bookAppointment({
          ...validFitting,
          orderNumber: undefined,
        } as never),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it("404s when the order number is unknown", async () => {
      mockVerify.mockResolvedValue(null);
      await expect(
        bookAppointment(validFitting as never),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("403s when the email doesn't match the order", async () => {
      mockVerify.mockResolvedValue({
        email: "someone-else@example.com",
        pageId: "page-order-test",
        orderName: "Ada – Custom Dress",
        currentStage: "Sketching",
        stages: ["Sketching", "Cutting/Pinning", "Delivered"],
      });
      await expect(
        bookAppointment(validFitting as never),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("books when the order number + email match", async () => {
      mockVerify.mockResolvedValue({
        email: "ADA@example.com", // case-insensitive match
        pageId: "page-order-test",
        orderName: "Ada – Custom Dress",
        currentStage: "Sketching",
        stages: ["Sketching", "Cutting/Pinning", "Delivered"],
      });
      const result = await bookAppointment(validFitting as never);
      expect(result.type).toBe("Fitting & Measurements");
      expect(mockCreate).toHaveBeenCalledOnce();
      const [appointment] = mockCreate.mock.calls[0];
      expect(appointment.orderNumber).toBe("000123");
    });

    it("accepts a legacy order with no stored email", async () => {
      mockVerify.mockResolvedValue({
        email: "",
        pageId: "page-order-test",
        orderName: "Ada – Custom Dress",
        currentStage: "Sketching",
        stages: ["Sketching", "Cutting/Pinning", "Delivered"],
      });
      const result = await bookAppointment(validFitting as never);
      expect(result.confirmationCode).toMatch(/^APT-/);
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });
});

// --- The text-alert opt-in ---------------------------------------------------
//
// This is the capture surface for a customer who has never placed an order: a
// consultation has no intake form to tick a box on, so without it they could
// never be texted the reminder the day before the appointment they just made.

describe("bookAppointment: the text-alert opt-in", () => {
  const withConsent = {
    typeId: "consultation",
    location: "in-person" as const,
    start: new Date("2026-07-20T09:00:00.000Z"),
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "512-555-0123",
    projectDetails: "A competition dress in navy for December.",
    smsConsent: true,
  };

  it("records consent on the customer's CRM row as a Lead", async () => {
    await bookAppointment(withConsent as never);

    expect(mockConsent).toHaveBeenCalledWith({
      email: "ada@example.com",
      phone: "512-555-0123",
      fullName: "Ada Lovelace",
      // A booking is not a purchase — someone whose first contact is a
      // consultation hasn't bought anything yet.
      status: "Lead",
    });
  });

  it("records nothing when the box wasn't ticked", async () => {
    await bookAppointment({ ...withConsent, smsConsent: false } as never);
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("records nothing when there is no number to text", async () => {
    // A permission we could never act on, and a ticked box on a row nothing
    // can reach. The frontend asks for the number; this is the server's own
    // fail-closed half.
    await bookAppointment({
      ...withConsent,
      phone: "   ",
    } as never);
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it("still books the appointment when recording consent fails", async () => {
    mockConsent.mockRejectedValueOnce(new Error("notion down"));

    const result = await bookAppointment(withConsent as never);

    expect(result.confirmationCode).toBeTruthy();
    expect(mockCreate).toHaveBeenCalled();
  });
});
