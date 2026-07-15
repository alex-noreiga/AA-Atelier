// The bookable appointment-type catalog and staff routing rules.
//
// This is a *targeted business rule* deliberately encoded in code — like
// STATUS_IN_STOCK / SIZED_CATEGORIES in the shop — rather than read live from
// Notion. Each type's duration drives the slot math, and its allowed staff and
// locations drive both the booking UI and the server-side validation, so they
// are coupled to code, not a free-floating option list. The atelier's actual
// *schedule* (which days and hours each person works) IS live-editable and
// lives in the Notion "Staff Availability" database — not here. Retune a
// duration or rename/retire a type here; changing when someone works is a
// Notion edit.
//
// The staff names below must match the "Staff" select option values used in the
// Notion Staff Availability and Appointments databases.

export const APPOINTMENT_LOCATIONS = ["in-person", "virtual"] as const;
export type AppointmentLocation = (typeof APPOINTMENT_LOCATIONS)[number];

/** Human labels for each location id, used in UI copy and the Notion row. */
export const LOCATION_LABELS: Record<AppointmentLocation, string> = {
  "in-person": "In person",
  virtual: "Virtual",
};

/** Staff display names — the identity a customer picks and the Notion value. */
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
}

// Routing rules, per the atelier: consultations are Alayna only; fittings,
// design reviews, and general appointments can be booked with either Alexandra
// or Alayna. Fittings are in-person only.
export const APPOINTMENT_TYPES: readonly AppointmentTypeDef[] = [
  {
    id: "consultation",
    name: "Consultation",
    durationMinutes: 30,
    description: "Talk through ideas for a new custom piece.",
    staff: [STAFF.alayna],
    locations: ["in-person", "virtual"],
  },
  {
    id: "fitting",
    name: "Fitting & Measurements",
    durationMinutes: 60,
    description:
      "Have your measurements taken or try your garment on in person.",
    staff: [STAFF.alexandra, STAFF.alayna],
    locations: ["in-person"],
  },
  {
    id: "design-review",
    name: "Design Review",
    durationMinutes: 45,
    description: "Review sketches, fabrics, and progress on your order.",
    staff: [STAFF.alexandra, STAFF.alayna],
    locations: ["in-person", "virtual"],
  },
  {
    id: "general",
    name: "General / Other",
    durationMinutes: 30,
    description: "Anything else — we'll help however we can.",
    staff: [STAFF.alexandra, STAFF.alayna],
    locations: ["in-person", "virtual"],
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
