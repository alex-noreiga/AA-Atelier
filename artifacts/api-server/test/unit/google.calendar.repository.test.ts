import { describe, it, expect, vi, beforeEach } from "vitest";

// The calendar repository resolves staff → calendar email and the working-hours
// grid through the sheets repository; mock that layer so these tests focus on
// the FreeBusy / event-insert mapping.
vi.mock("../../src/lib/google/sheets.repository.js", () => ({
  getStaffSchedule: vi.fn(),
  calendarEmailFor: vi.fn(),
}));

import {
  createCalendarEvent,
  getCalendarEvent,
  updateCalendarEvent,
  cancelCalendarEvent,
  getScheduleConfig,
  listBusyInRange,
  type BookedAppointment,
} from "../../src/lib/google/calendar.repository.js";
import {
  getStaffSchedule,
  calendarEmailFor,
} from "../../src/lib/google/sheets.repository.js";
import type { GoogleCalendarClient } from "../../src/lib/google/client.js";

const mockSchedule = vi.mocked(getStaffSchedule);
const mockEmail = vi.mocked(calendarEmailFor);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeClient(
  impl: (subject: string, path: string, init?: RequestInit) => Response,
): GoogleCalendarClient & {
  calls: Array<{ subject: string; path: string; init?: RequestInit }>;
} {
  const calls: Array<{ subject: string; path: string; init?: RequestInit }> =
    [];
  return {
    calls,
    async fetch(subject, path, init) {
      calls.push({ subject, path, init });
      return impl(subject, path, init);
    },
  };
}

beforeEach(() => {
  mockEmail.mockResolvedValue("alexandra@atelier.test");
});

describe("getScheduleConfig", () => {
  it("returns the sheet's weekly hours with empty time-off", async () => {
    mockSchedule.mockResolvedValue({
      weeklyHours: [
        {
          staff: "Alexandra",
          weekday: "Monday",
          startMinutes: 600,
          endMinutes: 1020,
          locations: ["in-person"],
        },
      ],
      calendars: new Map(),
    });
    const config = await getScheduleConfig();
    expect(config.timeOff).toEqual([]);
    expect(config.weeklyHours[0]).toMatchObject({ staff: "Alexandra" });
  });
});

describe("listBusyInRange", () => {
  it("maps each calendar's busy intervals to Booking[] tagged with staff", async () => {
    const client = fakeClient(() =>
      jsonResponse({
        calendars: {
          "alexandra@atelier.test": {
            busy: [
              { start: "2026-07-20T14:00:00Z", end: "2026-07-20T15:00:00Z" },
            ],
          },
        },
      }),
    );

    const from = new Date("2026-07-20T00:00:00Z");
    const to = new Date("2026-07-21T00:00:00Z");
    const bookings = await listBusyInRange(from, to, ["Alexandra"], client);

    expect(bookings).toEqual([
      {
        staff: "Alexandra",
        start: new Date("2026-07-20T14:00:00Z"),
        end: new Date("2026-07-20T15:00:00Z"),
      },
    ]);
    expect(client.calls[0].subject).toBe("alexandra@atelier.test");
    expect(client.calls[0].path).toBe("/freeBusy");
    const reqBody = JSON.parse(client.calls[0].init!.body as string);
    expect(reqBody.items).toEqual([{ id: "alexandra@atelier.test" }]);
  });

  it("skips staff with no configured calendar", async () => {
    mockEmail.mockResolvedValue(undefined);
    const client = fakeClient(() => jsonResponse({ calendars: {} }));
    const bookings = await listBusyInRange(
      new Date(),
      new Date(),
      ["Nobody"],
      client,
    );
    expect(bookings).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });
});

