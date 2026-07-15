// Links a website order into the "Order Form Submissions" hub — the Notion
// intake row that ties an order to the atelier's back office (costing, invoicing,
// production schedule, materials, design). Called best-effort from the order flow
// so a website order lands in the same hub the atelier builds manual orders in,
// instead of being orphaned in the Order Tracking Pipeline with only a CRM link.
//
// The hub database id comes from the optional
// `NOTION_ORDER_FORM_SUBMISSIONS_DATABASE_ID`. When it's unset the client's
// `databaseId` is empty and this returns null (the caller then just skips
// linking), so the order flow is unchanged until the env var is configured.

import {
  getOrderFormSubmissionsNotionClient,
  type NotionClient,
} from "./client.js";
import type { CreateOrderInput } from "./orders.schema.js";

// Live-schema property names on the "Order Form Submissions" database (a Notion
// rename is a one-line change here). The description prompt is the literal
// question text the atelier's Notion form asks.
export const SUBMISSION_NAME_PROPERTY = "Name"; // title
export const SUBMISSION_EMAIL_PROPERTY = "Email"; // email
export const SUBMISSION_PHONE_PROPERTY = "Phone Number"; // phone_number
export const SUBMISSION_MEASUREMENTS_PROPERTY = "Measurements"; // rich_text
export const SUBMISSION_DESCRIPTION_PROPERTY =
  "Please describe what you want your custom dress to look like"; // rich_text
export const SUBMISSION_TARGET_DATE_PROPERTY = "Target Date"; // date
// The customer's uploaded reference images/videos (Vercel Blob URLs), stored as
// external files on the hub row's file property.
export const SUBMISSION_ATTACHMENTS_PROPERTY =
  "Please attach any images/video references you have for your dress"; // files
// The relation back to the order in the Order Tracking Pipeline — the link that
// anchors this hub row to the created order.
export const SUBMISSION_ORDER_RELATION_PROPERTY = "Order Tracking Pipeline"; // relation → orders

/** A human-readable name for a Blob-hosted reference file, from its URL. */
export function referenceFileName(url: string, index: number): string {
  try {
    const last = new URL(url).pathname.split("/").pop();
    return last ? decodeURIComponent(last) : `Reference ${index + 1}`;
  } catch {
    return `Reference ${index + 1}`;
  }
}

/**
 * A one-line measurements summary for the hub row: the five body measurements
 * with their unit when the customer supplied them, or a note that they'll be
 * taken at a fitting when they asked for an appointment instead. Undefined when
 * neither applies (nothing to record).
 */
function formatMeasurements(data: CreateOrderInput): string | undefined {
  if (typeof data.waist === "number") {
    return (
      `Waist ${data.waist}, Bust ${data.bust}, Hips ${data.hips}, ` +
      `Height ${data.height}, Body Girth ${data.bodyGirth} (${data.measurementUnit})`
    );
  }
  if (data.measurementAppointment) {
    return "To be taken at a scheduled fitting or consultation appointment.";
  }
  return undefined;
}

/** Notion `neededBy` (a date string or Date) as a Notion date `start` value. */
function toDateStart(neededBy: CreateOrderInput["neededBy"]): string {
  return neededBy instanceof Date
    ? (neededBy.toISOString().split("T")[0] as string)
    : String(neededBy);
}

/**
 * Create an "Order Form Submissions" hub row for a freshly-created website order
 * and link it to that order, returning the new submission's page id. Returns
 * null (a no-op) when the hub database isn't configured or no order page id was
 * given, so this is safe to call unconditionally from the order flow.
 */
export async function linkOrderFormSubmission(
  data: CreateOrderInput,
  orderPageId: string,
  client: NotionClient = getOrderFormSubmissionsNotionClient(),
): Promise<string | null> {
  if (!client.databaseId || !orderPageId) {
    return null;
  }

  const properties: Record<string, unknown> = {
    [SUBMISSION_NAME_PROPERTY]: {
      title: [{ text: { content: data.fullName } }],
    },
    [SUBMISSION_EMAIL_PROPERTY]: { email: data.email },
    [SUBMISSION_PHONE_PROPERTY]: { phone_number: data.phone },
    [SUBMISSION_ORDER_RELATION_PROPERTY]: {
      relation: [{ id: orderPageId }],
    },
  };

  const measurements = formatMeasurements(data);
  if (measurements) {
    properties[SUBMISSION_MEASUREMENTS_PROPERTY] = {
      rich_text: [{ text: { content: measurements } }],
    };
  }
  if (data.description) {
    properties[SUBMISSION_DESCRIPTION_PROPERTY] = {
      rich_text: [{ text: { content: data.description } }],
    };
  }
  if (data.neededBy) {
    properties[SUBMISSION_TARGET_DATE_PROPERTY] = {
      date: { start: toDateStart(data.neededBy) },
    };
  }
  if (data.imageUrls && data.imageUrls.length > 0) {
    properties[SUBMISSION_ATTACHMENTS_PROPERTY] = {
      files: data.imageUrls.map((url, i) => ({
        type: "external",
        name: referenceFileName(url, i),
        external: { url },
      })),
    };
  }

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: client.databaseId },
      properties,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion order-form-submission creation failed with status ${response.status}: ${errorText}`,
    );
  }

  const created = (await response.json()) as { id: string };
  return created.id;
}
