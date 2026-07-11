// Builds the Notion page representation of a new order: the page `properties`
// (title + order number) and the `children` block array (contact, measurement,
// and dress-detail sections). Kept separate from the HTTP/Notion request layer
// so the domain-field -> Notion-block mapping is independently testable.

import {
  ORDER_NAME_PROPERTY,
  ORDER_NUMBER_PROPERTY,
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

/** Notion page `properties` for a new order. */
export function buildOrderProperties(
  data: CreateOrderInput,
  orderNumber: string,
): Record<string, unknown> {
  return {
    [ORDER_NAME_PROPERTY]: {
      title: [{ text: { content: `${data.fullName} – Custom Dress` } }],
    },
    [ORDER_NUMBER_PROPERTY]: {
      rich_text: [{ text: { content: orderNumber } }],
    },
  };
}

/** Notion page body (`children`) blocks for a new order. */
export function buildOrderPageBlocks(data: CreateOrderInput): unknown[] {
  const unit = data.measurementUnit;

  const contactSection = [
    headingBlock("Contact Information"),
    textBlock("Full Name", data.fullName),
    textBlock("Email", data.email),
    textBlock("Phone", data.phone),
    textBlock("Preferred Contact", data.preferredContact),
    dividerBlock(),
  ];

  const measurementSection = [
    headingBlock(`Measurements (${unit})`),
    textBlock("Waist", String(data.waist)),
    textBlock("Bust", String(data.bust)),
    textBlock("Hips", String(data.hips)),
    textBlock("Height", String(data.height)),
    textBlock("Body Girth", String(data.bodyGirth)),
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
