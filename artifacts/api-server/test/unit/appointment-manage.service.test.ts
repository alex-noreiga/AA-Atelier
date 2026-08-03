import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep the real EVENT_PROP_* constants (the service uses them as the event's
// extended-property keys) but stub the network calls.
vi.mock(
  "../../src/lib/google/calendar.repository.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/lib/google/calendar.repository.js")
      >();
    return {
      ...actual,
      getScheduleConfig: vi.fn(),
      listBusyInRange: vi.fn(),
      getCalendarEvent: vi.fn(),
      updateCalendarEvent: vi.fn(),
      cancelCalendarEvent: vi.fn(),
    };
  },
);

import {
  getAppointmentForManage,
  rescheduleAppointment,
  cancelAppointment,
} from "../../src/services/appointment-manage.service.js";
import {
  getScheduleConfig,
  listBusyInRange,
  getCalendarEvent,
  updateCalendarEvent,
  cancelCalendarEvent,
  type CalendarEventDetails,
} from "../../src/lib/google/calendar.repository.js";
import { signToken } from "../../src/lib/auth/tokens.js";
import {
  addCalendarDays,
  dateInZone,
  weekdayName,
} from "../../src/lib/appointments/time.js";
import type { WeeklyHours } from "../../src/lib/appointments/availability.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../../src/lib/errors.js";

const mockSchedule = vi.mocked(getScheduleConfig);
const mockBusy = vi.mocked(listBusyInRange);
const mockGet = vi.mocked(getCalendarEvent);
const mockUpdate = vi.mocked(updateCalendarEvent);
const mockCancel = vi.mocked(cancelCalendarEvent);

// A day comfortably in the future so a 0-hour lead time is always satisfied.
const TARGET_DATE = addCalendarDays(dateInZone(new Date(), "UTC"), 14);
const FIRST_SLOT_ISO = `${TARGET_DATE}T09:00:00.000Z`;

const weeklyHours: WeeklyHours[] = [
  {
    staff: "Alayna",
    weekday: weekdayName(TARGET_DATE),
    startMinutes: 540, // 09:00
    endMinutes: 660, // 11:00
    locations: ["in-person", "virtual"],
  },
];

/** A confirmed, future consultation event on Alayna's calendar. */
function fakeEvent(
  overrides: Partial<CalendarEventDetails> = {},
): CalendarEventDetails {
  return {
    id: "evt-1",
    status: "confirmed",
    start: new Date(`${TARGET_DATE}T10:00:00.000Z`),
    end: new Date(`${TARGET_DATE}T10:30:00.000Z`),
    extended: {
      aptType: "consultation",
      aptLocation: "in-person",
      aptConfirmation: "APT-XYZ",
      aptEmail: "ada@example.com",
      aptName: "Ada Lovelace",
    },
    ...overrides,
  };
}

function manageToken(): string {
  return signToken("ada@example.com", "appointment", 3600, {
    eventId: "evt-1",
    staff: "Alayna",
  });
}

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret";
  process.env.PUBLIC_BASE_URL = "https://example.test";
  process.env.APPOINTMENT_TIMEZONE = "UTC";
  process.env.APPOINTMENT_MIN_LEAD_HOURS = "0";
  process.env.APPOINTMENT_SLOT_STEP_MINUTES = "30";
  mockSchedule.mockResolvedValue({ weeklyHours, timeOff: [] });
  mockBusy.mockResolvedValue([]);
  mockGet.mockResolvedValue(fakeEvent());
  mockUpdate.mockResolvedValue({ calendarLink: "https://cal.test/evt" });
  mockCancel.mockResolvedValue(undefined);
});

describe("getAppointmentForManage", () => {
  it("returns the appointment's live details from the token", async () => {
    const details = await getAppointmentForManage(manageToken());
    expect(details).toMatchObject({
      status: "confirmed",
      confirmationCode: "APT-XYZ",
      typeId: "consultation",
      typeName: "Consultation",
      staff: "Alayna",
      location: "in-person",
      locationLabel: "In person",
      timezone: "UTC",
      canModify: true,
    });
    expect(mockGet).toHaveBeenCalledWith("Alayna", "evt-1");
  });

  it("rejects an invalid / forged token with a 400", async () => {
    await expect(getAppointmentForManage("not-a-token")).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("rejects a token missing the appointment claims", async () => {
    // A well-signed appointment token, but with no eventId/staff claims.
    const wrong = signToken("ada@example.com", "appointment", 3600);
    await expect(getAppointmentForManage(wrong)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("404s when the event no longer exists", async () => {
    mockGet.mockResolvedValue(null);
    await expect(getAppointmentForManage(manageToken())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("reports a cancelled event as not modifiable", async () => {
    mockGet.mockResolvedValue(fakeEvent({ status: "cancelled" }));
    const details = await getAppointmentForManage(manageToken());
    expect(details.status).toBe("cancelled");
    expect(details.canModify).toBe(false);
  });
});

describe("rescheduleAppointment", () => {
  it("re-checks the slot and PATCHes the event to the new time", async () => {
    const details = await rescheduleAppointment(
      manageToken(),
      new Date(FIRST_SLOT_ISO),
    );

    expect(mockUpdate).toHaveBeenCalledOnce();
    const [staff, eventId, when] = mockUpdate.mock.calls[0];
    expect(staff).toBe("Alayna");
    expect(eventId).toBe("evt-1");
    expect(when.start).toEqual(new Date(FIRST_SLOT_ISO));
    expect(when.end).toEqual(new Date(`${TARGET_DATE}T09:30:00.000Z`));
    expect(details.status).toBe("confirmed");
  });

  it("400s when the requested slot is no longer available", async () => {
    mockBusy.mockResolvedValue([
      {
        staff: "Alayna",
        start: new Date(FIRST_SLOT_ISO),
        end: new Date(`${TARGET_DATE}T09:30:00.000Z`),
      },
    ]);
    await expect(
      rescheduleAppointment(manageToken(), new Date(FIRST_SLOT_ISO)),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("409s when the appointment has already started", async () => {
    mockGet.mockResolvedValue(
      fakeEvent({ start: new Date("2020-01-01T10:00:00.000Z") }),
    );
    await expect(
      rescheduleAppointment(manageToken(), new Date(FIRST_SLOT_ISO)),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("404s when the event is gone", async () => {
    mockGet.mockResolvedValue(null);
    await expect(
      rescheduleAppointment(manageToken(), new Date(FIRST_SLOT_ISO)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("cancelAppointment", () => {
  it("deletes the event", async () => {
    await cancelAppointment(manageToken());
    expect(mockCancel).toHaveBeenCalledWith("Alayna", "evt-1");
  });

  it("is a no-op when the event is already gone", async () => {
    mockGet.mockResolvedValue(null);
    await expect(cancelAppointment(manageToken())).resolves.toBeUndefined();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("is a no-op when the event is already cancelled", async () => {
    mockGet.mockResolvedValue(fakeEvent({ status: "cancelled" }));
    await cancelAppointment(manageToken());
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it("rejects an invalid token with a 400", async () => {
    await expect(cancelAppointment("nope")).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });
});
