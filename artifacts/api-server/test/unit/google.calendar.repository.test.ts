import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createCalendarEvent,
  getScheduleConfig,
  listBusyInRange,
  type BookedAppointment,
} from "../../src/lib/google/calendar.repository.js";
import type { GoogleCalendarClient } from "../../src/lib/google/client.js";

const CONFIG = [
  {
    name: "Alexandra",
    email: "alexandra@atelier.test",
    hours: [
      {
        days: ["Mon"],
        start: "10:00",
        end: "17:00",
        locations: ["in-person", "virtual"],
      },
    ],
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fake calendar client that records its calls and returns a canned response. */
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
  process.env.APPOINTMENT_STAFF = JSON.stringify(CONFIG);
});

describe("getScheduleConfig", () => {
  it("returns the config weekly hours with empty time-off", () => {
    const config = getScheduleConfig();
    expect(config.timeOff).toEqual([]);
    expect(config.weeklyHours[0]).toMatchObject({
      staff: "Alexandra",
      weekday: "Monday",
    });
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
    // Impersonated the staff and queried their own calendar.
    expect(client.calls[0].subject).toBe("alexandra@atelier.test");
    expect(client.calls[0].path).toBe("/freeBusy");
    const reqBody = JSON.parse(client.calls[0].init!.body as string);
    expect(reqBody.items).toEqual([{ id: "alexandra@atelier.test" }]);
  });

  it("skips staff with no configured calendar", async () => {
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
    typeName: "Consultation",
    staff: "Alexandra",
    location: "in-person",
    locationLabel: "In person",
    start: new Date("2026-07-20T14:00:00.000Z"),
    end: new Date("2026-07-20T14:30:00.000Z"),
    timeZone: "America/New_York",
    confirmationCode: "APT-AB12CD",
  };

  it("inserts an event with the customer as an attendee and returns the links", async () => {
    const client = fakeClient(() =>
      jsonResponse({ htmlLink: "https://cal/evt" }),
    );

    const result = await createCalendarEvent(
      base,
      "Consultation — Ada",
      client,
    );

    expect(result).toEqual({
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
    // In-person: no Meet conference requested.
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
    const client = fakeClient(() => jsonResponse({}));
    await expect(
      createCalendarEvent({ ...base, staff: "Ghost" }, "t", client),
    ).rejects.toThrow(/No calendar/);
  });
});
