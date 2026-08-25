// The signed-in customer's data rights: an export they can take, and an erasure
// request they can file. Independent of HTTP — the route handlers call these
// with the session's email and turn the result into a response.
//
// The two halves are deliberately asymmetric, and the asymmetry is the design:
//
//   **Export runs.** Everything it gathers is already readable by this customer
//   (their orders, their appointments, their own words in a review), so serving
//   it is not a decision anyone has to make. The Supabase access token is proof
//   they control the inbox every record here is keyed on, which is the same
//   identity the account dashboard has always used.
//
//   **Deletion asks.** The app never erases anything itself. Orders, invoices
//   and payment records are business records the studio is required to keep for
//   a period; the customer's records also live in Notion, Stripe, Google
//   Calendar and Supabase Auth, several of which the app cannot reach with the
//   credentials it holds (the portal has the anon Supabase key, so it cannot
//   delete an auth user at all). A "delete everything" button that silently did
//   a fraction of that would be the worst of both worlds: irreversible where it
//   worked and untrue where it didn't. So it files one clear item of work into
//   the inbox the atelier already works down, with the account id a human needs
//   to finish the job.
//
//   The single exception is the marketing list, which is erased on the spot —
//   it is the customer's own opt-out to take, needs nobody's judgement, and
//   Resend is the authority on it. See `unsubscribeAudienceContact`.
//
// One rule governs the export's failures: a source that can't be read is NAMED,
// never dropped. An export missing a source without saying so is a wrong answer
// to a legal request, not a slightly smaller one — so each read degrades on its
// own and the response carries the list of what is missing.

import type { z } from "zod";
import type { RequestAccountDeletionBody } from "@workspace/api-zod";
import {
  listCustomOrders,
  listShopOrders,
  upcomingAppointments,
  type AccountCustomOrder,
  type AccountShopOrder,
} from "./account.service.js";
import type { AppointmentManageDetails } from "../lib/appointments/event-details.js";
import {
  findClientProfileByEmail,
  upsertClientByEmail,
} from "../lib/notion/clients.repository.js";
import { listRequestsByEmail } from "../lib/notion/requests.repository.js";
import { listReviewsByEmail } from "../lib/notion/reviews.repository.js";
import type { StudioRequestRecord } from "../lib/notion/requests.schema.js";
import type { StudioReviewRecord } from "../lib/notion/reviews.schema.js";
import {
  listAudienceContacts,
  membershipIn,
  unsubscribeAudienceContact,
} from "../lib/resend/audience.js";
import {
  createDataDeletionRequest,
  hasOpenDataDeletionRequest,
} from "../lib/notion/data-deletion.repository.js";
import type { MarketingOptOutResult } from "../lib/notion/data-deletion.blocks.js";
import {
  dataDeletionRequestConfirmationEmail,
  dataDeletionRequestNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

// --- The export ------------------------------------------------------------

/** The customer's Client CRM record, narrowed to what is theirs. */
export interface ExportedClient {
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
  lastContact?: string;
  referralCode?: string;
  referredByEmail?: string;
  firstPaidOrder?: string;
}

/** One row the customer filed in the studio's shared inbox. */
export interface ExportedRequest {
  kind: StudioRequestRecord["kind"];
  rawType?: string;
  subject: string;
  message?: string;
  item?: string;
  size?: string;
  orderNumber?: string;
  state: StudioRequestRecord["state"];
  submittedAt?: string;
}

/** One review the customer wrote, published or not. */
export interface ExportedReview {
  rating: number;
  comment: string;
  customerName?: string;
  orderNumber?: string;
  consentToPublish: boolean;
  status: StudioReviewRecord["status"];
  submittedAt?: string;
}

export interface AccountDataExportResult {
  generatedAt: string;
  email: string;
  userId?: string;
  customOrders: AccountCustomOrder[];
  shopOrders: AccountShopOrder[];
  appointments: AppointmentManageDetails[];
  client?: ExportedClient;
  requests: ExportedRequest[];
  reviews: ExportedReview[];
  marketing: { status: "subscribed" | "absent" | "unknown" };
  unavailable: string[];
}

/**
 * The customer-facing names the export reports a missing source by. They are
 * the words the account page uses for the same things, because the customer is
 * who reads this list — "Custom orders", not `findOrdersByEmail`.
 */
const SOURCE_LABELS = {
  customOrders: "Custom orders",
  shopOrders: "Shop orders",
  appointments: "Appointments",
  client: "Your contact record",
  requests: "Requests you've sent us",
  reviews: "Reviews you've written",
  // The mailing list is deliberately absent: its own `unknown` status already
  // says "we couldn't ask" in the place the customer is reading it.
} as const;

type SourceKey = keyof typeof SOURCE_LABELS;

/**
 * Read one source, or record that it couldn't be read and fall back.
 *
 * Every source goes through this, including the orders — which is the one
 * choice here worth stating. A queue that fails loudly is right when a person
 * is looking at it and can retry; an export is answering a request with a legal
 * deadline, and a labelled partial export the customer can act on beats a 500
 * they can only stare at. Nothing is ever silently absent, which is what makes
 * the trade safe.
 */
async function readSource<T>(
  key: SourceKey,
  read: () => Promise<T>,
  fallback: T,
  unavailable: string[],
): Promise<T> {
  try {
    return await read();
  } catch (err) {
    logger.warn(
      { err, source: key },
      "Data export: a source could not be read; it is reported as unavailable",
    );
    unavailable.push(SOURCE_LABELS[key]);
    return fallback;
  }
}

/** Drop the empty strings a Notion read renders an absent property as, so the
 * export carries a field or omits it rather than showing a blank one. */
function present<T extends object>(row: T): Partial<T> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && value) out[key] = value;
  }
  return out as Partial<T>;
}

