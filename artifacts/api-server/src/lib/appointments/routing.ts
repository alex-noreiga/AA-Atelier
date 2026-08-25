// Which staff member offers which appointment type — the one part of the
// booking catalog the atelier edits themselves.
//
// The catalog next door settles what a type IS: how long it runs, where it can
// be held, whether it needs an order behind it. Those are coupled to code. Who
// performs it is not: it changes when somebody is away for a season, when a new
// skill is handed over, or when one person simply stops doing consultations —
// none of which is worth a deploy, and all of which were previously a `staff:`
// array edit in `catalog.ts`.
//
// So the routing resolves the way every other atelier-editable tunable does —
// **Notion → env → the catalog's built-in default** (`settingValue(KEY) ??
// process.env[KEY]`, then parse) — under the key `APPOINTMENT_STAFF_ROUTING`.
// The stored form is one line a person can read and repair by hand:
//
//     consultation: Alayna; fitting: Alexandra, Alayna
//
// Three properties are load-bearing, and all three point the same way — a value
// that can't be understood must never make a type LESS bookable than the
// catalog says, because a type nobody is routed to has no slots at all and says
// nothing about why:
//
//  1. **The override is sparse.** A type the value doesn't mention keeps its
//     catalog staff. So a hand-typed line naming one type retunes that type and
//     leaves the rest alone, rather than silently unstaffing them.
//  2. **A type whose names are all unrecognizable keeps its default.** A typo
//     ("fitting: Alexandre") is a mistake, not an instruction to stop offering
//     fittings, so it degrades to the catalog rather than to nothing.
//  3. **Names resolve against the roster, loosely.** "alexandra" and
//     "Alexandra " are the same person; a name outside the roster is dropped,
//     because nobody outside it has working hours or a booking calendar and a
//     slot offered against them could never be honoured.
//
// The dashboard editor (`services/appointment-staffing.service.ts`) is stricter
// on the way in, the usual `accepts`-mirrors-the-getter / `validate`-may-be-
// stricter split: it refuses to SAVE a type with nobody on it, while a stored
// value that ends up that way is read as "no override".

import {
  APPOINTMENT_TYPES,
  STAFF_ROSTER,
  type AppointmentTypeDef,
} from "./catalog.js";
import { settingValue } from "../settings/store.js";

/** The Studio Settings key and env var name — identical, as everywhere else. */
export const STAFF_ROUTING_KEY = "APPOINTMENT_STAFF_ROUTING";

/** Fold a name or type id to its comparable form, so spacing, case and
 * punctuation aren't filing decisions. Same trick as `resolveGuideSection`. */
function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Resolve one written name to the roster spelling, or null if it isn't one of
 * the studio's people. */
function matchStaff(value: string, roster: readonly string[]): string | null {
  const wanted = fold(value);
  if (!wanted) return null;
  return roster.find((name) => fold(name) === wanted) ?? null;
}

/** Resolve one written type reference — its id or its display name — to a type
 * id, or null. */
function matchType(
  value: string,
  types: readonly AppointmentTypeDef[],
): string | null {
  const wanted = fold(value);
  if (!wanted) return null;
  const match = types.find(
    (type) => fold(type.id) === wanted || fold(type.name) === wanted,
  );
  return match?.id ?? null;
}

/**
 * Read `consultation: Alayna; fitting: Alexandra, Alayna` into a type id →
 * staff map.
 *
 * Entries are separated by `;` or a newline, each one `<type>: <names>`. Every
 * unreadable part is dropped rather than failing the parse: an unknown type id,
 * an unknown name, an entry with no colon, an entry whose names all fail to
 * resolve. What survives is an override; what doesn't leaves the catalog alone.
 */
export function parseStaffRouting(
  raw: string | undefined,
  types: readonly AppointmentTypeDef[] = APPOINTMENT_TYPES,
  roster: readonly string[] = STAFF_ROSTER,
): Map<string, string[]> {
  const routing = new Map<string, string[]>();
  if (!raw) return routing;

  for (const entry of raw.split(/[;\n]/)) {
    const separator = entry.indexOf(":");
    if (separator === -1) continue;

    const typeId = matchType(entry.slice(0, separator), types);
    if (!typeId) continue;

    const staff: string[] = [];
    for (const name of entry.slice(separator + 1).split(",")) {
      const matched = matchStaff(name, roster);
      if (matched && !staff.includes(matched)) staff.push(matched);
    }
    // Property 2: an entry that resolved to nobody is a mistake, not a decision
    // to stop offering the type. Leaving it out of the map is what hands it
    // back to the catalog default.
    if (staff.length > 0) routing.set(typeId, staff);
  }

  return routing;
}

