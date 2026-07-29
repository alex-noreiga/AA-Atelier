import { describe, it, expect, vi, beforeEach } from "vitest";

// Real EVENT_PROP_* constants, stubbed network calls.
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

import request from "supertest";
import app from "../../src/app.js";
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

const mockSchedule = vi.mocked(getScheduleConfig);
const mockBusy = vi.mocked(listBusyInRange);
const mockGet = vi.mocked(getCalendarEvent);
const mockUpdate = vi.mocked(updateCalendarEvent);
const mockCancel = vi.mocked(cancelCalendarEvent);

const TARGET_DATE = addCalendarDays(dateInZone(new Date(), "UTC"), 14);
const NEW_SLOT_ISO = `${TARGET_DATE}T09:00:00.000Z`;

const weeklyHours: WeeklyHours[] = [
  {
    staff: "Alayna",
    weekday: weekdayName(TARGET_DATE),
    startMinutes: 540,
    endMinutes: 660,
    locations: ["in-person", "virtual"],
  },
];

function event(
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

function token(): string {
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
  mockGet.mockResolvedValue(event());
  mockUpdate.mockResolvedValue({ calendarLink: "https://cal.test/evt" });
  mockCancel.mockResolvedValue(undefined);
});

describe("GET /api/appointments/manage", () => {
  it("returns the appointment details for a valid token", async () => {
    const res = await request(app)
      .get("/api/appointments/manage")
      .query({ token: token() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "confirmed",
      typeName: "Consultation",
      staff: "Alayna",
      location: "in-person",
      canModify: true,
    });
  });

  it("400s when the token is missing", async () => {
    const res = await request(app).get("/api/appointments/manage");
    expect(res.status).toBe(400);
  });

  it("400s on a forged token", async () => {
    const res = await request(app)
      .get("/api/appointments/manage")
      .query({ token: "forged" });
    expect(res.status).toBe(400);
  });

  it("404s when the event no longer exists", async () => {
    mockGet.mockResolvedValue(null);
    const res = await request(app)
      .get("/api/appointments/manage")
      .query({ token: token() });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/appointments/reschedule", () => {
  it("moves the appointment and returns the new details", async () => {
    const res = await request(app)
      .post("/api/appointments/reschedule")
      .send({ token: token(), start: NEW_SLOT_ISO });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(res.body.status).toBe("confirmed");
  });

  it("400s when the slot is taken", async () => {
    mockBusy.mockResolvedValue([
      {
        staff: "Alayna",
        start: new Date(NEW_SLOT_ISO),
        end: new Date(`${TARGET_DATE}T09:30:00.000Z`),
      },
    ]);
    const res = await request(app)
      .post("/api/appointments/reschedule")
      .send({ token: token(), start: NEW_SLOT_ISO });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/appointments/cancel", () => {
  it("cancels the appointment and returns a message", async () => {
    const res = await request(app)
      .post("/api/appointments/cancel")
      .send({ token: token() });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/cancelled/i);
    expect(mockCancel).toHaveBeenCalledOnce();
  });

  it("400s on a missing token", async () => {
    const res = await request(app).post("/api/appointments/cancel").send({});
    expect(res.status).toBe(400);
  });
});
