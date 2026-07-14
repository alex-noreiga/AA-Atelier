// Builds the Notion page `properties` for a measurement-change request. Like
// back-in-stock requests, these land in the SAME "Website Contact Messages"
// database — one inbox for "a customer wants something from us" — and the
// "Request type" select ("Measurement update") is what tells them apart and
// drives a filtered view in Notion. This endpoint never edits the order itself;
// the atelier reads the request and applies the change by hand (Approach A).
//
// Property *types* here must match the live schema, not the property name (see
// `.agents/memory/` and schema.ts). The shared property names are imported from
// contact.blocks so the writers to this database can't drift apart.
//
// TODO(measurements-b): a self-service direct edit would instead PATCH the order
// page's measurement properties in place; this request-inbox row is Approach A.

import type { z } from "zod";
import type { CreateMeasurementChangeRequestBody } from "@workspace/api-zod";
import {
  CONTACT_DEFAULT_STAGE,
  CONTACT_EMAIL_PROPERTY,
  CONTACT_MESSAGE_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_SUBJECT_PROPERTY,
  CONTACT_TYPE_PROPERTY,
} from "./contact.blocks.js";

/** The "Request type" value that marks a row as a measurement-change request. */
export const MEASUREMENT_CHANGE_REQUEST_TYPE = "Measurement update";

/** Validated measurement-change payload, derived from the OpenAPI contract. */
export type CreateMeasurementChangeInput = z.infer<
  typeof CreateMeasurementChangeRequestBody
>;

/** Everything the inbox row needs: the request plus the order it targets and
 * whether we could verify the requester's email against the order. */
export interface MeasurementChangeRow {
  orderNumber: string;
  emailVerified: boolean;
  request: CreateMeasurementChangeInput;
}

function buildMessageBody(row: MeasurementChangeRow): string {
  const { orderNumber, emailVerified, request } = row;
  // The customer either sent new values or asked to be re-measured; render
  // whichever applies so the atelier knows what to act on.
  const measurementLines = request.measurementAppointment
    ? ["Requested: re-measurement at a fitting or consultation appointment."]
    : [
        `Requested measurements (${request.measurementUnit}):`,
        `Waist: ${request.waist}`,
        `Bust: ${request.bust}`,
        `Hips: ${request.hips}`,
        `Height: ${request.height}`,
        `Body Girth: ${request.bodyGirth}`,
      ];
  const lines = [
    `Measurement change requested for order ${orderNumber}.`,
    "",
    ...measurementLines,
    "",
    `Note: ${request.note?.trim() ? request.note.trim() : "—"}`,
    // Legacy orders have no stored email to check against; the atelier should
    // confirm the requester before applying an unverified change.
    `Email verified: ${emailVerified ? "yes" : "no (confirm requester)"} (${request.email})`,
  ];
  return lines.join("\n");
}

/** Notion page `properties` for a new measurement-change request. */
export function buildMeasurementChangeProperties(
  row: MeasurementChangeRow,
): Record<string, unknown> {
  return {
    [CONTACT_SUBJECT_PROPERTY]: {
      title: [{ text: { content: `Measurement update: ${row.orderNumber}` } }],
    },
    [CONTACT_EMAIL_PROPERTY]: {
      email: row.request.email,
    },
    [CONTACT_STAGE_PROPERTY]: {
      select: { name: CONTACT_DEFAULT_STAGE },
    },
    [CONTACT_TYPE_PROPERTY]: {
      select: { name: MEASUREMENT_CHANGE_REQUEST_TYPE },
    },
    [CONTACT_MESSAGE_PROPERTY]: {
      rich_text: [{ text: { content: buildMessageBody(row) } }],
    },
  };
}
