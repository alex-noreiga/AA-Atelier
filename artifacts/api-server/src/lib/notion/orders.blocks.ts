// Builds the Notion page representation of a new order: the page `properties`
// (title + order number) and the `children` block array (contact, measurement,
// and dress-detail sections). Kept separate from the HTTP/Notion request layer
// so the domain-field -> Notion-block mapping is independently testable.

import {
  ORDER_NAME_PROPERTY,
  ORDER_NUMBER_PROPERTY,
  ORDER_EMAIL_PROPERTY,
  ORDER_CLIENT_PROPERTY,
  ORDER_DUE_DATE_PROPERTY,
  ORDER_RUSH_PROPERTY,
  ORDER_WAIST_PROPERTY,
  ORDER_BUST_PROPERTY,
  ORDER_HIPS_PROPERTY,
  ORDER_HEIGHT_PROPERTY,
  ORDER_BODY_GIRTH_PROPERTY,
  ORDER_MEASUREMENT_UNIT_PROPERTY,
  type CreateOrderInput,
} from "./orders.schema.js";
import { normalizeEmail } from "../email.js";

/** Format the customer's "needed by" value as a Notion date string
 * (`YYYY-MM-DD`). The contract coerces it to a `Date`, but we defend against a
 * raw string reaching the builder. */
function formatNeededBy(neededBy: NonNullable<CreateOrderInput["neededBy"]>) {
  return neededBy instanceof Date
    ? neededBy.toISOString().split("T")[0]
    : String(neededBy);
}

function textBlock(label: string, value: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: { content: `${label}: ` },
          annotations: { bold: true },
        },
        { type: "text", text: { content: value } },
      ],
    },
  };
}

function headingBlock(text: string) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}

function dividerBlock() {
  return { object: "block", type: "divider", divider: {} };
}

/** An image block backed by an already-uploaded Notion `file_upload` id (see
 * `file-uploads.repository.ts`). Notion renders it inline on the order page. */
function imageBlock(fileUploadId: string) {
  return {
    object: "block",
    type: "image",
    image: { type: "file_upload", file_upload: { id: fileUploadId } },
  };
}

/**
 * Notion page `properties` for a new order. When `clientPageId` is given (the
 * order flow upserted a Client CRM record for this customer), the order is
 * linked to it through the `Client` relation.
 */
export function buildOrderProperties(
  data: CreateOrderInput,
  orderNumber: string,
  clientPageId?: string,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [ORDER_NAME_PROPERTY]: {
      title: [{ text: { content: `${data.fullName} – Custom Costume` } }],
    },
    [ORDER_NUMBER_PROPERTY]: {
      rich_text: [{ text: { content: orderNumber } }],
    },
    // Also written as a property (not only in the Contact body block) so a
    // later measurement-change request can be verified against it server-side.
    [ORDER_EMAIL_PROPERTY]: {
      email: normalizeEmail(data.email),
    },
  };
  // The customer's "needed by" date is the atelier's target completion date, so
  // seed the `Due Date` property from it directly at intake. The atelier can
  // still adjust it in Notion; the milestone-reconciliation cron then picks the
  // order up (see schedule.service.ts).
  if (data.neededBy) {
    properties[ORDER_DUE_DATE_PROPERTY] = {
      date: { start: formatNeededBy(data.neededBy) },
    };
  }
  // A confirmed rush order — flag it so the atelier prices the surcharge into
  // the invoice. Only written when true (Notion leaves an unset checkbox false).
  if (data.rush) {
    properties[ORDER_RUSH_PROPERTY] = { checkbox: true };
  }
  // Measurements as typed properties (mirrors the page-body block section below),
  // so the account portal can read them back — the resolution of the old
  // TODO(measurements-b). Written only when the customer supplied values now (the
  // intake requires all five together); a measure-at-fitting order leaves them
  // unset. `bust` maps to the "Chest" property.
  if (data.waist !== undefined) {
    properties[ORDER_WAIST_PROPERTY] = { number: data.waist };
    properties[ORDER_BUST_PROPERTY] = { number: data.bust };
    properties[ORDER_HIPS_PROPERTY] = { number: data.hips };
    properties[ORDER_HEIGHT_PROPERTY] = { number: data.height };
    properties[ORDER_BODY_GIRTH_PROPERTY] = { number: data.bodyGirth };
    properties[ORDER_MEASUREMENT_UNIT_PROPERTY] = {
      select: { name: data.measurementUnit },
    };
  }
  if (clientPageId) {
    properties[ORDER_CLIENT_PROPERTY] = {
      relation: [{ id: clientPageId }],
    };
  }
  return properties;
}

/** Notion page body (`children`) blocks for a new order. */
export function buildOrderPageBlocks(data: CreateOrderInput): unknown[] {
  const contactSection = [
    headingBlock("Contact Information"),
    textBlock("Full Name", data.fullName),
    textBlock("Email", data.email),
    textBlock("Phone", data.phone),
    textBlock("Preferred Contact", data.preferredContact),
    dividerBlock(),
  ];

  // Measurements are optional: the customer either provided them, or asked to
  // have them taken at a fitting/consultation. Render whichever applies so the
  // atelier can tell the two apart at a glance. These body blocks are the
  // atelier's readable page view; the same values are also written as typed
  // properties in `buildOrderProperties` (the read source for the account portal),
  // both from this one intake payload so they can't drift. In-place editing still
  // goes through the measurement-change request flow (Approach A) for now.
  const providedMeasurements = data.waist !== undefined;
  const measurementSection = providedMeasurements
    ? [
        headingBlock(`Measurements (${data.measurementUnit})`),
        textBlock("Waist", String(data.waist)),
        textBlock("Chest", String(data.bust)),
        textBlock("Hips", String(data.hips)),
        textBlock("Height", String(data.height)),
        textBlock("Body Girth", String(data.bodyGirth)),
        dividerBlock(),
      ]
    : [
        headingBlock("Measurements"),
        textBlock(
          "Status",
          "To be taken at a scheduled fitting or consultation appointment.",
        ),
        dividerBlock(),
      ];

  const costumeSection: unknown[] = [headingBlock("Costume Details")];
  if (data.description) {
    costumeSection.push(textBlock("Description", data.description));
  }
  if (data.neededBy) {
    costumeSection.push(textBlock("Needed By", formatNeededBy(data.neededBy)));
  }
  // Surface a confirmed rush order in the page body too, so the atelier sees it
  // at a glance alongside the due date and knows to add the rush surcharge.
  if (data.rush) {
    costumeSection.push(
      textBlock("Rush Order", "Yes — rush surcharge applies"),
    );
  }
  costumeSection.push(dividerBlock());

  // Customer-uploaded reference / inspiration images, attached as inline image
  // blocks by their Notion file_upload id (uploaded ahead of order-create via
  // POST /orders/reference-images). Omitted entirely when none were uploaded.
  const referenceSection: unknown[] =
    data.referenceImageIds && data.referenceImageIds.length > 0
      ? [
          headingBlock("Reference Images"),
          ...data.referenceImageIds.map(imageBlock),
          dividerBlock(),
        ]
      : [];

  return [
    ...contactSection,
    ...measurementSection,
    ...costumeSection,
    ...referenceSection,
  ];
}