describe("createCalendarEvent", () => {
  const base: BookedAppointment = {
    customerName: "Ada Lovelace",
    email: "ada@example.com",
    typeId: "consultation",
    typeName: "Consultation",
    staff: "Alexandra",
    location: "in-person",
    locationLabel: "In person",
    start: new Date("2026-07-20T14:00:00.000Z"),
    end: new Date("2026-07-20T14:30:00.000Z"),
    timeZone: "America/New_York",
    confirmationCode: "APT-AB12CD",
  };

  it("inserts an event with the customer as an attendee and returns the id + links", async () => {
    const client = fakeClient(() =>
      jsonResponse({ id: "evt-1", htmlLink: "https://cal/evt" }),
    );

    const result = await createCalendarEvent(
      base,
      "Consultation — Ada",
      client,
    );

    expect(result).toEqual({
      eventId: "evt-1",
      meetingUrl: undefined,
      calendarLink: "https://cal/evt",
    });
    const call = client.calls[0];
    expect(call.subject).toBe("alexandra@atelier.test");
    expect(call.path).toContain("/calendars/alexandra%40atelier.test/events");
    expect(call.path).toContain("sendUpdates=all");
    expect(call.path).toContain("conferenceDataVersion=1");
    const body = JSON.parse(call.init!.body as string);
    expect(body.attendees).toEqual([
      { email: "ada@example.com", displayName: "Ada Lovelace" },
    ]);
    expect(body.start).toEqual({
      dateTime: "2026-07-20T14:00:00.000Z",
      timeZone: "America/New_York",
    });
    // The event is self-describing for later reschedule/cancel.
    expect(body.extendedProperties.private).toMatchObject({
      aptType: "consultation",
      aptLocation: "in-person",
      aptConfirmation: "APT-AB12CD",
      aptEmail: "ada@example.com",
      aptName: "Ada Lovelace",
    });
    expect(body.conferenceData).toBeUndefined();
  });

  it("requests a Google Meet link for a virtual booking", async () => {
    const client = fakeClient(() =>
      jsonResponse({
        htmlLink: "https://cal/evt",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      }),
    );

    const result = await createCalendarEvent(
      { ...base, location: "virtual", locationLabel: "Virtual" },
      "Consultation — Ada",
      client,
    );

    expect(result.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe(
      "hangoutsMeet",
    );
  });

  it("throws when the staff member has no configured calendar", async () => {
    mockEmail.mockResolvedValue(undefined);
    const client = fakeClient(() => jsonResponse({}));
    await expect(
      createCalendarEvent({ ...base, staff: "Ghost" }, "t", client),
    ).rejects.toThrow(/No calendar/);
  });
});

describe("getCalendarEvent", () => {
  it("reads back the event, its status, times, and private properties", async () => {
    const client = fakeClient(() =>
      jsonResponse({
        id: "evt-1",
        status: "confirmed",
        htmlLink: "https://cal/evt",
        hangoutLink: "https://meet.google.com/abc",
        start: { dateTime: "2026-07-20T14:00:00Z" },
        end: { dateTime: "2026-07-20T14:30:00Z" },
        extendedProperties: {
          private: { aptType: "consultation", aptLocation: "virtual" },
        },
      }),
    );

    const result = await getCalendarEvent("Alexandra", "evt-1", client);

    expect(result).toEqual({
      id: "evt-1",
      status: "confirmed",
      start: new Date("2026-07-20T14:00:00Z"),
      end: new Date("2026-07-20T14:30:00Z"),
      meetingUrl: "https://meet.google.com/abc",
      calendarLink: "https://cal/evt",
      extended: { aptType: "consultation", aptLocation: "virtual" },
    });
    const call = client.calls[0];
    expect(call.subject).toBe("alexandra@atelier.test");
    expect(call.path).toBe("/calendars/alexandra%40atelier.test/events/evt-1");
    expect(call.init!.method).toBe("GET");
  });

  it("returns null when the event no longer exists (404)", async () => {
    const client = fakeClient(() => jsonResponse({}, 404));
    expect(await getCalendarEvent("Alexandra", "gone", client)).toBeNull();
  });
});

describe("updateCalendarEvent", () => {
  it("PATCHes the new times with sendUpdates=all and returns the links", async () => {
    const client = fakeClient(() =>
      jsonResponse({ htmlLink: "https://cal/evt" }),
    );

    const result = await updateCalendarEvent(
      "Alexandra",
      "evt-1",
      {
        start: new Date("2026-07-21T15:00:00.000Z"),
        end: new Date("2026-07-21T15:30:00.000Z"),
        timeZone: "America/New_York",
      },
      client,
    );

    expect(result).toEqual({
      meetingUrl: undefined,
      calendarLink: "https://cal/evt",
    });
    const call = client.calls[0];
    expect(call.init!.method).toBe("PATCH");
    expect(call.path).toContain(
      "/calendars/alexandra%40atelier.test/events/evt-1",
    );
    expect(call.path).toContain("sendUpdates=all");
    const body = JSON.parse(call.init!.body as string);
    expect(body).toEqual({
      start: {
        dateTime: "2026-07-21T15:00:00.000Z",
        timeZone: "America/New_York",
      },
      end: {
        dateTime: "2026-07-21T15:30:00.000Z",
        timeZone: "America/New_York",
      },
    });
  });
});

describe("cancelCalendarEvent", () => {
  it("DELETEs the event with sendUpdates=all", async () => {
    const client = fakeClient(() => new Response(null, { status: 204 }));
    await cancelCalendarEvent("Alexandra", "evt-1", client);
    const call = client.calls[0];
    expect(call.init!.method).toBe("DELETE");
    expect(call.path).toContain(
      "/calendars/alexandra%40atelier.test/events/evt-1",
    );
    expect(call.path).toContain("sendUpdates=all");
  });

  it("treats an already-gone event (410) as success", async () => {
    const client = fakeClient(() => new Response(null, { status: 410 }));
    await expect(
      cancelCalendarEvent("Alexandra", "gone", client),
    ).resolves.toBeUndefined();
  });
});
