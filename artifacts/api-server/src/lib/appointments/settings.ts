// Booking-policy settings, read from the environment at call time (not module
// load) so importing this needs no configuration and tests can vary the values.
//
// - APPOINTMENT_TIMEZONE        IANA zone the atelier's hours/slots are in.
// - APPOINTMENT_MIN_LEAD_HOURS  how far ahead a slot must be to be bookable.
// - APPOINTMENT_MAX_ADVANCE_DAYS how far into the future booking is allowed.
// - APPOINTMENT_SLOT_STEP_MINUTES the grid slots snap to within working hours.

const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_MIN_LEAD_HOURS = 24;
const DEFAULT_MAX_ADVANCE_DAYS = 45;
const DEFAULT_SLOT_STEP_MINUTES = 15;

export function appointmentTimezone(): string {
  return process.env.APPOINTMENT_TIMEZONE || DEFAULT_TIMEZONE;
}

export function minLeadMinutes(): number {
  const hours = Number(process.env.APPOINTMENT_MIN_LEAD_HOURS);
  return Number.isFinite(hours) && hours >= 0
    ? hours * 60
    : DEFAULT_MIN_LEAD_HOURS * 60;
}

export function maxAdvanceDays(): number {
  const days = Number(process.env.APPOINTMENT_MAX_ADVANCE_DAYS);
  return Number.isFinite(days) && days >= 1
    ? Math.floor(days)
    : DEFAULT_MAX_ADVANCE_DAYS;
}

export function slotStepMinutes(): number {
  const minutes = Number(process.env.APPOINTMENT_SLOT_STEP_MINUTES);
  return Number.isFinite(minutes) && minutes >= 5
    ? Math.floor(minutes)
    : DEFAULT_SLOT_STEP_MINUTES;
}
