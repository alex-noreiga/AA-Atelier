// Booking-policy settings, read at call time (not module load) so importing this
// needs no configuration and tests can vary the values. Each resolves from the
// live "Studio Settings" Notion row first, then the env var of the same name,
// then the built-in default — so the atelier can retune them in Notion without a
// redeploy (see lib/settings/store.ts), and an unconfigured settings DB behaves
// exactly as env-only did.
//
// - APPOINTMENT_TIMEZONE        IANA zone the atelier's hours/slots are in.
// - APPOINTMENT_MIN_LEAD_HOURS  how far ahead a slot must be to be bookable.
// - APPOINTMENT_MAX_ADVANCE_DAYS how far into the future booking is allowed.
// - APPOINTMENT_SLOT_STEP_MINUTES the grid slots snap to within working hours.
// - APPOINTMENT_REMINDER_LEAD_DAYS how many days ahead the reminder sweep looks.

import { settingValue } from "../settings/store.js";

const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_MIN_LEAD_HOURS = 24;
const DEFAULT_MAX_ADVANCE_DAYS = 45;
const DEFAULT_SLOT_STEP_MINUTES = 15;
const DEFAULT_REMINDER_LEAD_DAYS = 1;

export function appointmentTimezone(): string {
  return (
    (settingValue("APPOINTMENT_TIMEZONE") ??
      process.env.APPOINTMENT_TIMEZONE) ||
    DEFAULT_TIMEZONE
  );
}

export function minLeadMinutes(): number {
  const hours = Number(
    settingValue("APPOINTMENT_MIN_LEAD_HOURS") ??
      process.env.APPOINTMENT_MIN_LEAD_HOURS,
  );
  return Number.isFinite(hours) && hours >= 0
    ? hours * 60
    : DEFAULT_MIN_LEAD_HOURS * 60;
}

export function maxAdvanceDays(): number {
  const days = Number(
    settingValue("APPOINTMENT_MAX_ADVANCE_DAYS") ??
      process.env.APPOINTMENT_MAX_ADVANCE_DAYS,
  );
  return Number.isFinite(days) && days >= 1
    ? Math.floor(days)
    : DEFAULT_MAX_ADVANCE_DAYS;
}

export function slotStepMinutes(): number {
  const minutes = Number(
    settingValue("APPOINTMENT_SLOT_STEP_MINUTES") ??
      process.env.APPOINTMENT_SLOT_STEP_MINUTES,
  );
  return Number.isFinite(minutes) && minutes >= 5
    ? Math.floor(minutes)
    : DEFAULT_SLOT_STEP_MINUTES;
}

/**
 * How many local days ahead the appointment-reminder sweep looks. The default of
 * 1 is the "day before" reminder; 0 would reduce it to same-day only, so anything
 * below 1 falls back rather than quietly turning the feature into a morning-of
 * note. Raise it to give customers longer notice.
 */
export function reminderLeadDays(): number {
  const days = Number(
    settingValue("APPOINTMENT_REMINDER_LEAD_DAYS") ??
      process.env.APPOINTMENT_REMINDER_LEAD_DAYS,
  );
  return Number.isFinite(days) && days >= 1
    ? Math.floor(days)
    : DEFAULT_REMINDER_LEAD_DAYS;
}
