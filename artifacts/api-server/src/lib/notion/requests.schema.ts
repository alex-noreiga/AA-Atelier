// Notion schema mapping for the READ side of the "Website Contact Messages"
// database — the customer requests the studio dashboard's queue works down.
//
// Six writers file into that database (see CLAUDE.md, "The contact database has
// six writers") and until now nothing read any of them back. The property-name
// constants and the `Request type` values therefore already exist, in the
// writers; this module imports them rather than restating them, exactly as
// `reviews.schema.ts` imports from `reviews.blocks.ts`, so a Notion rename stays
// a one-line change in one file and the two directions can't drift.
//
// Three things this owns beyond "read some properties":
//
//  1. **Deriving the kind and the state, rather than enumerating them.** An
//     unrecognized `Request type` is `other` and an unrecognized `Stage` is
//     `new` — both directions point at "appears in the queue asking to be
//     looked at" rather than "silently disappears from it". That mirrors
//     `reviewModeration`, and the contact inbox's own saved views, which filter
//     `Stage != Closed` for the same reason: a row nobody triaged should show.
//  2. **Recovering the order number.** The order-scoped writers put it in the
//     row's TITLE (`Cancellation: ORD-000002`) and in the first line of the
//     message body; there is no order-number property to read. Getting it back
//     is the whole point of the queue — it is what the atelier used to re-type
//     into a tool by hand — so it is parsed from both, and its absence means
//     the action is withheld rather than offered blank.
//  3. **Saying which tool actions which kind.** That mapping lives here, next to
//     the request-type constants that define what a cancellation IS, rather than
//     in the dashboard that renders the button.

import {
  CONTACT_EMAIL_PROPERTY,
  CONTACT_MESSAGE_PROPERTY,
  CONTACT_NAME_PROPERTY,
  CONTACT_PHONE_PROPERTY,
  CONTACT_REQUEST_TYPE,
  CONTACT_STAGE_PROPERTY,
  CONTACT_SUBJECT_PROPERTY,
  CONTACT_TYPE_PROPERTY,
  CONTACT_DEFAULT_STAGE,
} from "./contact.blocks.js";
import {
  NOTIFY_ITEM_PROPERTY,
  NOTIFY_REQUEST_TYPE,
  NOTIFY_SIZE_PROPERTY,
} from "./notify.blocks.js";
import { MEASUREMENT_CHANGE_REQUEST_TYPE } from "./measurement-change.blocks.js";
import { CANCELLATION_REQUEST_TYPE } from "./cancellation.blocks.js";
import { RETURN_REQUEST_TYPE } from "./return-request.blocks.js";
import { NEWSLETTER_REQUEST_TYPE } from "./newsletter.blocks.js";

/**
 * The `Stage` values the inbox has always carried, beyond the `New` every
 * writer files with. Targeted business rules naming live Notion option values,
 * like `REVIEW_STATUS_PUBLISHED` — rename either option in Notion and it must
 * change here too. `Closed` is the load-bearing one: it is the only value that
 * takes a request off the queue.
 */
export const REQUEST_STAGE_REPLIED = "Replied";
export const REQUEST_STAGE_CLOSED = "Closed";

/** Where a request stands in the inbox. Mirrors `StudioRequestState`. */
export type RequestState = "new" | "replied" | "closed";

/** The `Stage` text written for each state. `new` writes the capture default,
 * so reopening a request leaves the row exactly as a freshly filed one. */
export const REQUEST_STAGE_VALUES: Record<RequestState, string> = {
  new: CONTACT_DEFAULT_STAGE,
  replied: REQUEST_STAGE_REPLIED,
  closed: REQUEST_STAGE_CLOSED,
};

/** What a customer is asking for. Mirrors `StudioRequestKind`. */
export type RequestKind =
  | "inquiry"
  | "back-in-stock"
  | "measurement"
  | "cancellation"
  | "return"
  | "newsletter"
  | "other";

/** `Request type` → kind. Everything absent from this table is `other`, which
 * is what puts a row the atelier typed by hand in front of them rather than
 * dropping it. `newsletter` is here so the shared state operation can answer
 * with the row it wrote, but an opt-in is still kept out of the request QUEUE
 * (see {@link isNewsletterRow}) — it has a panel of its own. */
const KIND_BY_REQUEST_TYPE: Record<string, RequestKind> = {
  [CONTACT_REQUEST_TYPE]: "inquiry",
  [NOTIFY_REQUEST_TYPE]: "back-in-stock",
  [MEASUREMENT_CHANGE_REQUEST_TYPE]: "measurement",
  [CANCELLATION_REQUEST_TYPE]: "cancellation",
  [RETURN_REQUEST_TYPE]: "return",
  [NEWSLETTER_REQUEST_TYPE]: "newsletter",
};

/** The kinds that concern an order, and so carry an order number to recover. */
const ORDER_SCOPED_KINDS: ReadonlySet<RequestKind> = new Set<RequestKind>([
  "measurement",
  "cancellation",
  "return",
]);

