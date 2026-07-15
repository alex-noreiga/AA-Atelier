import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/google/calendar.repository.js", () => ({
  getScheduleConfig: vi.fn(),
  listBusyInRange: vi.fn(),
  createCalendarEvent: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  getScheduleConfig,
  listBusyInRange,
  createCalendarEvent,
} from "../../src/lib/google/calendar.repository.js";
import {
  addCalendarDays,
  dateInZone,
  weekdayName,
} from "../../src/lib/appointments/time.js";
import type { WeeklyHours } from "../../src/lib/appointments/availability.js";

const mockSchedule = vi.mocked(getScheduleConfig);
const mockBusy = vi.mocked(listBusyInRange);
const mockCreate = vi.mocked(createCalendarEvent);

// A date comfortably in the future so the 0-hour lead time is always satisfied
// regardless of the machine clock. Times are UTC so wall-clock == instant.
const TARGET_DATE = addCalendarDays(dateInZone(new Date(), "UTC"), 14);
const FIRST_SLOT_ISO = `${TARGET_DATE}T09:00:00.000Z`;

const weeklyHours: WeeklyHours[] = [
  {
    staff: "Alexandra",
    weekday: weekdayName(TARGET_DATE),
    startMinutes: 540, // 09:00
    endMinutes: 660, // 11:00
    locations: ["in-person", "virtual"],
  },
];

beforeEach(() => {
  process.env.APPOINTMENT_TIMEZONE = "UTC";
  process.env.APPOINTMENT_MIN_LEAD_HOURS = "0";
  process.env.APPOINTMENT_SLOT_STEP_MINUTES = "30";
  mockSchedule.mockReturnValue({ weeklyHours, timeOff: [] });
  mockBusy.mockResolvedValue([]);
  mockCreate.mockResolvedValue({ calendarLink: "https://cal.test/event" });
});

describe("GET /api/appointments/options", () => {
  it("returns the bookable types and timezone", async () => {
    const res = await request(app).get("/api/appointments/options");
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe("UTC");
    expect(res.body.types.map((t: { id: string }) => t.id)).toEqual([
      "consultation",
      "fitting",
      "design-review",
      "general",
    ]);
  });
});

describe("GET /api/appointments/availability", () => {
  it("returns open slots for a type + location", async () => {
    const res = await request(app).get("/api/appointments/availability").query({
      typeId: "consultation",
      location: "in-person",
      from: TARGET_DATE,
      days: 1,
    });

    expect(res.status).toBe(200);
    // 09:00, 09:30, 10:00, 10:30 (60-min consult fits until 11:00).
    expect(res.body.slots).toHaveLength(4);
    expect(res.body.slots[0].start).toBe(FIRST_SLOT_ISO);
    expect(res.body.slots[0].staff).toBe("Alexandra");
  });

  it("400s on an unknown type", async () => {
    const res = await request(app)
      .get("/api/appointments/availability")
      .query({ typeId: "mystery", location: "in-person" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("400s on a bad location enum before hitting the service", async () => {
    const res = await request(app)
      .get("/api/appointments/availability")
      .query({ typeId: "consultation", location: "carrier-pigeon" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/appointments", () => {
  const body = () => ({
    typeId: "consultation",
    location: "in-person",
    start: FIRST_SLOT_ISO,
    fullName: "Ada Lovelace",
    email: "ada@example.com",
  });

  it("books an open slot and returns 201 with a confirmation", async () => {
    const res = await request(app).post("/api/appointments").send(body());

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("Consultation");
    expect(res.body.staff).toBe("Alexandra");
    expect(res.body.location).toBe("In person");
    expect(res.body.confirmationCode).toMatch(/^APT-/);
    expect(res.body.calendarLink).toBe("https://cal.test/event");
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("400s when the slot is no longer available", async () => {
    mockBusy.mockResolvedValue([
      {
        staff: "Alexandra",
        start: new Date(FIRST_SLOT_ISO),
        end: new Date(`${TARGET_DATE}T09:30:00.000Z`),
      },
    ]);
    const res = await request(app).post("/api/appointments").send(body());
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("400s on a missing required field", async () => {
    const res = await request(app)
      .post("/api/appointments")
      .send({ typeId: "consultation", location: "in-person" });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
