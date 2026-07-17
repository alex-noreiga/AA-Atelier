// Builds the Notion page `properties` for a back-in-stock request. These land
// in the SAME "Website Contact Messages" database as contact-form messages —
// they're both "a customer wants something from us", and one inbox beats two.
// The "Request type" select is what tells them apart (and drives a filtered
// view in Notion); "Item"/"Size" carry the piece being waited on as real
// properties rather than free text.
//
// Property *types* here must match the live schema, not the property name (see
// `.agents/memory/` and schema.ts for the same lesson on the orders database).

import type { z } from "zod";
import type { CreateBackInStockRequestBody } from "@workspace/api-zod";
import {
  CONTACT_DEFAULT_STAGE,
  CONTACT_EMAIL_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_SUBJECT_PROPERTY,
  contactClientRelation,
} from "./contact.blocks.js";

// Live-schema property names (a Notion rename is a one-line change here). The
// shared ones are imported from contact.blocks so the two writers to this
// database can't drift apart.
export const NOTIFY_TYPE_PROPERTY = "Request type"; // select
export const NOTIFY_ITEM_PROPERTY = "Item"; // rich_text
export const NOTIFY_SIZE_PROPERTY = "Size"; // rich_text

/** The "Request type" value that marks a row as a back-in-stock request. */
export const NOTIFY_REQUEST_TYPE = "Back in stock";

/** Validated back-in-stock payload, derived from the OpenAPI contract. */
export type CreateNotifyInput = z.infer<typeof CreateBackInStockRequestBody>;

/**
 * Notion page `properties` for a new back-in-stock request. When `clientPageId`
 * is given, the request is linked to the customer's Client CRM record via the
 * shared `Client` relation.
 */
export function buildNotifyProperties(
  data: CreateNotifyInput,
  clientPageId?: string,
): Record<string, unknown> {
  // The subject names the exact piece, so the inbox row reads on its own.
  const subject = data.size
    ? `Back in stock: ${data.item} — ${data.size}`
    : `Back in stock: ${data.item}`;

  const properties: Record<string, unknown> = {
    [CONTACT_SUBJECT_PROPERTY]: {
      title: [{ text: { content: subject } }],
    },
    [CONTACT_EMAIL_PROPERTY]: {
      email: data.email,
    },
    [CONTACT_STAGE_PROPERTY]: {
      select: { name: CONTACT_DEFAULT_STAGE },
    },
    [NOTIFY_TYPE_PROPERTY]: {
      select: { name: NOTIFY_REQUEST_TYPE },
    },
    [NOTIFY_ITEM_PROPERTY]: {
      rich_text: [{ text: { content: data.item } }],
    },
    ...contactClientRelation(clientPageId),
  };

  // Absent when the whole variant is sold out rather than one size band.
  if (data.size) {
    properties[NOTIFY_SIZE_PROPERTY] = {
      rich_text: [{ text: { content: data.size } }],
    };
  }

  return properties;
}
