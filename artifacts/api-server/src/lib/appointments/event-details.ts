// Mapping a live Google Calendar appointment event to the DTO the contract
// exposes. Shared by the self-service manage flow (single event, by signed token)
// and the account portal's upcoming-appointments list (many events, by email), so
// the two can't disagree on how an event is read. The event is the source of
// truth — everything here comes off its `start`/`end`/`status` and the private
// `extendedProperties` stamped at booking (see `calendar.repository.ts`).

import {
  isAppointmentLocation,
  LOCATION_LABELS,
  type AppointmentLocation,
  type AppointmentTypeDef,
} from "./catalog.js";
import { resolveAppointmentType } from "./routing.js";
import { appointmentTimezone } from "./settings.js";
import {
  EVENT_PROP_TYPE,
  EVENT_PROP_LOCATION,
  EVENT_PROP_CONFIRMATION,
  type CalendarEventDetails,
} from "../google/calendar.repository.js";

/** The appointment's current state, shaped for the `AppointmentDetails` contract. */
export interface AppointmentManageDetails {
  status: "confirmed" | "cancelled";
  confirmationCode: string;
  typeId: string;
  typeName: string;
  staff: string;
  location: AppointmentLocation;
  locationLabel: string;
  start: Date;
  end: Date;
  timezone: string;
  meetingUrl?: string;
  canModify: boolean;
}

/** The catalog type an event was booked as, or undefined when it's unrecognizable
 * (a legacy event missing our extended properties). Callers decide whether that's
 * a hard error (manage a specific event) or a skip (list many). */
export function resolveEventType(
  event: CalendarEventDetails,
): AppointmentTypeDef | undefined {
  const typeId = event.extended[EVENT_PROP_TYPE];
  return typeId ? resolveAppointmentType(typeId) : undefined;
}

export function locationFromEvent(
  event: CalendarEventDetails,
): AppointmentLocation {
  const location = event.extended[EVENT_PROP_LOCATION];
  return location && isAppointmentLocation(location) ? location : "in-person";
}

/** Map a live event (with its already-resolved type + location) to the DTO. */
export function mapEventToDetails(
  event: CalendarEventDetails,
  staff: string,
  type: AppointmentTypeDef,
  location: AppointmentLocation,
): AppointmentManageDetails {
  const cancelled = event.status === "cancelled";
  const inFuture = event.start.getTime() > Date.now();
  return {
    status: cancelled ? "cancelled" : "confirmed",
    confirmationCode: event.extended[EVENT_PROP_CONFIRMATION] ?? "",
    typeId: type.id,
    typeName: type.name,
    staff,
    location,
    locationLabel: LOCATION_LABELS[location],
    start: event.start,
    end: event.end,
    timezone: appointmentTimezone(),
    ...(event.meetingUrl ? { meetingUrl: event.meetingUrl } : {}),
    canModify: !cancelled && inFuture,
  };
}

/** Map a live event to the DTO, or null when its type isn't recognizable — the
 * list view uses this to skip legacy events rather than erroring on them. */
export function eventToDetailsOrNull(
  event: CalendarEventDetails,
  staff: string,
): AppointmentManageDetails | null {
  const type = resolveEventType(event);
  if (!type) return null;
  return mapEventToDetails(event, staff, type, locationFromEvent(event));
}