/** The customer's half of an inbox row. The studio's own bookkeeping — the
 * Notion link, the tool that actions it — stays on the server. */
function toExportedRequest(record: StudioRequestRecord): ExportedRequest {
  return {
    kind: record.kind,
    subject: record.subject,
    state: record.state,
    ...present({
      rawType: record.rawType ?? "",
      message: record.message ?? "",
      item: record.item ?? "",
      size: record.size ?? "",
      orderNumber: record.orderNumber ?? "",
      submittedAt: record.submittedAt ?? "",
    }),
  };
}

/** The customer's half of a review row. `emailVerified` is the studio's check
 * on the submission, not something the customer told us, so it stays here. */
function toExportedReview(record: StudioReviewRecord): ExportedReview {
  return {
    rating: record.rating,
    comment: record.comment,
    consentToPublish: record.consentToPublish,
    status: record.status,
    ...present({
      customerName: record.customerName ?? "",
      orderNumber: record.orderNumber ?? "",
      submittedAt: record.submittedAt ?? "",
    }),
  };
}

/** An appointment as the export carries it: the dashboard's details, minus the
 * signed manage token. That token authorizes rescheduling and cancelling the
 * booking with no further sign-in, and an export is a file people email to
 * themselves, print, and forward. */
function toExportedAppointment(appointment: {
  manageToken: string;
}): AppointmentManageDetails {
  const { manageToken: _manageToken, ...details } = appointment;
  return details as AppointmentManageDetails;
}

/**
 * Everything the studio holds about this customer, gathered for a data-access
 * request. Each source is read independently and concurrently, and one that
 * fails is named in `unavailable` rather than left out.
 */
