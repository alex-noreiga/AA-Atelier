// Builds the Notion page `properties` for an order-cancellation request. Like
// back-in-stock and measurement-change requests, these land in the SAME
// "Website Contact Messages" database — one inbox for "a customer wants
// something from us" — and the "Request type" select ("Cancellation") is what
// tells them apart and drives a filtered view in Notion. This endpoint never
// refunds or edits the order; the atelier reviews the request and then processes
// the refund with the cancellation button (see order-cancellation.service.ts).
//
// Property *types* here must match the live schema, not the property name (see
// `.agents/memory/` and schema.ts). The shared property names are imported from
// contact.blocks so the writers to this database can't drift apart.

import {
  CONTACT_DEFAULT_STAGE,
  CONTACT_EMAIL_PROPERTY,
  CONTACT_MESSAGE_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_SUBJECT_PROPERTY,
  CONTACT_TYPE_PROPERTY,
  contactClientRelation,
} from "./contact.blocks.js";

/** The "Request type" value that marks a row as a cancellation request. */
export const CANCELLATION_REQUEST_TYPE = "Cancellation";

/** Which order flow a cancellation targets — custom (bespoke) or ready-to-wear
 * shop — surfaced in the inbox row so the atelier knows where to act. */
export type CancellationOrderType = "custom" | "shop";

/** Everything the inbox row needs: the request plus the order it targets, the
 * order type, and whether we could verify the requester's email. */
export interface CancellationRow {
  orderNumber: string;
  orderType: CancellationOrderType;
  emailVerified: boolean;
  email: string;
  reason?: string;
}

function orderTypeLabel(orderType: CancellationOrderType): string {
  return orderType === "shop" ? "Shop order" : "Custom order";
}

function buildMessageBody(row: CancellationRow): string {
  const lines = [
    `Cancellation requested for ${orderTypeLabel(row.orderType).toLowerCase()} ${row.orderNumber}.`,
    "",
    `Reason: ${row.reason?.trim() ? row.reason.trim() : "—"}`,
    // Legacy orders have no stored email to check against; the atelier should
    // confirm the requester before refunding an unverified cancellation.
    `Email verified: ${row.emailVerified ? "yes" : "no (confirm requester)"} (${row.email})`,
  ];
  return lines.join("\n");
}

/**
 * Notion page `properties` for a new cancellation request. When `clientPageId`
 * is given, the request is linked to the customer's Client CRM record via the
 * shared `Client` relation.
 */
export function buildCancellationProperties(
  row: CancellationRow,
  clientPageId?: string,
): Record<string, unknown> {
  return {
    [CONTACT_SUBJECT_PROPERTY]: {
      title: [
        {
          text: {
            content: `Cancellation: ${row.orderNumber}`,
          },
        },
      ],
    },
    [CONTACT_EMAIL_PROPERTY]: {
      email: row.email,
    },
    [CONTACT_STAGE_PROPERTY]: {
      select: { name: CONTACT_DEFAULT_STAGE },
    },
    [CONTACT_TYPE_PROPERTY]: {
      select: { name: CANCELLATION_REQUEST_TYPE },
    },
    [CONTACT_MESSAGE_PROPERTY]: {
      rich_text: [{ text: { content: buildMessageBody(row) } }],
    },
    ...contactClientRelation(clientPageId),
  };
}
