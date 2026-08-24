// Builds the Notion page `properties` for a data-deletion (erasure) request.
//
// The eighth writer to the shared "Website Contact Messages" database, and the
// same shape as the seven before it: one inbox for "a customer wants something
// from us", separated by the `Request type` select. Notion creates the option on
// first write, so this needs nothing added by hand.
//
// What makes this one different is what the row is FOR. Every other request in
// that inbox asks the atelier to do something to an order; this one asks them to
// remove a person from the studio's records — which the app deliberately never
// does itself (see `services/account-data.service.ts`). So the row is the whole
// deliverable, and it carries the two things a human needs to act on it without
// a second lookup: the address every Notion record is keyed on, and the sign-in
// account id, which is the only handle on the customer the app can't delete
// (the portal holds the anon Supabase key; removing an auth user is a dashboard
// step).
//
// Property *types* must match the live schema, not the property name (see
// `.agents/memory/`). The shared names are imported from contact.blocks so the
// writers to this database can't drift apart.

import {
  CONTACT_DEFAULT_STAGE,
  CONTACT_EMAIL_PROPERTY,
  CONTACT_MESSAGE_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_SUBJECT_PROPERTY,
  CONTACT_TYPE_PROPERTY,
  contactClientRelation,
} from "./contact.blocks.js";

/** The `Request type` value that marks a row as an erasure request. */
export const DATA_DELETION_REQUEST_TYPE = "Data deletion";

/** What the marketing opt-out actually did, recorded on the row so the atelier
 * knows whether the mailing list is already handled or still theirs to do. */
export type MarketingOptOutResult = "unsubscribed" | "absent" | "unavailable";

const MARKETING_LINES: Record<MarketingOptOutResult, string> = {
  unsubscribed: "removed from the marketing audience by the app",
  absent: "was not on the marketing audience",
  unavailable:
    "NOT done — the marketing list is unconfigured or unreachable; remove them by hand",
};

/** Everything the inbox row needs to action one erasure request. */
export interface DataDeletionRow {
  /** The signed-in email — the key every Notion record here is looked up by. */
  email: string;
  /** The customer's sign-in account id, when the session carried one. */
  userId?: string;
  /** Anything the customer wanted the studio to know. */
  note?: string;
  /** What the app already did about the mailing list. */
  marketing: MarketingOptOutResult;
}

function buildMessageBody(row: DataDeletionRow): string {
  return [
    `A customer has asked us to delete the personal data we hold about them.`,
    ``,
    `Account email: ${row.email}`,
    ...(row.userId ? [`Sign-in account id: ${row.userId}`] : []),
    `Marketing list: ${MARKETING_LINES[row.marketing]}`,
    ``,
    `Their note: ${row.note?.trim() ? row.note.trim() : "—"}`,
    ``,
    // Said on the row itself, not only in the docs: the one thing that must not
    // be assumed is that some of this has already been handled automatically.
    `Nothing else has been deleted. Orders, invoices and payment records are`,
    `business records — decide what may be erased, then remove the Notion rows,`,
    `the Client CRM record and the sign-in account by hand.`,
  ].join("\n");
}

/**
 * Notion page `properties` for a new data-deletion request. When `clientPageId`
 * is given, the row is linked to the customer's Client CRM record via the
 * shared `Client` relation — which is also the record the atelier will be
 * deleting, so the link is the way to it.
 */
export function buildDataDeletionProperties(
  row: DataDeletionRow,
  clientPageId?: string,
): Record<string, unknown> {
  return {
    [CONTACT_SUBJECT_PROPERTY]: {
      title: [{ text: { content: `Data deletion: ${row.email}` } }],
    },
    [CONTACT_EMAIL_PROPERTY]: { email: row.email },
    [CONTACT_STAGE_PROPERTY]: { select: { name: CONTACT_DEFAULT_STAGE } },
    [CONTACT_TYPE_PROPERTY]: { select: { name: DATA_DELETION_REQUEST_TYPE } },
    [CONTACT_MESSAGE_PROPERTY]: {
      rich_text: [{ text: { content: buildMessageBody(row) } }],
    },
    ...contactClientRelation(clientPageId),
  };
}
