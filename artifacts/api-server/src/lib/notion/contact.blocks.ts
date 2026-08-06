// Builds the Notion page `properties` for a new contact message. Property
// *types* here must match the live "Website Contact Messages" schema, not the
// property name (see `.agents/memory/` and schema.ts for the same lesson on the
// orders database). Kept separate from the HTTP/Notion request layer so the
// domain-field -> Notion-property mapping is independently testable.

import type { z } from "zod";
import type { CreateContactMessageBody } from "@workspace/api-zod";
import { normalizeEmail } from "../email.js";

// Live-schema property names (a Notion rename is a one-line change here). The
// exported ones are shared with `notify.blocks.ts`: the shop's back-in-stock
// requests land in this same database, so the two writers must agree on the
// property names. "Request type" is what separates them in the inbox.
export const CONTACT_SUBJECT_PROPERTY = "Message (subject)"; // title
const CONTACT_NAME_PROPERTY = "Customer name"; // rich_text
export const CONTACT_EMAIL_PROPERTY = "Email"; // email
const CONTACT_PHONE_PROPERTY = "Phone"; // phone_number
export const CONTACT_MESSAGE_PROPERTY = "Message"; // rich_text
export const CONTACT_STAGE_PROPERTY = "Stage"; // select
export const CONTACT_DEFAULT_STAGE = "New";
export const CONTACT_TYPE_PROPERTY = "Request type"; // select
const CONTACT_REQUEST_TYPE = "Inquiry";
// Relation to the Client CRM database. Shared by all three writers to this
// database (like CONTACT_EMAIL_PROPERTY) so the row links to the canonical
// customer record instead of only re-typing name/email as free text.
export const CONTACT_CLIENT_PROPERTY = "Client"; // relation -> Client CRM
// Relations to the order a request concerns, so the atelier can click straight
// through from the inbox to the order (and the order can roll up its own open
// requests). Two properties because a Notion relation targets one database: a
// custom-order request (measurement change / custom cancellation) links `Order`
// -> Custom Orders, a shop-order request (return / shop cancellation) links
// `Shop Order` -> shop orders. Shared by the contact-inbox writers, like
// CONTACT_CLIENT_PROPERTY, so they can't drift.
export const CONTACT_ORDER_PROPERTY = "Order"; // relation -> Custom Orders
export const CONTACT_SHOP_ORDER_PROPERTY = "Shop Order"; // relation -> shop orders

/**
 * The `Client` relation property for a contact-message row, or `{}` when no CRM
 * client was resolved (CRM unconfigured, or the upsert failed / was skipped).
 * Spread into any of the three writers' properties so they can't drift.
 */
export function contactClientRelation(
  clientPageId?: string,
): Record<string, unknown> {
  return clientPageId
    ? { [CONTACT_CLIENT_PROPERTY]: { relation: [{ id: clientPageId }] } }
    : {};
}

/**
 * The order relation for a contact-message row — `Order` for a custom order,
 * `Shop Order` for a shop order — or `{}` when no order page id was supplied
 * (the `NOTION_RELATION_LINKS` gate is off, or the relation properties don't
 * exist yet). Spread into a writer's properties like {@link contactClientRelation}.
 */
export function contactOrderRelation(
  orderType: "custom" | "shop",
  orderPageId?: string,
): Record<string, unknown> {
  if (!orderPageId) return {};
  const property =
    orderType === "shop" ? CONTACT_SHOP_ORDER_PROPERTY : CONTACT_ORDER_PROPERTY;
  return { [property]: { relation: [{ id: orderPageId }] } };
}

/** The "Email verified: …" body line shared by the order-scoped contact writers
 * (cancellation / measurement-change / return). A legacy order with no stored
 * email reads "no (confirm requester)", the atelier's cue to vet the requester. */
export function emailVerifiedLine(verified: boolean, email: string): string {
  return `Email verified: ${verified ? "yes" : "no (confirm requester)"} (${email})`;
}

/** Validated contact-message payload, derived from the OpenAPI contract. */
export type CreateContactInput = z.infer<typeof CreateContactMessageBody>;

/**
 * Notion page `properties` for a new contact message. When `clientPageId` is
 * given (the contact flow upserted a Client CRM record for this email), the
 * message is linked to it through the `Client` relation.
 */
export function buildContactProperties(
  data: CreateContactInput,
  clientPageId?: string,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [CONTACT_SUBJECT_PROPERTY]: {
      title: [{ text: { content: `${data.name} – Website inquiry` } }],
    },
    [CONTACT_NAME_PROPERTY]: {
      rich_text: [{ text: { content: data.name } }],
    },
    [CONTACT_EMAIL_PROPERTY]: {
      email: normalizeEmail(data.email),
    },
    [CONTACT_MESSAGE_PROPERTY]: {
      rich_text: [{ text: { content: data.message } }],
    },
    [CONTACT_STAGE_PROPERTY]: {
      select: { name: CONTACT_DEFAULT_STAGE },
    },
    [CONTACT_TYPE_PROPERTY]: {
      select: { name: CONTACT_REQUEST_TYPE },
    },
    ...contactClientRelation(clientPageId),
  };

  if (data.phone) {
    properties[CONTACT_PHONE_PROPERTY] = { phone_number: data.phone };
  }

  return properties;
}
