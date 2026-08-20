// The bookable appointment-type catalog and staff routing rules.
//
// This is a *targeted business rule* deliberately encoded in code — like
// STATUS_IN_STOCK / MEASUREMENT_LOCK_FROM_STAGE — rather than read live. Each
// type's duration drives the slot math, and its allowed staff and locations
// drive both the booking UI and the server-side validation, so they are coupled
// to code, not a free-floating option list. The atelier's actual *schedule*
// (which days and hours each person works) IS live-editable and lives in the
// working-hours Google Sheet (`APPOINTMENT_SHEET_ID`, read by
// `lib/google/sheets.repository.ts`) — not here. Retune a duration or
// rename/retire a type here; changing when someone works is a sheet edit.
//
// The staff names below must match the "Staff" column in that sheet: it is the
// key `parseScheduleRows` maps to each person's booking-calendar email. There
// is no Notion appointments database — a booking is a Google Calendar event.

export const APPOINTMENT_LOCATIONS = ["in-person", "virtual"] as const;
export type AppointmentLocation = (typeof APPOINTMENT_LOCATIONS)[number];

/** Human labels for each location id, used in UI copy and the calendar event. */
export const LOCATION_LABELS: Record<AppointmentLocation, string> = {
  "in-person": "In person",
  virtual: "Virtual",
};

/** Staff display names — the identity a customer picks and the sheet's key. */
export const STAFF = {
  alexandra: "Alexandra",
  alayna: "Alayna",
} as const;

export interface AppointmentTypeDef {
  id: string;
  name: string;
  durationMinutes: number;
  description: string;
  /** The staff who offer this type (a customer may also pick "no preference"). */
  staff: string[];
  locations: AppointmentLocation[];
  /**
   * An *order gate*: this type may only be booked against an existing order.
   * The booking request must carry an `orderNumber` that resolves to a real
   * order whose stored email matches the booking email (verified server-side
   * via `findOrderVerification`, the same check the measurement-change and
   * review flows use). Set on the order-scoped types (fittings, design reviews)
   * so a stranger who doesn't yet have an order can't book them.
   */
  requiresOrder?: boolean;
  /**
   * A *funnel gate*: this type is the new-customer entry point (no order exists
   * yet), so instead of an order number the request must include a non-empty
   * `projectDetails` describing what they want made. A light screen that filters
   * out uncertain "what do you even do?" requests without turning away real
   * leads. Order-scoped types don't set this — the order is the context.
   */
  requiresProjectDetails?: boolean;
}

// Routing rules, per the atelier: consultations are Alayna only; fittings,
// design reviews, and general appointments can be booked with either Alexandra
// or Alayna. Fittings are in-person only.
//
// Gating: fittings and design reviews are order-scoped (`requiresOrder`) — they
// only make sense once someone has an order, so they're locked behind a verified
// order number. Consultations and general appointments are the new-customer
// funnel (`requiresProjectDetails`) — they can't require an order number (a new
// customer has none), so they ask for a short project description instead.
export const APPOINTMENT_TYPES: readonly AppointmentTypeDef[] = [
  {
    id: "consultation",
    name: "Consultation",
    durationMinutes: 30,
    description: "Talk through ideas for a new custom piece.",
    staff: [STAFF.alayna],
    locations: ["in-person", "virtual"],
    requiresProjectDetails: true,
  },
  {
    id: "fitting",
    name: "Fitting & Measurements",
    durationMinutes: 60,
    description:
      "Have your measurements taken or try your garment on in person.",
    staff: [STAFF.alexandra, STAFF.alayna],
    locations: ["in-person"],
    requiresOrder: true,
  },
  {
    id: "design-review",
    name: "Design Review",
    durationMinutes: 45,
    description: "Review sketches, fabrics, and progress on your order.",
    staff: [STAFF.alexandra, STAFF.alayna],
    locations: ["in-person", "virtual"],
    requiresOrder: true,
  },
  {
    id: "general",
    name: "General / Other",
    durationMinutes: 30,
    description: "Anything else — we'll help however we can.",
    staff: [STAFF.alexandra, STAFF.alayna],
    locations: ["in-person", "virtual"],
    requiresProjectDetails: true,
  },
];

export function getAppointmentType(id: string): AppointmentTypeDef | undefined {
  return APPOINTMENT_TYPES.find((type) => type.id === id);
}

export function isAppointmentLocation(
  value: string,
): value is AppointmentLocation {
  return (APPOINTMENT_LOCATIONS as readonly string[]).includes(value);
}
