// Builds the Notion page `properties` for a booked appointment, and holds the
// "Appointments" database property-name constants + extraction used by the
// repository. Property *types* must match the live Notion schema (see the
// orders/contact schemas for the same lesson). Kept separate from the
// HTTP/Notion request layer so the domain→property mapping is unit-testable.

export const APPT_NAME_PROPERTY = "Name"; // title
export const APPT_CUSTOMER_PROPERTY = "Customer name"; // rich_text
export const APPT_EMAIL_PROPERTY = "Email"; // email
export const APPT_PHONE_PROPERTY = "Phone"; // phone_number
export const APPT_TYPE_PROPERTY = "Appointment type"; // select
export const APPT_STAFF_PROPERTY = "Staff"; // select
export const APPT_LOCATION_PROPERTY = "Location"; // select
export const APPT_START_PROPERTY = "Start"; // date (with time)
export const APPT_END_PROPERTY = "End"; // date (with time)
export const APPT_STATUS_PROPERTY = "Status"; // select
export const APPT_CODE_PROPERTY = "Confirmation code"; // rich_text
export const APPT_NOTES_PROPERTY = "Notes"; // rich_text
export const APPT_PREFERRED_CONTACT_PROPERTY = "Preferred contact"; // select

export const APPT_STATUS_BOOKED = "Booked";
export const APPT_STATUS_CANCELLED = "Cancelled";

/** A fully-resolved appointment ready to persist (times are UTC instants). */
export interface BookedAppointment {
  customerName: string;
  email: string;
  phone?: string;
  /** The appointment type's display name, e.g. "Consultation". */
  typeName: string;
  staff: string;
  /** Human location label, e.g. "In person". */
  locationLabel: string;
  start: Date;
  end: Date;
  confirmationCode: string;
  notes?: string;
  preferredContact?: string;
}

/** Notion page `properties` for a new appointment row. */
export function buildAppointmentProperties(
  appointment: BookedAppointment,
  title: string,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [APPT_NAME_PROPERTY]: {
      title: [{ text: { content: title } }],
    },
    [APPT_CUSTOMER_PROPERTY]: {
      rich_text: [{ text: { content: appointment.customerName } }],
    },
    [APPT_EMAIL_PROPERTY]: { email: appointment.email },
    [APPT_TYPE_PROPERTY]: { select: { name: appointment.typeName } },
    [APPT_STAFF_PROPERTY]: { select: { name: appointment.staff } },
    [APPT_LOCATION_PROPERTY]: { select: { name: appointment.locationLabel } },
    [APPT_START_PROPERTY]: { date: { start: appointment.start.toISOString() } },
    [APPT_END_PROPERTY]: { date: { start: appointment.end.toISOString() } },
    [APPT_STATUS_PROPERTY]: { select: { name: APPT_STATUS_BOOKED } },
    [APPT_CODE_PROPERTY]: {
      rich_text: [{ text: { content: appointment.confirmationCode } }],
    },
  };

  if (appointment.phone) {
    properties[APPT_PHONE_PROPERTY] = { phone_number: appointment.phone };
  }
  if (appointment.preferredContact) {
    properties[APPT_PREFERRED_CONTACT_PROPERTY] = {
      select: { name: appointment.preferredContact },
    };
  }
  if (appointment.notes) {
    properties[APPT_NOTES_PROPERTY] = {
      rich_text: [{ text: { content: appointment.notes } }],
    };
  }

  return properties;
}

// --- Reading existing bookings back (for availability + concurrency) ---------

interface NotionAppointmentPage {
  properties: Record<
    string,
    {
      select?: { name: string } | null;
      date?: { start: string; end: string | null } | null;
    }
  >;
}

export interface NotionAppointmentsQueryResponse {
  results: NotionAppointmentPage[];
  has_more: boolean;
  next_cursor: string | null;
}

export function extractBookingStaff(page: NotionAppointmentPage): string {
  return page.properties[APPT_STAFF_PROPERTY]?.select?.name ?? "";
}

export function extractBookingStart(page: NotionAppointmentPage): Date | null {
  const value = page.properties[APPT_START_PROPERTY]?.date?.start;
  return value ? new Date(value) : null;
}

export function extractBookingEnd(page: NotionAppointmentPage): Date | null {
  const value = page.properties[APPT_END_PROPERTY]?.date?.start;
  return value ? new Date(value) : null;
}