/** The dashboard tool that actions this request, and which argument it takes.
 * `measurement` and `inquiry` are absent on purpose: a measurement change is
 * applied to the order by hand and an inquiry is answered by email, so there is
 * no button to offer. */
const TOOL_BY_KIND: Partial<Record<RequestKind, RequestActionTool>> = {
  cancellation: { tool: "cancellation-refund", argument: "orderNumber" },
  return: { tool: "return-refund", argument: "orderNumber" },
  "back-in-stock": { tool: "restock-alert", argument: "item" },
};

interface RequestActionTool {
  /** One of the `StudioTool` enum values. */
  tool: string;
  argument: "orderNumber" | "item";
}

/** How a request is actioned from the dashboard. */
export interface RequestAction {
  tool: string;
  orderNumber?: string;
  item?: string;
}

/** One customer request as the queue shows it. */
export interface StudioRequestRecord {
  id: string;
  kind: RequestKind;
  /** The `Request type` verbatim, when set — so an `other` row can say what
   * Notion actually holds instead of leaving the queue unexplained. */
  rawType?: string;
  subject: string;
  customerName?: string;
  email?: string;
  phone?: string;
  message?: string;
  orderNumber?: string;
  item?: string;
  size?: string;
  state: RequestState;
  rawStage?: string;
  submittedAt?: string;
  action?: RequestAction;
  notionUrl?: string;
}

// --- Raw Notion payload typing (only the property types we read) ---

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "email"; email: string | null }
  | { type: "phone_number"; phone_number: string | null };

export interface NotionRequestPage {
  id: string;
  created_time?: string;
  /** The row's page in Notion. Served to staff only, as the escape hatch to
   * whatever the queue doesn't show — the linked order, the client record. */
  url?: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionRequestsQueryResponse {
  results: NotionRequestPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

function extractTitle(page: NotionRequestPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractRichText(page: NotionRequestPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "rich_text") return "";
  return p.rich_text
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractSelect(page: NotionRequestPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "select") return "";
  return p.select?.name?.trim() ?? "";
}

function extractEmail(page: NotionRequestPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "email") return "";
  return p.email?.trim() ?? "";
}

function extractPhone(page: NotionRequestPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "phone_number") return "";
  return p.phone_number?.trim() ?? "";
}

// --- Derivations ---

/** Read a row's kind off its `Request type`. See {@link RequestKind} for why
 * anything unrecognized reads as `other`. */
export function requestKind(page: NotionRequestPage): RequestKind {
  const type = extractSelect(page, CONTACT_TYPE_PROPERTY);
  return KIND_BY_REQUEST_TYPE[type] ?? "other";
}

/**
 * Read a row's state off its `Stage`. Only `Closed` takes a request off the
 * queue: a blank stage, or a value the atelier invented, reads as `new`, which
 * is the same direction the inbox's own "Open — all types" view takes
 * (`Stage != Closed` rather than `Stage in (New, Replied)`) and for the same
 * reason — an untriaged request should appear rather than vanish.
 */
export function requestState(page: NotionRequestPage): RequestState {
  const stage = extractSelect(page, CONTACT_STAGE_PROPERTY);
  if (stage === REQUEST_STAGE_CLOSED) return "closed";
  if (stage === REQUEST_STAGE_REPLIED) return "replied";
  return "new";
}

/**
 * Whether a row is a newsletter opt-in, which is excluded from the queue.
 *
 * It lands in the same database and is written by the same shape of writer, but
 * it is a consent record rather than a request anyone answers — leaving it in
 * makes a queue that never empties. The Notion query filters it out too; this
 * is the authority, so a row the filter lets through (a `Request type` that
 * differs only in case, say) still can't reach the queue.
 */
export function isNewsletterRow(page: NotionRequestPage): boolean {
  return (
    extractSelect(page, CONTACT_TYPE_PROPERTY).toLowerCase() ===
    NEWSLETTER_REQUEST_TYPE.toLowerCase()
  );
}

/**
 * Order numbers as this app mints them — `ORD-000002`, `SHP-1A2B3C`,
 * `SHP-LEGACY-…` — matched case-insensitively so a hand-typed row still
 * resolves. Deliberately anchored on the two prefixes rather than accepting any
 * token: a wrong order number handed to a refund tool is the one failure worth
 * designing against, and the confirmation step echoes back whatever this finds.
 */
const ORDER_NUMBER_PATTERN = /\b((?:ORD|SHP)-[A-Za-z0-9][A-Za-z0-9-]*)\b/;

/**
 * The order number a request concerns, recovered from the row.
 *
 * There is no order-number PROPERTY on the contact database — the four
 * order-scoped writers put it in the title (`Cancellation: ORD-000002`) and
 * again in the message body's first line (`Return requested for shop order
 * SHP-…`). Both are read, title first, because the title is the writer's own
 * one-line summary and the body is the fallback for a title someone rewrote.
 *
 * Returns "" when neither yields something that looks like an order number,
 * which is what makes the action withheld rather than offered blank. That is
 * the safe direction: a refund is run against whatever is in the field.
 */