export async function exportAccountData(
  email: string,
  userId?: string,
): Promise<AccountDataExportResult> {
  const unavailable: string[] = [];

  const [customOrders, shopOrders, appointments, client, requests, reviews] =
    await Promise.all([
      readSource(
        "customOrders",
        () => listCustomOrders(email),
        [],
        unavailable,
      ),
      readSource("shopOrders", () => listShopOrders(email), [], unavailable),
      // Already best-effort in the dashboard's own read (it degrades to an
      // empty list on a calendar outage), so this can only report a source
      // failure the account page would also have hidden. Wrapped anyway, so a
      // future change there can't quietly make the export incomplete.
      readSource(
        "appointments",
        async () =>
          (await upcomingAppointments(email)).map(toExportedAppointment),
        [],
        unavailable,
      ),
      readSource(
        "client",
        () => findClientProfileByEmail(email),
        null,
        unavailable,
      ),
      readSource(
        "requests",
        async () => (await listRequestsByEmail(email)).map(toExportedRequest),
        [],
        unavailable,
      ),
      readSource(
        "reviews",
        async () => (await listReviewsByEmail(email)).map(toExportedReview),
        [],
        unavailable,
      ),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    email,
    ...(userId ? { userId } : {}),
    customOrders,
    shopOrders,
    appointments,
    ...(client ? { client: present(client) } : {}),
    requests,
    reviews,
    marketing: { status: await marketingStatus(email) },
    unavailable,
  };
}

/**
 * Whether the customer is on the marketing list, read live from Resend.
 *
 * `unknown` — never `absent` — when the audience is unconfigured or unreadable,
 * for the same reason the studio's newsletter panel makes that distinction:
 * telling someone they are not on a list the studio couldn't actually check is
 * a claim, not an answer. It is deliberately NOT added to `unavailable`, since
 * the status field already says so in the place the customer is reading.
 */
async function marketingStatus(
  email: string,
): Promise<"subscribed" | "absent" | "unknown"> {
  try {
    return membershipIn(await listAudienceContacts(), email) ?? "unknown";
  } catch (err) {
    logger.warn(
      { err },
      "Data export: could not read the Resend audience; marketing status is unknown",
    );
    return "unknown";
  }
}

// --- The erasure request ---------------------------------------------------

/** Validated deletion-request payload, derived from the OpenAPI contract. */
export type CreateDeletionRequestInput = z.infer<
  typeof RequestAccountDeletionBody
>;

export interface DeletionRequestResult {
  received: true;
  alreadyRequested: boolean;
  marketing: MarketingOptOutResult;
}

/**
 * File an erasure request for the signed-in customer.
 *
 * Order of operations is load-bearing. The mailing-list opt-out runs FIRST and
 * unconditionally — including on a repeat press, where nothing else happens —
 * because it is the one thing the customer asked for that the app can actually
 * deliver, and a first attempt that couldn't reach Resend must get another go.
 * The Notion row is written second, carrying what the opt-out did, so the
 * atelier can see at a glance whether the list is already handled.
 *
 * A request already open means no second row: the inbox gets one item of work
 * per customer, and the customer is told their request is on file rather than
 * being quietly given a duplicate.
 */
export async function submitAccountDeletionRequest(
  email: string,
  input: CreateDeletionRequestInput,
  userId?: string,
): Promise<DeletionRequestResult> {
  const marketing = await unsubscribeAudienceContact(email);

  // A failure here would be a Notion outage, which the route turns into a 500 —
  // the right answer, because the row IS the request and there is nothing else
  // that would carry it. (The opt-out above has already happened, and re-running
  // it on the retry is harmless.)
  if (await hasOpenDataDeletionRequest(email)) {
    return { received: true, alreadyRequested: true, marketing };
  }

  // Best-effort: link the request to the Client CRM record — which is also one
  // of the records the atelier will be deleting, so the link is the way to it.
  let clientPageId: string | undefined;
  try {
    clientPageId =
      (await upsertClientByEmail({ fullName: "", email })) ?? undefined;
  } catch (err) {
    logger.warn(
      { err },
      "Failed to resolve the Client CRM record; filing the erasure request without a client link",
    );
  }

  const note = input.note?.trim();
  await createDataDeletionRequest(
    {
      email,
      marketing,
      ...(userId ? { userId } : {}),
      ...(note ? { note } : {}),
    },
    undefined,
    clientPageId,
  );

  // Best-effort emails, like every other request flow. An erasure request is
  // account-related rather than order-related, but it concerns the customer's
  // whole record, so it goes out under the "contact" category — the same sender
  // as the inquiry acknowledgement it most resembles.
  const from = fromAddress("contact");
  await sendEmailBestEffort({
    ...dataDeletionRequestConfirmationEmail(email, marketing),
    from,
  });
  const inbox = atelierInbox("contact");
  if (inbox) {
    await sendEmailBestEffort({
      ...dataDeletionRequestNotificationEmail(
        {
          email,
          marketing,
          ...(userId ? { userId } : {}),
          ...(note ? { note } : {}),
        },
        inbox,
      ),
      from,
    });
  }

  return { received: true, alreadyRequested: false, marketing };
}
