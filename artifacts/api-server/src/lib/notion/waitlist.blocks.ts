// Builds the Notion page `properties` for a waitlist entry — a customer asking
// to be told when the studio's books reopen.
//
// These land in the SAME "Website Contact Messages" database as every other
// customer request, separated by the "Request type" select. That makes seven
// writers to one inbox; the alternative was a database of its own, and a
// waitlist is exactly the shape this inbox is for — somebody wants something
// from us and somebody has to get back to them.
//
// It needs **no new Notion property**. The shared Subject / Customer name /
// Email / Phone / Message / Stage / Request type carry the entry, and the event
// the customer is aiming at reuses the `Item` rich_text the back-in-stock writer
// introduced — exactly as the return/exchange writer reuses it for the piece
// being returned. That is what lets the atelier group the waitlist by
// competition in a Notion view ("who is waiting on Rocket City?") rather than
// reading it out of free text, without adding a column.
//
// Property *types* here must match the live schema, not the property name (see
// `.agents/memory/` and schema.ts for the same lesson on the orders database).

import type { z } from "zod";
import type { JoinWaitlistBody } from "@workspace/api-zod";
import {
  CONTACT_DEFAULT_STAGE,
  CONTACT_EMAIL_PROPERTY,
  CONTACT_MESSAGE_PROPERTY,
  CONTACT_NAME_PROPERTY,
  CONTACT_PHONE_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_SUBJECT_PROPERTY,
  CONTACT_TYPE_PROPERTY,
  contactClientRelation,
} from "./contact.blocks.js";
import { NOTIFY_ITEM_PROPERTY } from "./notify.blocks.js";
import { normalizeEmail } from "../email.js";

/** The "Request type" value that marks a row as a waitlist entry. */
export const WAITLIST_REQUEST_TYPE = "Waitlist";

/** Validated waitlist payload, derived from the OpenAPI contract. */
export type CreateWaitlistInput = z.infer<typeof JoinWaitlistBody>;

/**
 * The customer's `neededBy` as a Notion/contract date string (`yyyy-mm-dd`).
 *
 * The generated contract coerces a `format: date` field to a `Date`
 * (`zod.coerce.date()`), so what reaches the service is not the string the
 * browser sent — the same wrinkle `formatNeededBy` in `orders.blocks.ts` handles
 * for the order form's needed-by. Both defend against a raw string too, since
 * the coercion is the codegen's choice and not something either builder should
 * depend on.
 */
export function isoDateOnly(value: Date | string | undefined): string {
  if (!value) return "";
  const iso =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).trim();
  return iso.slice(0, 10);
}

/** What the entry is *for*, as the row records it. */
export interface WaitlistTarget {
  /** What the customer said they're skating, in their own words. */
  eventName?: string;
  /** ISO `yyyy-mm-dd` — when they need the piece by. */
  date?: string;
}

/**
 * The `Item` value: what this entry is waiting for. Named for the atelier's
 * eye, so a grouped view reads without opening rows. Empty when the customer
 * told us neither an event nor a date, in which case the property is omitted
 * rather than written blank.
 */
export function waitlistItemLabel(target: WaitlistTarget): string {
  if (target.eventName && target.date) {
    return `${target.eventName} (${target.date})`;
  }
  return target.eventName ?? target.date ?? "";
}

/**
 * Notion page `properties` for a new waitlist entry. When `clientPageId` is
 * given, the row is linked to the customer's Client CRM record via the shared
 * `Client` relation (the same best-effort link the other writers make).
 */
export function buildWaitlistProperties(
  data: CreateWaitlistInput & { target?: WaitlistTarget },
  clientPageId?: string,
): Record<string, unknown> {
  const target = data.target ?? {};
  const item = waitlistItemLabel(target);

  // The subject names who is waiting and what for, so the inbox row reads on
  // its own — the same reason the notify and newsletter writers compose one.
  const subject = item
    ? `Waitlist: ${data.name} — ${item}`
    : `Waitlist: ${data.name}`;

  // The body is assembled here rather than taken from the customer wholesale,
  // so the atelier reads the same rows in the same order on every entry.
  const lines = [
    item ? `Waiting for: ${item}` : "Waiting for: (not specified)",
    ...(data.notes?.trim() ? ["", data.notes.trim()] : []),
  ];

  const properties: Record<string, unknown> = {
    [CONTACT_SUBJECT_PROPERTY]: {
      title: [{ text: { content: subject } }],
    },
    [CONTACT_NAME_PROPERTY]: {
      rich_text: [{ text: { content: data.name } }],
    },
    [CONTACT_EMAIL_PROPERTY]: {
      email: normalizeEmail(data.email),
    },
    [CONTACT_MESSAGE_PROPERTY]: {
      rich_text: [{ text: { content: lines.join("\n") } }],
    },
    [CONTACT_STAGE_PROPERTY]: {
      select: { name: CONTACT_DEFAULT_STAGE },
    },
    [CONTACT_TYPE_PROPERTY]: {
      select: { name: WAITLIST_REQUEST_TYPE },
    },
    ...contactClientRelation(clientPageId),
  };

  if (item) {
    properties[NOTIFY_ITEM_PROPERTY] = {
      rich_text: [{ text: { content: item } }],
    };
  }

  if (data.phone) {
    properties[CONTACT_PHONE_PROPERTY] = { phone_number: data.phone };
  }

  return properties;
}
