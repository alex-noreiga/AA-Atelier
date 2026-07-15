import { describe, it, expect, beforeEach } from "vitest";
import {
  appointmentTimezone,
  minLeadMinutes,
  maxAdvanceDays,
  slotStepMinutes,
} from "../../src/lib/appointments/settings.js";

// Booking policy is read from the environment at call time. These guard the
// fallback-to-default and invalid-value branches, which decide what customers
// can actually book — an out-of-range env var must degrade to the default, not
// leak through.
beforeEach(() => {
  delete process.env.APPOINTMENT_TIMEZONE;
  delete process.env.APPOINTMENT_MIN_LEAD_HOURS;
  delete process.env.APPOINTMENT_MAX_ADVANCE_DAYS;
  delete process.env.APPOINTMENT_SLOT_STEP_MINUTES;
});

describe("appointmentTimezone", () => {
  it("defaults to America/Chicago when unset", () => {
    expect(appointmentTimezone()).toBe("America/Chicago");
  });

  it("uses the configured zone", () => {
    process.env.APPOINTMENT_TIMEZONE = "Europe/London";
    expect(appointmentTimezone()).toBe("Europe/London");
  });
});

describe("minLeadMinutes", () => {
  it("defaults to 24 hours when unset", () => {
    expect(minLeadMinutes()).toBe(24 * 60);
  });

  it("defaults when the value isn't a finite number", () => {
    process.env.APPOINTMENT_MIN_LEAD_HOURS = "soon";
    expect(minLeadMinutes()).toBe(24 * 60);
  });

  it("defaults when the value is negative", () => {
    process.env.APPOINTMENT_MIN_LEAD_HOURS = "-3";
    expect(minLeadMinutes()).toBe(24 * 60);
  });

  it("accepts zero (no lead time required)", () => {
    process.env.APPOINTMENT_MIN_LEAD_HOURS = "0";
    expect(minLeadMinutes()).toBe(0);
  });

  it("converts a configured hour count to minutes", () => {
    process.env.APPOINTMENT_MIN_LEAD_HOURS = "48";
    expect(minLeadMinutes()).toBe(48 * 60);
  });
});

describe("maxAdvanceDays", () => {
  it("defaults to 45 days when unset", () => {
    expect(maxAdvanceDays()).toBe(45);
  });

  it("defaults when the value isn't a finite number", () => {
    process.env.APPOINTMENT_MAX_ADVANCE_DAYS = "lots";
    expect(maxAdvanceDays()).toBe(45);
  });

  it("defaults when the value is below one", () => {
    process.env.APPOINTMENT_MAX_ADVANCE_DAYS = "0";
    expect(maxAdvanceDays()).toBe(45);
  });

  it("floors a fractional configured value", () => {
    process.env.APPOINTMENT_MAX_ADVANCE_DAYS = "30.9";
    expect(maxAdvanceDays()).toBe(30);
  });
});

describe("slotStepMinutes", () => {
  it("defaults to 15 minutes when unset", () => {
    expect(slotStepMinutes()).toBe(15);
  });

  it("defaults when the value isn't a finite number", () => {
    process.env.APPOINTMENT_SLOT_STEP_MINUTES = "fine";
    expect(slotStepMinutes()).toBe(15);
  });

  it("defaults when the value is below the 5-minute floor", () => {
    process.env.APPOINTMENT_SLOT_STEP_MINUTES = "4";
    expect(slotStepMinutes()).toBe(15);
  });

  it("floors a fractional configured value", () => {
    process.env.APPOINTMENT_SLOT_STEP_MINUTES = "20.7";
    expect(slotStepMinutes()).toBe(20);
  });
});
