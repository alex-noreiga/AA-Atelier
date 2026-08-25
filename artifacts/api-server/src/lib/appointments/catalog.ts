// The bookable appointment-type catalog and its default staff routing.
//
// This is a *targeted business rule* deliberately encoded in code — like
// STATUS_IN_STOCK / MEASUREMENT_LOCK_FROM_STAGE — rather than read live. A
// type's duration drives the slot math, its locations and gates drive both the
// booking UI and the server-side validation, and retiring a type is a code
// change, so all of that is coupled here.
//
// Two things about a type are NOT settled here, and both for the same reason —
// they are operational facts the atelier changes without a deploy:
//
//   • WHEN each person works: the `staff_availability` table, edited under
//     /studio -> Working hours (see `lib/db/staff-availability.repository.ts`).
//   • WHICH TYPES each person offers: the `staff` list below is the built-in
//     DEFAULT, overridable per type from /studio -> Appointment staffing (see
//     `./routing.ts`). Read the routing through `resolveAppointmentTypes()`
//     rather than reaching for `APPOINTMENT_TYPES` directly, or the override is
//     silently ignored.
//
// The staff names below must match the `staff` column of the working-hours
// table: it is the key each person's booking-calendar email is looked up by.
// There is no Notion appointments database — a booking is a Google Calendar
// event.

export const APPOINTMENT_LOCATIONS = ["in-person", "virtual"] as const;
export type AppointmentLocation = (typeof APPOINTMENT_LOCATIONS)[number];

/** Human labels for each location id, used in UI copy and the calendar event. */
export const LOCATION_LABELS: Record<AppointmentLocation, string> = {
  "in-person": "In person",
  virtual: "Virtual",
};

/** Staff display names — the identity a customer picks, and the key their
 * working hours and booking calendar are stored under. */
export const STAFF = {
  alexandra: "Alexandra",
  alayna: "Alayna",
} as const;

/**
 * Everyone the studio books appointments with, in the order they are offered.
 *
 * This is the roster, and it is deliberately NOT derived from which types each
 * person currently offers. Routing is atelier-editable now, so a derived list
 * would drop somebody out of the working-hours editor the moment they were
 * unassigned from their last type — taking their existing hours with them, for
 * what is meant to be a reversible edit. Hiring is a code change; "who does
 * fittings this season" is not.
 */
export const STAFF_ROSTER: readonly string[] = Object.values(STAFF);

export interface AppointmentTypeDef {
  id: string;
  name: string;
  durationMinutes: number;
  description: string;
  /**
   * The staff who offer this type (a customer may also pick "no preference").
   *
   * The DEFAULT routing — the atelier can reassign it per type from the studio
   * dashboard, which is why every consumer should go through
   * `resolveAppointmentTypes()` in `./routing.ts` instead of reading this.
   */
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

// Default routing, per the atelier: consultations are Alayna only; fittings,
// design reviews, and general appointments can be booked with either Alexandra
// or Alayna. Fittings are in-person only. Everything but the `staff` lists is
// fixed here; those are what /studio -> Appointment staffing overrides.
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
