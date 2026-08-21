import { describe, it, expect } from "vitest";

import {
  reminderDue,
  reminderMarkerKey,
  reminderMarkerValue,
  reminderWindow,
  whenPhrase,
} from "../../src/lib/appointments/reminders.js";

const ZONE = "America/Chicago";

describe("reminderWindow", () => {
  // The whole point of a calendar-day window: the nightly run fires in the small
  // hours, so an appointment tomorrow morning is well over 24 hours away when the
  // sweep sees it. A duration-based cutoff would skip exactly the bookings this
  // feature exists for.
  it("reaches the end of the local day `leadDays` ahead, not 24 hours out", () => {
    // 3:00am Central on 2026-08-21 (CDT = UTC-5).
    const now = new Date("2026-08-21T08:00:00Z");
    const { from, to } = reminderWindow(now, ZONE, 1);

    expect(from).toEqual(now);
    // Midnight Central at the start of the 23rd = 05:00Z.
    expect(to.toISOString()).toBe("2026-08-23T05:00:00.000Z");

    const tomorrowMorning = new Date("2026-08-22T14:00:00Z"); // 9am Central
    expect(tomorrowMorning.getTime()).toBeGreaterThan(from.getTime());
    expect(tomorrowMorning.getTime()).toBeLessThan(to.getTime());
    // ...and it is more than 24 hours away, which is the case a duration misses.
    expect(tomorrowMorning.getTime() - now.getTime()).toBeGreaterThan(
      24 * 60 * 60 * 1000,
    );
  });

  it("starts at now, so an appointment already under way is out of scope", () => {
    const now = new Date("2026-08-21T18:00:00Z");
    const { from } = reminderWindow(now, ZONE, 1);
    expect(from).toEqual(now);
  });

  it("still covers what is left of today, so a missed run is late not lost", () => {
    const now = new Date("2026-08-21T08:00:00Z");
    const { from, to } = reminderWindow(now, ZONE, 1);
    const laterToday = new Date("2026-08-21T21:00:00Z"); // 4pm Central
    expect(laterToday.getTime()).toBeGreaterThan(from.getTime());
    expect(laterToday.getTime()).toBeLessThan(to.getTime());
  });

  it("extends by whole local days for a longer lead", () => {
    const now = new Date("2026-08-21T08:00:00Z");
    expect(reminderWindow(now, ZONE, 3).to.toISOString()).toBe(
      "2026-08-25T05:00:00.000Z",
    );
  });
});

describe("reminder markers", () => {
  it("keeps one key per channel, so a new channel starts with a clean history", () => {
    expect(reminderMarkerKey("email")).toBe("aptRemindedEmail");
    expect(reminderMarkerKey("sms")).toBe("aptRemindedSms");
    expect(reminderMarkerKey("email")).not.toBe(reminderMarkerKey("sms"));
  });

  it("records the start instant reminded about, not a flag", () => {
    const start = new Date("2026-08-22T15:00:00Z");
    expect(reminderMarkerValue(start)).toBe("2026-08-22T15:00:00.000Z");
  });

  it("is due when nothing has been recorded", () => {
    const start = new Date("2026-08-22T15:00:00Z");
    expect(reminderDue({}, start, "email")).toBe(true);
  });

  it("is not due once this exact start has been recorded", () => {
    const start = new Date("2026-08-22T15:00:00Z");
    const extended = { aptRemindedEmail: reminderMarkerValue(start) };
    expect(reminderDue(extended, start, "email")).toBe(false);
  });

  // The reason the marker holds a time rather than `true`: a customer who moves
  // their appointment after being reminded must hear about the new time.
  it("becomes due again when the booking is rescheduled", () => {
    const original = new Date("2026-08-22T15:00:00Z");
    const moved = new Date("2026-08-22T18:00:00Z");
    const extended = { aptRemindedEmail: reminderMarkerValue(original) };
    expect(reminderDue(extended, moved, "email")).toBe(true);
  });

  it("does not let one channel's history answer for another", () => {
    const start = new Date("2026-08-22T15:00:00Z");
    const extended = { aptRemindedEmail: reminderMarkerValue(start) };
    expect(reminderDue(extended, start, "sms")).toBe(true);
  });
});

describe("whenPhrase", () => {
  const now = new Date("2026-08-21T08:00:00Z"); // 3am Friday, Central

  it("says tomorrow for the next local day", () => {
    expect(whenPhrase(new Date("2026-08-22T15:00:00Z"), now, ZONE)).toBe(
      "tomorrow",
    );
  });

  it("says today for the same local day", () => {
    expect(whenPhrase(new Date("2026-08-21T21:00:00Z"), now, ZONE)).toBe(
      "today",
    );
  });

  it("names the day for anything further out", () => {
    expect(whenPhrase(new Date("2026-08-24T15:00:00Z"), now, ZONE)).toBe(
      "on Monday, August 24",
    );
  });

  // Read in the atelier's zone, not the server's: 8pm Central on the 21st is
  // already the 22nd in UTC, and the customer is not.
  it("reads the calendar day in the atelier's timezone", () => {
    const lateEvening = new Date("2026-08-22T01:00:00Z"); // 8pm Central, the 21st
    expect(whenPhrase(lateEvening, now, ZONE)).toBe("today");
  });
});