export function extractOrderNumber(subject: string, message: string): string {
  return (
    ORDER_NUMBER_PATTERN.exec(subject)?.[1] ??
    ORDER_NUMBER_PATTERN.exec(message)?.[1] ??
    ""
  );
}

/**
 * The tool that actions this request, if any. Absent when the kind has no tool
 * (a measurement change, an inquiry) OR when the argument it would need
 * couldn't be recovered — an action that can't carry its own order number is
 * exactly the hand-typing this queue exists to remove.
 */
export function requestAction(
  kind: RequestKind,
  values: { orderNumber?: string; item?: string },
): RequestAction | undefined {
  const spec = TOOL_BY_KIND[kind];
  if (!spec) return undefined;

  const value = values[spec.argument];
  if (!value) return undefined;

  return { tool: spec.tool, [spec.argument]: value };
}

/** Map one Notion contact row to the queue's projection. */
export function extractStudioRequest(
  page: NotionRequestPage,
): StudioRequestRecord {
  const kind = requestKind(page);
  const subject = extractTitle(page, CONTACT_SUBJECT_PROPERTY);
  const message = extractRichText(page, CONTACT_MESSAGE_PROPERTY);
  const item = extractRichText(page, NOTIFY_ITEM_PROPERTY);
  const rawType = extractSelect(page, CONTACT_TYPE_PROPERTY);
  const rawStage = extractSelect(page, CONTACT_STAGE_PROPERTY);
  const customerName = extractRichText(page, CONTACT_NAME_PROPERTY);
  const email = extractEmail(page, CONTACT_EMAIL_PROPERTY);
  const phone = extractPhone(page, CONTACT_PHONE_PROPERTY);
  const size = extractRichText(page, NOTIFY_SIZE_PROPERTY);

  // Only parsed for the kinds that concern an order: an inquiry that happens to
  // quote an order number is not a request against that order, and offering a
  // refund button on one would be a serious way to be wrong.
  const orderNumber = ORDER_SCOPED_KINDS.has(kind)
    ? extractOrderNumber(subject, message)
    : "";
  const action = requestAction(kind, { orderNumber, item });

  return {
    id: page.id,
    kind,
    // A row with no title reads as an empty card, so name it by what it is.
    subject: subject || rawType || "Untitled request",
    state: requestState(page),
    ...(rawType ? { rawType } : {}),
    ...(customerName ? { customerName } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(message ? { message } : {}),
    ...(orderNumber ? { orderNumber } : {}),
    ...(item ? { item } : {}),
    ...(size ? { size } : {}),
    ...(rawStage ? { rawStage } : {}),
    ...(page.created_time ? { submittedAt: page.created_time } : {}),
    ...(page.url ? { notionUrl: page.url } : {}),
    ...(action ? { action } : {}),
  };
}

/** Map a Notion query page to the queue's projection, dropping the newsletter
 * opt-ins that share the database. */
export function extractStudioRequests(
  pages: NotionRequestPage[],
): StudioRequestRecord[] {
  return pages
    .filter((page) => !isNewsletterRow(page))
    .map(extractStudioRequest);
}

// --- The newsletter opt-ins (their own panel, not the queue) ---

/** One marketing opt-in as its panel shows it. Deliberately narrow: an opt-in
 * IS an email address and when it arrived, so there is nothing else to map.
 * Whether it reached the mailing list is NOT here — that is read live from
 * Resend by the service, because a marker on this row could only say what
 * someone remembered to tick. */
export interface NewsletterSignupRecord {
  id: string;
  email?: string;
  /** Where they opted in — the footer field, the order form. */
  source?: string;
  subject: string;
  state: RequestState;
  submittedAt?: string;
  notionUrl?: string;
}

/**
 * The opt-in `source` back out of the subject the writer composed.
 *
 * `newsletter.blocks.ts` deliberately folds it into the title
 * (`Newsletter opt-in — footer`) rather than adding a property, so this is the
 * only way to recover it. It is display-only and nothing branches on it, which
 * is why an unrecognized subject simply yields nothing rather than being
 * treated as a mapping failure.
 */
export function extractSignupSource(subject: string): string {
  const [, source = ""] = subject.split(/\s+—\s+/, 2);
  return source.trim();
}

/** Map one Notion contact row to the newsletter panel's projection. */
export function extractNewsletterSignup(
  page: NotionRequestPage,
): NewsletterSignupRecord {
  const subject = extractTitle(page, CONTACT_SUBJECT_PROPERTY);
  const email = extractEmail(page, CONTACT_EMAIL_PROPERTY);
  const source = extractSignupSource(subject);

  return {
    id: page.id,
    subject: subject || "Newsletter opt-in",
    state: requestState(page),
    ...(email ? { email } : {}),
    ...(source ? { source } : {}),
    ...(page.created_time ? { submittedAt: page.created_time } : {}),
    ...(page.url ? { notionUrl: page.url } : {}),
  };
}

export function extractNewsletterSignups(
  pages: NotionRequestPage[],
): NewsletterSignupRecord[] {
  return pages.map(extractNewsletterSignup);
}