/**
 * Why a written routing value can't be saved, or null when it can.
 *
 * The write guard, and deliberately stricter than the read above: reading drops
 * whatever it can't understand so a typo costs one type its override, while
 * saving a line with a misspelt name in it should say so rather than quietly
 * store half of what was meant. (The same `accepts` mirrors the getter /
 * `validate` may be stricter split every other setting uses.)
 */
export function staffRoutingProblem(raw: string): string | null {
  const entries = raw
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (entries.length === 0) {
    return 'Name at least one appointment type, like "consultation: Alayna".';
  }

  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator === -1) {
      return `"${entry}" needs to read like "consultation: Alayna".`;
    }

    const written = entry.slice(0, separator).trim();
    const typeId = matchType(written, APPOINTMENT_TYPES);
    if (!typeId) {
      return `"${written}" isn't an appointment type we offer.`;
    }

    const names = entry
      .slice(separator + 1)
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    if (names.length === 0) {
      return `Name at least one person for "${typeId}" — a type nobody is assigned to never offers a time.`;
    }
    for (const name of names) {
      if (!matchStaff(name, STAFF_ROSTER)) {
        return `"${name}" isn't someone the studio books appointments with.`;
      }
    }
  }

  return null;
}

/** Write a routing map back out in the form `parseStaffRouting` reads, and a
 * person can edit in the Notion row. */
export function formatStaffRouting(
  routing: ReadonlyMap<string, string[]>,
  types: readonly AppointmentTypeDef[] = APPOINTMENT_TYPES,
): string {
  return types
    .filter((type) => (routing.get(type.id)?.length ?? 0) > 0)
    .map((type) => `${type.id}: ${routing.get(type.id)!.join(", ")}`)
    .join("; ");
}

/** Apply a routing map over the catalog, leaving every unmentioned type alone. */
export function applyStaffRouting(
  types: readonly AppointmentTypeDef[],
  routing: ReadonlyMap<string, string[]>,
): AppointmentTypeDef[] {
  return types.map((type) => {
    const staff = routing.get(type.id);
    return staff && staff.length > 0
      ? { ...type, staff: [...staff] }
      : { ...type };
  });
}

/** The configured routing value, or undefined when nothing overrides the
 * catalog. Mirrors every other setting getter's Notion-then-env order. */
export function staffRoutingValue(): string | undefined {
  const raw = (
    settingValue(STAFF_ROUTING_KEY) ??
    process.env[STAFF_ROUTING_KEY] ??
    ""
  ).trim();
  return raw ? raw : undefined;
}

/** The bookable types with the atelier's staffing applied — what every
 * scheduling path should read instead of `APPOINTMENT_TYPES`. */
export function resolveAppointmentTypes(): AppointmentTypeDef[] {
  return applyStaffRouting(
    APPOINTMENT_TYPES,
    parseStaffRouting(staffRoutingValue()),
  );
}

/** One resolved type by id, or undefined when the id isn't one we offer. */
export function resolveAppointmentType(
  id: string,
): AppointmentTypeDef | undefined {
  return resolveAppointmentTypes().find((type) => type.id === id);
}

/**
 * The type as it applies to somebody who already holds a booking for it.
 *
 * A reschedule re-runs the very same slot computation as a fresh booking, and
 * `computeSlots` only ever offers a type's routed staff. Without this, taking
 * a person off a type would strand every appointment already in their diary:
 * the customer's manage link would find no times and say "that time is no
 * longer available", which is both unhelpful and untrue. Moving an existing
 * booking is not the same act as taking a new one, so the person who holds it
 * stays eligible for it.
 */
export function withBookedStaff(
  type: AppointmentTypeDef,
  staff: string,
): AppointmentTypeDef {
  return type.staff.includes(staff)
    ? type
    : { ...type, staff: [...type.staff, staff] };
}
