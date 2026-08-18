// Builds the Notion page `properties` for a return / exchange request. Like
// back-in-stock and measurement-change requests, these land in the SAME
// "Website Contact Messages" database — one inbox for "a customer wants
// something from us" — and the "Request type" select ("Return / exchange") is
// what tells them apart and drives a filtered view in Notion. This endpoint
// never refunds or edits the order; the atelier reads the request and actions
// it by hand, exactly like the measurement-change flow (Approach A).
//
// Property *types* here must match the live schema, not the property name (see
// `.agents/memory/` and schema.ts). The shared property names are imported from
// contact.blocks so the writers to this database can't drift apart, and the
// item column reuses notify.blocks' `Item` property.

import type { z } from "zod";
import type { CreateReturnRequestBody } from "@workspace/api-zod";
import {
  CONTACT_DEFAULT_STAGE,
  CONTACT_EMAIL_PROPERTY,
  CONTACT_MESSAGE_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_SUBJECT_PROPERTY,
  CONTACT_TYPE_PROPERTY,
  contactClientRelation,
  contactOrderRelation,
  emailVerifiedLine,
} from "./contact.blocks.js";
import { NOTIFY_ITEM_PROPERTY } from "./notify.blocks.js";

/** The "Request type" value that marks a row as a return/exchange request. */
export const RETURN_REQUEST_TYPE = "Return / exchange";

/** Validated return/exchange payload, derived from the OpenAPI contract. */
export type CreateReturnInput = z.infer<typeof CreateReturnRequestBody>;

/** Human-readable labels for the structured `reason` enum, for the inbox row. */
export const RETURN_REASON_LABELS: Record<CreateReturnInput["reason"], string> =
  {
    wrong_size: "Wrong size / doesn't fit",
    damaged: "Arrived damaged or defective",
    not_as_expected: "Not as expected",
    changed_mind: "Changed my mind",
    other: "Other",
  };

/** Everything the inbox row needs: the request plus the order it targets and
 * whether we could verify the requester's email against the order. */
export interface ReturnRequestRow {
  orderNumber: string;
  emailVerified: boolean;
  request: CreateReturnInput;
  /** The shop order's Notion page id, to link the request via the `Shop Order`
   * relation. Omitted when the `NOTION_RELATION_LINKS` gate is off. */
  orderPageId?: string;
}

function buildMessageBody(row: ReturnRequestRow): string {
  const { orderNumber, emailVerified, request } = row;
  const kindLabel = request.kind === "exchange" ? "Exchange" : "Return";
  const lines = [
    `${kindLabel} requested for shop order ${orderNumber}.`,
    "",
    `Reason: ${RETURN_REASON_LABELS[request.reason]}`,
    `Item(s): ${request.items?.trim() ? request.items.trim() : "—"}`,
  ];
  // Only meaningful for an exchange — the size/colour/piece they want instead.
  if (request.kind === "exchange") {
    lines.push(
      `Exchange for: ${request.exchangeFor?.trim() ? request.exchangeFor.trim() : "—"}`,
    );
  }
  lines.push(
    `Note: ${request.note?.trim() ? request.note.trim() : "—"}`,
    // Legacy orders have no stored email to check against; the atelier should
    // confirm the requester before actioning an unverified request.
    emailVerifiedLine(emailVerified, request.email),
  );
  return lines.join("\n");
}

/**
 * Notion page `properties` for a new return/exchange request. When
 * `clientPageId` is given, the request is linked to the customer's Client CRM
 * record via the shared `Client` relation.
 */
export function buildReturnRequestProperties(
  row: ReturnRequestRow,
  clientPageId?: string,
): Record<string, unknown> {
  const kindLabel = row.request.kind === "exchange" ? "Exchange" : "Return";

  const properties: Record<string, unknown> = {
    [CONTACT_SUBJECT_PROPERTY]: {
      title: [{ text: { content: `${kindLabel}: ${row.orderNumber}` } }],
    },
    [CONTACT_EMAIL_PROPERTY]: {
      email: row.request.email,
    },
    [CONTACT_STAGE_PROPERTY]: {
      select: { name: CONTACT_DEFAULT_STAGE },
    },
    [CONTACT_TYPE_PROPERTY]: {
      select: { name: RETURN_REQUEST_TYPE },
    },
    [CONTACT_MESSAGE_PROPERTY]: {
      rich_text: [{ text: { content: buildMessageBody(row) } }],
    },
    ...contactClientRelation(clientPageId),
    ...contactOrderRelation("shop", row.orderPageId),
  };

  // Reuse the shared `Item` column (from the back-in-stock writer) so the
  // atelier gets a structured, filterable piece name rather than only free text.
  if (row.request.items?.trim()) {
    properties[NOTIFY_ITEM_PROPERTY] = {
      rich_text: [{ text: { content: row.request.items.trim() } }],
    };
  }

  return properties;
}
