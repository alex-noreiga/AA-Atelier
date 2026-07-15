// Builds the Notion page representation of a new order: the page `properties`
// (title + order number) and the `children` block array (contact, measurement,
// and dress-detail sections). Kept separate from the HTTP/Notion request layer
// so the domain-field -> Notion-block mapping is independently testable.

import {
  ORDER_NAME_PROPERTY,
  ORDER_NUMBER_PROPERTY,
  ORDER_EMAIL_PROPERTY,
  ORDER_CLIENT_PROPERTY,
  type CreateOrderInput,
} from "./schema.js";

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
      title: [{ text: { content: `${data.fullName} – Custom Dress` } }],
    },
    [ORDER_NUMBER_PROPERTY]: {
      rich_text: [{ text: { content: orderNumber } }],
    },
    // Also written as a property (not only in the Contact body block) so a
    // later measurement-change request can be verified against it server-side.
    [ORDER_EMAIL_PROPERTY]: {
      email: data.email,
    },
  };
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
  // atelier can tell the two apart at a glance.
  // TODO(measurements-b): to support self-service in-place editing, measurements
  // need to move from these body blocks to typed Notion page properties (number
  // + a unit select) so they can be read back and PATCHed. Approach A (the
  // change-request flow) leaves them here and lets the atelier apply changes.
  const providedMeasurements = data.waist !== undefined;
  const measurementSection = providedMeasurements
    ? [
        headingBlock(`Measurements (${data.measurementUnit})`),
        textBlock("Waist", String(data.waist)),
        textBlock("Bust", String(data.bust)),
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

  const dressSection: unknown[] = [headingBlock("Dress Details")];
  if (data.description) {
    dressSection.push(textBlock("Description", data.description));
  }
  if (data.neededBy) {
    const dateStr =
      data.neededBy instanceof Date
        ? data.neededBy.toISOString().split("T")[0]
        : String(data.neededBy);
    dressSection.push(textBlock("Needed By", dateStr));
  }
  dressSection.push(dividerBlock());

  return [...contactSection, ...measurementSection, ...dressSection];
}
