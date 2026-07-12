// Builds the Notion page `properties` for a new contact message. Property
// *types* here must match the live "Website Contact Messages" schema, not the
// property name (see `.agents/memory/` and schema.ts for the same lesson on the
// orders database). Kept separate from the HTTP/Notion request layer so the
// domain-field -> Notion-property mapping is independently testable.

import type { z } from "zod";
import type { CreateContactMessageBody } from "@workspace/api-zod";

// Live-schema property names (a Notion rename is a one-line change here).
export const CONTACT_SUBJECT_PROPERTY = "Message (subject)"; // title
export const CONTACT_NAME_PROPERTY = "Customer name"; // rich_text
export const CONTACT_EMAIL_PROPERTY = "Email"; // email
export const CONTACT_PHONE_PROPERTY = "Phone"; // phone_number
export const CONTACT_MESSAGE_PROPERTY = "Message"; // rich_text
export const CONTACT_STAGE_PROPERTY = "Stage"; // select
export const CONTACT_DEFAULT_STAGE = "New";

/** Validated contact-message payload, derived from the OpenAPI contract. */
export type CreateContactInput = z.infer<typeof CreateContactMessageBody>;

/** Notion page `properties` for a new contact message. */
export function buildContactProperties(
  data: CreateContactInput,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [CONTACT_SUBJECT_PROPERTY]: {
      title: [{ text: { content: `${data.name} – Website inquiry` } }],
    },
    [CONTACT_NAME_PROPERTY]: {
      rich_text: [{ text: { content: data.name } }],
    },
    [CONTACT_EMAIL_PROPERTY]: {
      email: data.email,
    },
    [CONTACT_MESSAGE_PROPERTY]: {
      rich_text: [{ text: { content: data.message } }],
    },
    [CONTACT_STAGE_PROPERTY]: {
      select: { name: CONTACT_DEFAULT_STAGE },
    },
  };

  if (data.phone) {
    properties[CONTACT_PHONE_PROPERTY] = { phone_number: data.phone };
  }

  return properties;
}
