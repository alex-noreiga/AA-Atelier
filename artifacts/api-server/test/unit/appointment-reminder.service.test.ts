import { describe, it, expect, vi, beforeEach } from "vitest";

// The sweep reads a window of calendar events, emails whoever is due, and stamps
// the marker back onto the event. Mock those seams so the test drives the
// service's own decisions — who is due, who has been told, what can't be
// reminded — without Google or Resend.
vi.mock("../../src/lib/google/calendar.repository.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/google/calendar.repository.js")
  >("../../src/lib/google/calendar.repository.js");
  return {
    ...actual,
    listAppointmentsInRange: vi.fn(),
    markAppointmentReminded: vi.fn(),
  };
});
vi.mock("../../src/lib/google/client.js", () => ({
  googleCalendarConfigured: vi.fn(() => true),
}));
vi.mock("../../src/lib/db/client.js", () => ({
  postgresConfigured: vi.fn(() => true),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));
vi.mock("../../src/services/sms.service.js", () => ({
  textCustomer: vi.fn(async () => "no-consent"),
}));
vi.mock("../../src/services/appointment-manage.service.js", () => ({
  buildManageUrl: vi.fn(
    () => "https://atelier.test/appointments/manage?token=t",
  ),
}));

import { notifyUpcomingAppointments } from "../../src/services/appointment-reminder.service.js";
import {
  listAppointmentsInRange,
  markAppointmentReminded,
  type CalendarEventDetails,
  type StaffCalendarEvent,
} from "../../src/lib/google/calendar.repository.js";
import { googleCalendarConfigured } from "../../src/lib/google/client.js";
import { postgresConfigured } from "../../src/lib/db/client.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { textCustomer } from "../../src/services/sms.service.js";
import { reminderMarkerValue } from "../../src/lib/appointments/reminders.js";

const mockList = vi.mocked(listAppointmentsInRange);
const mockMark = vi.mocked(markAppointmentReminded);
const mockGoogle = vi.mocked(googleCalendarConfigured);
const mockPostgres = vi.mocked(postgresConfigured);
const mockSend = vi.mocked(sendEmailBestEffort);
const mockText = vi.mocked(textCustomer);

const NOW = new Date("2026-08-21T08:00:00Z"); // 3am Central
const START = new Date("2026-08-22T15:00:00Z"); // 10am Central, tomorrow

function booking(
  overrides: Partial<CalendarEventDetails> = {},
  staff = "Alayna",
): StaffCalendarEvent {
  return {
    staff,
    event: {
      id: "evt-1",
      status: "confirmed",
      start: START,
      end: new Date(START.getTime() + 60 * 60 * 1000),
      ...overrides,
      extended: {
        aptType: "fitting",
        aptLocation: "in-person",
        aptConfirmation: "AA-1234",
        aptEmail: "skater@example.com",
        aptName: "Nina Petrova",
        ...(overrides.extended ?? {}),
      },
    },
  };
}

beforeEach(() => {
  mockGoogle.mockReturnValue(true);
  mockPostgres.mockReturnValue(true);
  mockList.mockResolvedValue([]);
  // Most customers haven't opted in to texts; the SMS cases opt in explicitly.
  mockText.mockResolvedValue("no-consent");
});

describe("notifyUpcomingAppointments", () => {
  it("emails the customer and marks the event with the start it reminded about", async () => {
    mockList.mockResolvedValue([booking()]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ status: "sent", sent: 1 });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("skater@example.com");
    expect(message.subject).toBe(
      "Reminder: your Fitting & Measurements appointment is tomorrow",
    );
    // The card's whole point: the reschedule link rides along.
    expect(message.text).toContain("https://atelier.test/appointments/manage");

    expect(mockMark).toHaveBeenCalledWith(
      "Alayna",
      "evt-1",
      expect.objectContaining({ aptEmail: "skater@example.com" }),
      { key: "aptRemindedEmail", value: reminderMarkerValue(START) },
    );
  });

  it("skips a customer already reminded about this booking at this time", async () => {
    mockList.mockResolvedValue([
      booking({ extended: { aptRemindedEmail: reminderMarkerValue(START) } }),
    ]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ status: "skipped", alreadyReminded: 1 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  // A reschedule moves `start`, so the stale marker stops matching and the
  // customer hears about the new time — the reason the marker holds a time.
  it("reminds again when the booking has moved since the last reminder", async () => {
    mockList.mockResolvedValue([
      booking({
        extended: {
          aptRemindedEmail: new Date("2026-08-22T18:00:00Z").toISOString(),
        },
      }),
    ]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result.sent).toBe(1);
  });

  it("leaves a cancelled event alone", async () => {
    mockList.mockResolvedValue([booking({ status: "cancelled" })]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ status: "skipped", skipped: 1 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips an event it can't read as one of ours", async () => {
    mockList.mockResolvedValue([booking({ extended: { aptType: "" } })]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result.skipped).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips a booking with nobody to write to", async () => {
    mockList.mockResolvedValue([booking({ extended: { aptEmail: "" } })]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result.skipped).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
  });

  // Send, then mark: a failed marker risks one duplicate, while marking first
  // would risk the reminder this feature exists to send.
  it("still counts a reminder whose marker couldn't be written", async () => {
    mockList.mockResolvedValue([booking()]);
    mockMark.mockRejectedValue(new Error("calendar patch failed"));

    const result = await notifyUpcomingAppointments(NOW);

    expect(result.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("carries on past one unreadable booking", async () => {
    mockSend.mockRejectedValueOnce(new Error("boom"));
    mockList.mockResolvedValue([
      booking({ id: "evt-1" }),
      booking({ id: "evt-2" }, "Alexandra"),
    ]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ status: "sent", sent: 1, skipped: 1 });
  });

  it("says there was nothing to do when the window is empty", async () => {
    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ status: "skipped", sent: 0 });
    expect(result.reason).toContain("no appointments coming up");
  });

  // It runs unattended nightly, so an install without appointments configured
  // must report a quiet skip rather than an error to alert on.
  it("reports unconfigured rather than throwing when Google is absent", async () => {
    mockGoogle.mockReturnValue(false);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result.status).toBe("unconfigured");
    expect(mockList).not.toHaveBeenCalled();
  });

  it("reports unconfigured when there are no working hours to read calendars from", async () => {
    mockPostgres.mockReturnValue(false);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result.status).toBe("unconfigured");
    expect(mockList).not.toHaveBeenCalled();
  });
});

// --- The second channel -----------------------------------------------------
//
// The two markers are read independently, which is what the per-channel scheme
// was built for: every booking taken before texts existed already carries an
// email marker, so a shared "have we reminded them?" test would have found the
// whole back catalogue answered and sent nobody a first text.

describe("notifyUpcomingAppointments: texts", () => {
  it("texts a consenting customer and marks the SMS channel separately", async () => {
    mockText.mockResolvedValue("sent");
    mockList.mockResolvedValue([booking()]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ status: "sent", sent: 1, texted: 1 });
    expect(mockText).toHaveBeenCalledTimes(1);
    expect(mockText.mock.calls[0][0]).toBe("skater@example.com");
    // Its own marker, holding the same start the email's does.
    expect(mockMark).toHaveBeenCalledWith(
      "Alayna",
      "evt-1",
      expect.anything(),
      { key: "aptRemindedSms", value: reminderMarkerValue(START) },
    );
  });

  it("still texts a booking that was already emailed about", async () => {
    mockText.mockResolvedValue("sent");
    mockList.mockResolvedValue([
      booking({ extended: { aptRemindedEmail: reminderMarkerValue(START) } }),
    ]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ status: "sent", sent: 0, texted: 1 });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockText).toHaveBeenCalledTimes(1);
  });

  it("does nothing when both channels have answered this start time", async () => {
    mockText.mockResolvedValue("sent");
    mockList.mockResolvedValue([
      booking({
        extended: {
          aptRemindedEmail: reminderMarkerValue(START),
          aptRemindedSms: reminderMarkerValue(START),
        },
      }),
    ]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ status: "skipped", alreadyReminded: 1 });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockText).not.toHaveBeenCalled();
  });

  it("leaves the SMS marker unwritten when no text went out, so a later opt-in still earns one", async () => {
    mockText.mockResolvedValue("no-consent");
    mockList.mockResolvedValue([booking()]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ sent: 1, texted: 0 });
    const markedChannels = mockMark.mock.calls.map((call) => call[3].key);
    expect(markedChannels).toEqual(["aptRemindedEmail"]);
  });

  it("counts a booking with nothing new to say as already reminded", async () => {
    // Emailed last night, and the customer has never opted in to texts. It is
    // not a failure and not a skip — there was simply nothing left to send.
    mockList.mockResolvedValue([
      booking({ extended: { aptRemindedEmail: reminderMarkerValue(START) } }),
    ]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({
      status: "skipped",
      sent: 0,
      texted: 0,
      alreadyReminded: 1,
      skipped: 0,
    });
  });

  it("never texts instead of emailing: a failed email stops the booking there", async () => {
    mockText.mockResolvedValue("sent");
    mockSend.mockRejectedValueOnce(new Error("resend down"));
    mockList.mockResolvedValue([booking()]);

    const result = await notifyUpcomingAppointments(NOW);

    expect(result).toMatchObject({ sent: 0, texted: 0, skipped: 1 });
    expect(mockText).not.toHaveBeenCalled();
  });
});
