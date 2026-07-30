// Builds the Notion page `properties` for a newsletter / mailing-list opt-in.
// These land in the SAME "Website Contact Messages" database as contact-form
// messages, back-in-stock requests, and measurement-change requests — one inbox,
// separated by the "Request type" select. A newsletter opt-in is the marketing
// counterpart to those transactional captures: an explicit "yes, market to me".
//
// It needs no Notion property of its own — email + the shared Subject/Stage/
// Request type carry it, and the opt-in `source` (footer / order form) folds
// into the subject line exactly as notify folds item/size — so the atelier adds
// nothing new to the database for this to work.
//
// Property *types* here must match the live schema, not the property name (see
// `.agents/memory/` and schema.ts for the same lesson on the orders database).

import type { z } from "zod";
import type { SubscribeNewsletterBody } from "@workspace/api-zod";
import {
  CONTACT_DEFAULT_STAGE,
  CONTACT_EMAIL_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_SUBJECT_PROPERTY,
  contactClientRelation,
} from "./contact.blocks.js";
import { normalizeEmail } from "../email.js";

// Shared with the other writers to this database (imported from contact.blocks
// so they can't drift). "Request type" is what separates them in the inbox.
export const NEWSLETTER_TYPE_PROPERTY = "Request type"; // select

/** The "Request type" value that marks a row as a newsletter opt-in. */
export const NEWSLETTER_REQUEST_TYPE = "Newsletter";

/** Validated newsletter payload, derived from the OpenAPI contract. */
export type CreateNewsletterInput = z.infer<typeof SubscribeNewsletterBody>;

/**
 * Notion page `properties` for a new newsletter opt-in. When `clientPageId` is
 * given, the row is linked to the customer's Client CRM record via the shared
 * `Client` relation (the same best-effort link the other three writers make).
 */
export function buildNewsletterProperties(
  data: CreateNewsletterInput,
  clientPageId?: string,
): Record<string, unknown> {
  // The subject names the opt-in (and its source, when known), so the inbox row
  // reads on its own without opening it.
  const subject = data.source
    ? `Newsletter opt-in — ${data.source}`
    : "Newsletter opt-in";

  return {
    [CONTACT_SUBJECT_PROPERTY]: {
      title: [{ text: { content: subject } }],
    },
    [CONTACT_EMAIL_PROPERTY]: {
      email: normalizeEmail(data.email),
    },
    [CONTACT_STAGE_PROPERTY]: {
      select: { name: CONTACT_DEFAULT_STAGE },
    },
    [NEWSLETTER_TYPE_PROPERTY]: {
      select: { name: NEWSLETTER_REQUEST_TYPE },
    },
    ...contactClientRelation(clientPageId),
  };
}
