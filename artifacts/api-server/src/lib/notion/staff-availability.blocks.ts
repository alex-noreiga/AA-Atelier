// Builds the Notion page properties for one block of staff working hours.
//
// One builder serves both writes: a create sends the whole entry, and so does an
// update (the dashboard's editor submits the complete row, not a patch), so the
// two paths can't drift into writing different shapes. There are no page-body
// blocks — a schedule row is entirely its properties, so unlike the order /
// review / contact writers this file has no `children` builder.

import {
  AVAILABILITY_STAFF_PROPERTY,
  AVAILABILITY_EMAIL_PROPERTY,
  AVAILABILITY_WEEKDAYS_PROPERTY,
  AVAILABILITY_START_PROPERTY,
  AVAILABILITY_END_PROPERTY,
  AVAILABILITY_LOCATIONS_PROPERTY,
} from "./staff-availability.schema.js";
import type { ScheduleEntry } from "../appointments/staff.js";

/** Multi-select options, as Notion wants them. Options are auto-created on
 * first write, so a new weekday or location needs nothing set up in Notion. */
function options(values: string[]) {
  return values.map((name) => ({ name }));
}

/**
 * The property payload for a staff-availability row. The values are already
 * validated by the service (a known staff name, `HH:MM` times that make a real
 * range, at least one weekday and location), so this only shapes them.
 */
export function buildStaffAvailabilityProperties(
  entry: ScheduleEntry,
): Record<string, unknown> {
  return {
    [AVAILABILITY_STAFF_PROPERTY]: {
      title: [{ text: { content: entry.staff } }],
    },
    [AVAILABILITY_EMAIL_PROPERTY]: { email: entry.email },
    [AVAILABILITY_WEEKDAYS_PROPERTY]: {
      multi_select: options(entry.weekdays),
    },
    [AVAILABILITY_START_PROPERTY]: {
      rich_text: [{ text: { content: entry.start } }],
    },
    [AVAILABILITY_END_PROPERTY]: {
      rich_text: [{ text: { content: entry.end } }],
    },
    [AVAILABILITY_LOCATIONS_PROPERTY]: {
      multi_select: options(entry.locations),
    },
  };
}
