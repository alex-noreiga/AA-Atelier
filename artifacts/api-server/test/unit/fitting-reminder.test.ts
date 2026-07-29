import { describe, it, expect, afterEach } from "vitest";
import {
  fittingReminderStages,
  fittingReminderLeadDays,
  reminderCutoffDate,
} from "../../src/services/fitting-reminder.js";

afterEach(() => {
  delete process.env.FITTING_REMINDER_STAGES;
  delete process.env.FITTING_REMINDER_LEAD_DAYS;
});

describe("fittingReminderStages", () => {
  it("defaults to the 'Fitting' stage when unset", () => {
    expect(fittingReminderStages()).toEqual(["Fitting"]);
  });

  it("parses a comma-separated override, trimming and dropping empties", () => {
    process.env.FITTING_REMINDER_STAGES = " First Fitting , Second Fitting , ";
    expect(fittingReminderStages()).toEqual([
      "First Fitting",
      "Second Fitting",
    ]);
  });

  it("falls back to the default for a blank or all-empty override", () => {
    process.env.FITTING_REMINDER_STAGES = "   ";
    expect(fittingReminderStages()).toEqual(["Fitting"]);
    process.env.FITTING_REMINDER_STAGES = " , , ";
    expect(fittingReminderStages()).toEqual(["Fitting"]);
  });
});

describe("fittingReminderLeadDays", () => {
  it("defaults to 10 days when unset", () => {
    expect(fittingReminderLeadDays()).toBe(10);
  });

  it("reads a numeric override", () => {
    process.env.FITTING_REMINDER_LEAD_DAYS = "14";
    expect(fittingReminderLeadDays()).toBe(14);
  });

  it("falls back to the default for a non-numeric or non-positive override", () => {
    process.env.FITTING_REMINDER_LEAD_DAYS = "soon";
    expect(fittingReminderLeadDays()).toBe(10);
    process.env.FITTING_REMINDER_LEAD_DAYS = "0";
    expect(fittingReminderLeadDays()).toBe(10);
    process.env.FITTING_REMINDER_LEAD_DAYS = "-5";
    expect(fittingReminderLeadDays()).toBe(10);
  });
});

describe("reminderCutoffDate", () => {
  it("returns now + leadDays as an ISO calendar date (UTC)", () => {
    const now = new Date("2026-08-01T09:30:00Z");
    expect(reminderCutoffDate(now, 10)).toBe("2026-08-11");
  });

  it("handles a month boundary", () => {
    const now = new Date("2026-08-25T00:00:00Z");
    expect(reminderCutoffDate(now, 10)).toBe("2026-09-04");
  });
});
