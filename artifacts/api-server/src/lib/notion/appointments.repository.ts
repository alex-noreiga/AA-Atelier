// Appointment persistence + booking lookup against the Notion "Appointments"
// database. Bookings are read fresh (no TTL cache) because availability and the
// final booking re-check must reflect the very latest state to avoid handing
// out an already-taken slot.

import { getAppointmentsNotionClient, type NotionClient } from "./client.js";
import {
  APPT_START_PROPERTY,
  APPT_STATUS_CANCELLED,
  APPT_STATUS_PROPERTY,
  buildAppointmentProperties,
  extractBookingEnd,
  extractBookingStaff,
  extractBookingStart,
  type BookedAppointment,
  type NotionAppointmentsQueryResponse,
} from "./appointments.blocks.js";
import type { Booking } from "../appointments/availability.js";

function assertConfigured(client: NotionClient): void {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_APPOINTMENTS_DATABASE_ID is not configured for the appointments database",
    );
  }
}

/**
 * All non-cancelled bookings whose start falls in `[from, to)`, as instant
 * ranges for overlap checks. A booking missing a start or end is skipped
 * (it can't constrain a slot).
 */
export async function listBookingsInRange(
  from: Date,
  to: Date,
  client: NotionClient = getAppointmentsNotionClient(),
): Promise<Booking[]> {
  assertConfigured(client);

  const bookings: Booking[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            and: [
              {
                property: APPT_START_PROPERTY,
                date: { on_or_after: from.toISOString() },
              },
              {
                property: APPT_START_PROPERTY,
                date: { before: to.toISOString() },
              },
              {
                property: APPT_STATUS_PROPERTY,
                select: { does_not_equal: APPT_STATUS_CANCELLED },
              },
            ],
          },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Notion appointments query failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as NotionAppointmentsQueryResponse;
    for (const page of data.results) {
      const start = extractBookingStart(page);
      const end = extractBookingEnd(page);
      const staff = extractBookingStaff(page);
      if (start && end && staff) {
        bookings.push({ staff, start, end });
      }
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return bookings;
}

/** Persist a booked appointment as a new Notion page. */
export async function createAppointment(
  appointment: BookedAppointment,
  title: string,
  client: NotionClient = getAppointmentsNotionClient(),
): Promise<void> {
  assertConfigured(client);

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: client.databaseId },
      properties: buildAppointmentProperties(appointment, title),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion appointment creation failed with status ${response.status}: ${errorText}`,
    );
  }
}
