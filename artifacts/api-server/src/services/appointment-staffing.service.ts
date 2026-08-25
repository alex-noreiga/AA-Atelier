// The studio dashboard's appointment-staffing editor, HTTP-agnostic.
//
// Who performs which kind of appointment was, until now, four `staff:` arrays
// in `lib/appointments/catalog.ts` — a deploy to say that Alexandra is taking
// consultations this season, or that Alayna has stopped doing fittings. It is
// also the setting with the most invisible consequence in the whole booking
// stack: `computeSlots` only ever offers a type's routed staff, so getting it
// wrong doesn't raise anything, it just quietly stops offering times.
//
// The value itself lives in Studio Settings under `APPOINTMENT_STAFF_ROUTING`
// (see `lib/appointments/routing.ts` for the format and the read side), which
// means the atelier can also repair it in the Notion row and it needs no
// database, no migration and no setup of its own. This service is the typed
// surface over it, and it exists for the same reason the working-hours editor
// does: the raw row is free text, and free text about staffing fails silently.
//
// Four decisions are load-bearing:
//
//  1. **Every type must keep somebody on it.** A type with nobody routed to it
//     is a type that appears on the booking page and offers no times, ever —
//     the exact failure this panel is here to end. Retiring a type is a code
//     change (its duration, gates and copy live in the catalog); it is not
//     something to express by leaving it unstaffed. So an empty selection is
//     refused on the way in, even though the READ side tolerates one by falling
//     back to the catalog — the usual "`validate` may be stricter than
//     `accepts`" split.
//  2. **A person with no types is fine.** That is the ordinary way to say
//     somebody isn't taking appointments this season, and it costs nothing:
//     their working hours stay put (the roster, not the routing, is what that
//     editor offers) and their existing bookings stay reschedulable.
//  3. **Routing equal to the catalog's is stored as BLANK.** A blank value
//     reads as unset everywhere, so clearing is how the setting is handed back
//     to the built-in default — and it means a routing change shipped in a
//     future deploy still reaches an atelier who never differed from it, rather
//     than being pinned to whatever the defaults were the day somebody first
//     pressed Save.
//  4. **A partial submission is a partial override.** Only the types named are
//     written; the rest keep the staffing they already have. The panel sends
//     all four, so this only matters to a caller that doesn't.

import {
  APPOINTMENT_TYPES,
  STAFF_ROSTER,
  type AppointmentLocation,
} from "../lib/appointments/catalog.js";
import {
  STAFF_ROUTING_KEY,
  applyStaffRouting,
  formatStaffRouting,
  parseStaffRouting,
  staffRoutingValue,
} from "../lib/appointments/routing.js";
import {
  saveSetting,
  settingsConfigured,
} from "../lib/notion/settings.repository.js";
import { settingDefinition } from "../lib/settings/catalog.js";
import { BadRequestError, ConflictError } from "../lib/errors.js";

/** One appointment type as the panel shows it: what it is, who is on it now,
 * and who the code would put on it if nothing were set. */
export interface AppointmentStaffingType {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  locations: AppointmentLocation[];
  /** Who currently offers it — the value in force, override applied. */
  staff: string[];
  /** The catalog's built-in staffing, so the panel can show what a reset would
   * mean and mark a type the atelier has moved away from. */
  defaultStaff: string[];
  /** Set when this type only takes bookings against an existing order. */
  requiresOrder?: boolean;
}

export interface AppointmentStaffingView {
  /** False means there is no Studio Settings database to write to, so the
   * routing below is real but nothing here can be changed. Same shape as the
   * settings editor's own unconfigured state, rather than a Save with nowhere
   * to go. */
  configured: boolean;
  /** Everyone the studio books — the columns of the matrix. */
  staff: string[];
  types: AppointmentStaffingType[];
  /** True when the staffing in force is the catalog's, i.e. nothing is stored. */
  usingDefaults: boolean;
}

/** What the editor submits: the staffing for each type it wants to set. */
export interface AppointmentStaffingInput {
  types: Array<{ id: string; staff: string[] }>;
}

function toView(
  routing: ReadonlyMap<string, string[]>,
  configured: boolean,
): AppointmentStaffingView {
  const resolved = applyStaffRouting(APPOINTMENT_TYPES, routing);
  return {
    configured,
    staff: [...STAFF_ROSTER],
    usingDefaults: resolved.every(
      (type, index) =>
        type.staff.join(" ") === APPOINTMENT_TYPES[index].staff.join(" "),
    ),
    types: resolved.map((type, index) => ({
      id: type.id,
      name: type.name,
      description: type.description,
      durationMinutes: type.durationMinutes,
      locations: type.locations,
      staff: type.staff,
      defaultStaff: [...APPOINTMENT_TYPES[index].staff],
      ...(type.requiresOrder ? { requiresOrder: true } : {}),
    })),
  };
}

/** The staffing in force, per type, with the catalog's defaults alongside. */
export function getAppointmentStaffing(): AppointmentStaffingView {
  return toView(parseStaffRouting(staffRoutingValue()), settingsConfigured());
}

/**
 * Save the staffing. Refuses — rather than storing and then quietly ignoring —
 * an unknown type, a name off the roster, or a type left with nobody on it.
 */
export async function saveAppointmentStaffing(
  input: AppointmentStaffingInput,
): Promise<AppointmentStaffingView> {
  if (!settingsConfigured()) {
    throw new ConflictError(
      "There's no Studio Settings database connected, so appointment staffing can only be changed in the environment.",
    );
  }

  // Start from what is already in force, so a submission naming some of the
  // types leaves the others as they are rather than resetting them.
  const routing = new Map(parseStaffRouting(staffRoutingValue()));

  for (const entry of input.types) {
    const type = APPOINTMENT_TYPES.find((known) => known.id === entry.id);
    if (!type) {
      throw new BadRequestError(
        `"${entry.id}" isn't an appointment type we offer.`,
      );
    }

    const staff: string[] = [];
    for (const name of entry.staff) {
      const matched = STAFF_ROSTER.find(
        (known) => known.toLowerCase() === name.trim().toLowerCase(),
      );
      if (!matched) {
        throw new BadRequestError(
          `"${name}" isn't someone the studio books appointments with.`,
        );
      }
      if (!staff.includes(matched)) staff.push(matched);
    }

    if (staff.length === 0) {
      throw new BadRequestError(
        `Choose at least one person for ${type.name}. A type nobody is assigned to never offers a time, and never says why.`,
      );
    }
    routing.set(type.id, staff);
  }

  const view = toView(routing, true);
  // Decision 3: back to the catalog means back to unset, not pinned to it.
  await saveSetting(
    STAFF_ROUTING_KEY,
    view.usingDefaults ? "" : formatStaffRouting(routing),
    settingDefinition(STAFF_ROUTING_KEY)?.description ?? "",
  );

  return view;
}
