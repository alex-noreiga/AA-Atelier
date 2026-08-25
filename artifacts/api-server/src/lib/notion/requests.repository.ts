// Reading the "Website Contact Messages" database back — the studio dashboard's
// customer-request queue.
//
// Every other module touching this database writes to it (six writers, one per
// request type, all through `contact-writer.ts`). The one existing read,
// `findPendingBackInStockRequests` in `notify.repository.ts`, answers a single
// question about a single request type; this is the general one, and it reuses
// the same contact client rather than needing a database id of its own.
//
// Two bounded queries rather than one scan. The contact inbox is the largest
// database the app reads — every inquiry and newsletter opt-in ever filed lives
// there — so paging it front to back (as the analytics do) would turn one
// dashboard load into up to a hundred Notion requests to find a handful of open
// rows. Instead the OPEN rows are asked for directly, oldest first, and the
// closed ones are a short second read for reference. Both are one page.
//
// Unlike the marketing-facing testimonial read, this fails loudly when the
// database isn't configured: it is a staff surface, and an empty queue that
// means "misconfigured" is indistinguishable from one that means "nothing to
// do" — which is the worst way for a work queue to be wrong.

import {
  getContactNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";
import {
  CONTACT_EMAIL_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_TYPE_PROPERTY,
} from "./contact.blocks.js";
import { normalizeEmail } from "../email.js";
import { NEWSLETTER_REQUEST_TYPE } from "./newsletter.blocks.js";
import {
  extractNewsletterSignups,
  extractStudioRequest,
  extractStudioRequests,
  REQUEST_STAGE_CLOSED,
  REQUEST_STAGE_VALUES,
  type NotionRequestPage,
  type NotionRequestsQueryResponse,
  type NewsletterSignupRecord,
  type RequestState,
  type StudioRequestRecord,
} from "./requests.schema.js";

/**
 * How many open requests one read covers. Notion's maximum page size, and
 * deliberately a single page: this is a working surface for a studio whose
 * inbox takes a handful of requests a week, so paginating would buy latency
 * and nothing else. The caller is told when the read was cut short.
 */
const OPEN_PAGE_SIZE = 100;

/** How many closed requests come back for reference. Enough to see what was
 * worked down recently and reopen a mistake; not a second list to scroll. */
export const CLOSED_REQUEST_LIMIT = 12;

function assertConfigured(client: NotionClient): void {
  assertDatabaseConfigured(
    client,
    "NOTION_CONTACT_DATABASE_ID is not configured for the contact database",
  );
}

/**
 * `Stage != Closed` AND `Request type != Newsletter` — the same pair the
 * inbox's own "Open — all types" view uses.
 *
 * Both are `does_not_equal`, which Notion matches for an EMPTY select too, and
 * that is the point: the app always writes `Stage = "New"` and a request type,
 * but a row someone added by hand might carry neither, and an untriaged request
 * should appear in the queue rather than vanish from it.
 */
const OPEN_FILTER = {
  and: [
    {
      property: CONTACT_STAGE_PROPERTY,
      select: { does_not_equal: REQUEST_STAGE_CLOSED },
    },
    {
      property: CONTACT_TYPE_PROPERTY,
      select: { does_not_equal: NEWSLETTER_REQUEST_TYPE },
    },
  ],
};

async function queryRequests(
  client: NotionClient,
  body: Record<string, unknown>,
): Promise<NotionRequestsQueryResponse> {
  const response = await client.fetch(
    `/v1/databases/${client.databaseId}/query`,
    { method: "POST", body: JSON.stringify(body) },
  );

  if (!response.ok) {
    throw new Error(
      `Notion customer-request query failed with status ${response.status}`,
    );
  }

  return (await response.json()) as NotionRequestsQueryResponse;
}

/**
 * The requests still waiting on the atelier, OLDEST first — the one that has
 * waited longest is the one that owes an answer, which is also how the inbox's
 * own open view is sorted.
 */
export async function listOpenRequests(
  client: NotionClient = getContactNotionClient(),
): Promise<{ records: StudioRequestRecord[]; truncated: boolean }> {
  assertConfigured(client);

  const data = await queryRequests(client, {
    page_size: OPEN_PAGE_SIZE,
    filter: OPEN_FILTER,
    sorts: [{ timestamp: "created_time", direction: "ascending" }],
  });

  return {
    records: extractStudioRequests(data.results),
    truncated: Boolean(data.has_more),
  };
}

/** The most recently closed requests, newest first — a record of what was
 * worked down, and the way back for one closed in error. */
export async function listClosedRequests(
  client: NotionClient = getContactNotionClient(),
  limit: number = CLOSED_REQUEST_LIMIT,
): Promise<StudioRequestRecord[]> {
  assertConfigured(client);

  const data = await queryRequests(client, {
    page_size: limit,
    filter: {
      property: CONTACT_STAGE_PROPERTY,
      select: { equals: REQUEST_STAGE_CLOSED },
    },
    sorts: [{ timestamp: "created_time", direction: "descending" }],
  });

  return extractStudioRequests(data.results);
}

/** One request by page id, or null when Notion no longer has it (the row may
 * have been deleted since the queue loaded). */
export async function findRequestById(
  requestId: string,
  client: NotionClient = getContactNotionClient(),
): Promise<StudioRequestRecord | null> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${requestId}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Notion customer-request read failed with status ${response.status}`,
    );
  }

  return extractStudioRequest((await response.json()) as NotionRequestPage);
}

/**
 * Write one request's state to its `Stage`, returning the row as it now stands.
 * Null when Notion doesn't have that page, which the service turns into a 404.
 *
 * This is the ONLY thing the dashboard writes to a request row. The request
 * itself is never edited here — the same contract the capture endpoints keep
 * with the orders they concern.
 */
export async function setRequestStage(
  requestId: string,
  state: RequestState,
  client: NotionClient = getContactNotionClient(),
): Promise<StudioRequestRecord | null> {
  assertConfigured(client);

  const response = await client.fetch(`/v1/pages/${requestId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [CONTACT_STAGE_PROPERTY]: {
          select: { name: REQUEST_STAGE_VALUES[state] },
        },
      },
    }),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion customer-request stage update failed with status ${response.status}: ${errorText}`,
    );
  }

  return extractStudioRequest((await response.json()) as NotionRequestPage);
}

/**
 * Every row this customer has filed, newest first — the requests half of their
 * data export.
 *
 * Two things differ from the queue reads above. It filters on the row's `Email`
 * rather than its stage, because an export is about who filed a row and not
 * about whether anyone has answered it; and it maps with the SINGULAR extractor,
 * so a newsletter opt-in is included rather than dropped. The queue excludes
 * opt-ins because nobody answers one; an export includes them because a record
 * of consent to be marketed to is exactly the kind of thing a customer is
 * entitled to see.
 *
 * One page, like the queue: 100 requests from one customer is far beyond what a
 * studio at this scale sees, and paginating an export nobody has ever filled
 * would buy latency and nothing else.
 */
export async function listRequestsByEmail(
  email: string,
  client: NotionClient = getContactNotionClient(),
): Promise<StudioRequestRecord[]> {
  assertConfigured(client);

  const normalized = normalizeEmail(email);
  if (!normalized) return [];

  const data = await queryRequests(client, {
    page_size: OPEN_PAGE_SIZE,
    filter: {
      property: CONTACT_EMAIL_PROPERTY,
      email: { equals: normalized },
    },
    sorts: [{ timestamp: "created_time", direction: "descending" }],
  });

  return data.results.map(extractStudioRequest);
}

// --- The newsletter opt-ins ------------------------------------------------
//
// Same database, same two-query shape as the queue above, and the mirror image
// of its filter: everything the queue excludes is exactly what this reads.

/** How many recently-filed opt-ins come back for reference. */
export const HANDLED_SIGNUP_LIMIT = 12;

/** The opt-ins not yet filed away, oldest first — someone who opted in weeks
 * ago and never reached the mailing list is the one to fix first. */
export async function listPendingNewsletterSignups(
  client: NotionClient = getContactNotionClient(),
): Promise<{ records: NewsletterSignupRecord[]; truncated: boolean }> {
  assertConfigured(client);

  const data = await queryRequests(client, {
    page_size: OPEN_PAGE_SIZE,
    filter: {
      and: [
        {
          property: CONTACT_TYPE_PROPERTY,
          select: { equals: NEWSLETTER_REQUEST_TYPE },
        },
        {
          property: CONTACT_STAGE_PROPERTY,
          select: { does_not_equal: REQUEST_STAGE_CLOSED },
        },
      ],
    },
    sorts: [{ timestamp: "created_time", direction: "ascending" }],
  });

  return {
    records: extractNewsletterSignups(data.results),
    truncated: Boolean(data.has_more),
  };
}

/** The most recently filed-away opt-ins, newest first. Still checked against
 * the live audience by the service, so one filed away that never reached the
 * list stays visible rather than being assumed done. */
export async function listHandledNewsletterSignups(
  client: NotionClient = getContactNotionClient(),
  limit: number = HANDLED_SIGNUP_LIMIT,
): Promise<NewsletterSignupRecord[]> {
  assertConfigured(client);

  const data = await queryRequests(client, {
    page_size: limit,
    filter: {
      and: [
        {
          property: CONTACT_TYPE_PROPERTY,
          select: { equals: NEWSLETTER_REQUEST_TYPE },
        },
        {
          property: CONTACT_STAGE_PROPERTY,
          select: { equals: REQUEST_STAGE_CLOSED },
        },
      ],
    },
    sorts: [{ timestamp: "created_time", direction: "descending" }],
  });

  return extractNewsletterSignups(data.results);
}
