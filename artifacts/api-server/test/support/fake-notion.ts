// Test doubles for the injectable Notion client. The repository functions all
// accept a `NotionClient` as their last argument (that's the seam this suite
// exercises), so tests can drive them with a fully controlled fetch instead of
// touching the network.

import type { NotionClient } from "../../src/lib/notion/client.js";

export interface FakeCall {
  path: string;
  init?: RequestInit;
}

export interface FakeNotionClient extends NotionClient {
  /** Every fetch made through this client, in order. */
  readonly calls: FakeCall[];
}

type FetchImpl = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/**
 * Build a fake client whose `fetch` delegates to `impl`. Records every call so
 * tests can assert on the request shape (e.g. the rich_text filter body).
 */
export function makeFakeClient(
  impl: FetchImpl,
  databaseId = "test-db-id",
): FakeNotionClient {
  const calls: FakeCall[] = [];
  return {
    databaseId,
    calls,
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      calls.push({ path, init });
      return impl(path, init);
    },
  };
}

/** A JSON `Response` with the given status (defaults to 200/ok). */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A non-ok `Response` carrying a plain-text error body. */
export function errorResponse(status: number, text = "error"): Response {
  return new Response(text, { status });
}

/** Minimal Notion database schema with the given "Stage" status options. */
export function databaseSchemaWithStages(stageNames: string[]) {
  return {
    properties: {
      Stage: {
        type: "status",
        status: {
          options: stageNames.map((name, i) => ({ id: `id-${i}`, name })),
        },
      },
    },
  };
}

/**
 * Minimal Notion inventory page as returned by a query on the inventory
 * database. Only the properties the repository/schema read are populated; each
 * is optional so a test names just the fields it cares about.
 */
export function inventoryPage(opts: {
  id?: string;
  name?: string;
  category?: string;
  categoryId?: string;
  published?: boolean;
  status?: string | null;
  quantityAvailable?: number | null;
  sizesOffered?: string[];
  sizesAvailable?: string[];
}) {
  const properties: Record<string, unknown> = {
    "Item Name": {
      type: "title",
      title: opts.name ? [{ plain_text: opts.name }] : [],
    },
    "Show on website": {
      type: "checkbox",
      checkbox: opts.published ?? true,
    },
  };
  if (opts.category !== undefined) {
    properties["Item Type"] = {
      type: "select",
      select: { name: opts.category },
    };
  }
  if (opts.categoryId !== undefined) {
    properties["Category"] = {
      type: "relation",
      relation: [{ id: opts.categoryId }],
    };
  }
  if (opts.status !== undefined) {
    properties["Status"] = {
      type: "status",
      status: opts.status === null ? null : { name: opts.status },
    };
  }
  if (opts.quantityAvailable !== undefined) {
    properties["Quantity Available"] = {
      type: "formula",
      formula: { type: "number", number: opts.quantityAvailable },
    };
  }
  if (opts.sizesOffered !== undefined) {
    properties["Sizes Offered"] = {
      type: "multi_select",
      multi_select: opts.sizesOffered.map((name) => ({ name })),
    };
  }
  if (opts.sizesAvailable !== undefined) {
    properties["Sizes Available"] = {
      type: "multi_select",
      multi_select: opts.sizesAvailable.map((name) => ({ name })),
    };
  }
  return { id: opts.id ?? "inv-page", properties };
}

/** Minimal "Product Categories" page as returned by a query — a category name,
 * its "Show size guide" checkbox, an optional "Size Guide Type" select, and an
 * optional "Sort" number. */
/**
 * Minimal "Staff Availability" page as returned by a query or a page write. The
 * repository reads six properties; anything omitted here is simply absent, which
 * is what a row missing that property in Notion looks like.
 */
export function availabilityPage(opts: {
  id?: string;
  staff?: string;
  email?: string;
  weekdays?: string[];
  start?: string;
  end?: string;
  locations?: string[];
}) {
  const richText = (value?: string) => ({
    type: "rich_text",
    rich_text: value ? [{ plain_text: value }] : [],
  });
  return {
    id: opts.id ?? "availability-page",
    properties: {
      Staff: {
        type: "title",
        title: opts.staff ? [{ plain_text: opts.staff }] : [],
      },
      "Calendar Email": { type: "email", email: opts.email ?? null },
      Weekdays: {
        type: "multi_select",
        multi_select: (opts.weekdays ?? []).map((name) => ({ name })),
      },
      Start: richText(opts.start),
      End: richText(opts.end),
      Locations: {
        type: "multi_select",
        multi_select: (opts.locations ?? []).map((name) => ({ name })),
      },
    },
  };
}

export function categoryPage(opts: {
  id?: string;
  name?: string;
  showSizeGuide?: boolean;
  sizeGuideType?: string;
  sort?: number;
}) {
  const properties: Record<string, unknown> = {
    Name: {
      type: "title",
      title: opts.name ? [{ plain_text: opts.name }] : [],
    },
    "Show size guide": {
      type: "checkbox",
      checkbox: opts.showSizeGuide ?? false,
    },
  };
  if (opts.sizeGuideType !== undefined) {
    properties["Size Guide Type"] = {
      type: "select",
      select: { name: opts.sizeGuideType },
    };
  }
  if (opts.sort !== undefined) {
    properties["Sort"] = { type: "number", number: opts.sort };
  }
  return { id: opts.id ?? "category-page", properties };
}

/**
 * Minimal Client CRM page as returned by a query. The upsert only reads the
 * page `id` back, so that's all this carries.
 */
export function crmClientPage(opts: { id?: string } = {}) {
  return { id: opts.id ?? "client-page" };
}

/** Minimal Client CRM page carrying the reward properties the rewards flow
 * reads (referral code, the referrer link, the idempotency flags, the first
 * paid order + audit codes). Each is optional so a test names just what it needs. */
export function crmRewardPage(opts: {
  id?: string;
  email?: string;
  referralCode?: string;
  referredByEmail?: string;
  referralRewarded?: boolean;
  firstPaidOrder?: string;
  returningRewardIssued?: boolean;
  returningDiscountCode?: string;
}) {
  const rt = (value?: string) => ({
    type: "rich_text",
    rich_text: value ? [{ plain_text: value }] : [],
  });
  return {
    id: opts.id ?? "client-page",
    properties: {
      Email: { type: "email", email: opts.email ?? null },
      "Referral Code": rt(opts.referralCode),
      "Referred By Email": rt(opts.referredByEmail),
      "Referral Rewarded": {
        type: "checkbox",
        checkbox: opts.referralRewarded ?? false,
      },
      "First Paid Order": rt(opts.firstPaidOrder),
      "Returning Reward Issued": {
        type: "checkbox",
        checkbox: opts.returningRewardIssued ?? false,
      },
      "Returning Discount Code": rt(opts.returningDiscountCode),
    },
  };
}

/** Minimal Notion order page as returned by a database query. Payments live on
 * the linked invoice now, so the order carries only the `Invoices` relation. */
export function orderPage(opts: {
  id?: string;
  orderNumber?: string;
  orderName?: string;
  currentStage?: string | null;
  invoicePageId?: string;
  costingItemIds?: string[];
  email?: string | null;
  dueDate?: string | null;
  milestonesGenerated?: boolean;
  lastNotifiedStage?: string;
  cancelled?: boolean;
  rush?: boolean;
  /** Notion's page-creation timestamp, read by the studio analytics. */
  createdTime?: string;
  /** The `Service` select, as an order stores it (the catalog's display
   * `name`). Omitted ⇒ no property at all, like an order placed before the
   * service catalog existed. */
  service?: string;
}) {
  return {
    id: opts.id ?? "page-id",
    ...(opts.createdTime !== undefined
      ? { created_time: opts.createdTime }
      : {}),
    properties: {
      ...(opts.rush !== undefined
        ? { "Rush Order": { type: "checkbox", checkbox: opts.rush } }
        : {}),
      "Costing Items": {
        type: "relation",
        relation: (opts.costingItemIds ?? []).map((id) => ({ id })),
      },
      "Order Number": {
        type: "rich_text",
        rich_text: opts.orderNumber ? [{ plain_text: opts.orderNumber }] : [],
      },
      "Order Name": {
        type: "title",
        title: opts.orderName ? [{ plain_text: opts.orderName }] : [],
      },
      Email: {
        type: "email",
        email: opts.email ?? null,
      },
      ...(opts.service !== undefined
        ? { Service: { type: "select", select: { name: opts.service } } }
        : {}),
      Stage: {
        type: "status",
        status:
          opts.currentStage === null || opts.currentStage === undefined
            ? null
            : { name: opts.currentStage },
      },
      Invoices: {
        type: "relation",
        relation: opts.invoicePageId ? [{ id: opts.invoicePageId }] : [],
      },
      "Due Date": {
        type: "date",
        date:
          opts.dueDate === null || opts.dueDate === undefined
            ? null
            : { start: opts.dueDate, end: null },
      },
      "Milestones Generated": {
        type: "checkbox",
        checkbox: opts.milestonesGenerated ?? false,
      },
      "Last Notified Stage": {
        type: "rich_text",
        rich_text: opts.lastNotifiedStage
          ? [{ plain_text: opts.lastNotifiedStage }]
          : [],
      },
      Cancelled: {
        type: "checkbox",
        checkbox: opts.cancelled ?? false,
      },
    },
  };
}

/** Minimal "invoices & payments" page (the invoice head), including its staged
 * deposits — the source of truth for what the customer pays online. */
export function invoicePage(opts: {
  id?: string;
  invoiceId?: string;
  ready?: boolean;
  balancePaid?: boolean;
  balanceSessionId?: string;
  finalBalance?: number | null;
  paymentDeadline?: string | null;
  firstDepositAmount?: number | null;
  firstDepositPaid?: boolean;
  firstDepositSessionId?: string;
  secondDepositAmount?: number | null;
  secondDepositPaid?: boolean;
  secondDepositSessionId?: string;
  // Payment-reminder fields (per-stage due dates + `Reminded` markers + the
  // `Order` relation used to resolve the customer email).
  firstDepositDue?: string | null;
  secondDepositDue?: string | null;
  firstDepositReminded?: boolean;
  secondDepositReminded?: boolean;
  balanceReminded?: boolean;
  orderPageId?: string;
}) {
  return {
    id: opts.id ?? "invoice-page",
    properties: {
      "Invoice ID": {
        type: "title",
        title: opts.invoiceId ? [{ plain_text: opts.invoiceId }] : [],
      },
      "Invoice Ready": {
        type: "checkbox",
        checkbox: opts.ready ?? false,
      },
      "Balance Paid": {
        type: "checkbox",
        checkbox: opts.balancePaid ?? false,
      },
      "Balance Payment Session Id": {
        type: "rich_text",
        rich_text: opts.balanceSessionId
          ? [{ plain_text: opts.balanceSessionId }]
          : [],
      },
      "Final Balance": {
        type: "rollup",
        rollup: { type: "number", number: opts.finalBalance ?? null },
      },
      "Payment Deadline": {
        type: "date",
        date:
          opts.paymentDeadline === null || opts.paymentDeadline === undefined
            ? null
            : { start: opts.paymentDeadline, end: null },
      },
      "First Deposit Amount": {
        type: "number",
        number: opts.firstDepositAmount ?? null,
      },
      "First Deposit Paid": {
        type: "checkbox",
        checkbox: opts.firstDepositPaid ?? false,
      },
      "First Deposit Session Id": {
        type: "rich_text",
        rich_text: opts.firstDepositSessionId
          ? [{ plain_text: opts.firstDepositSessionId }]
          : [],
      },
      "Second Deposit Amount": {
        type: "number",
        number: opts.secondDepositAmount ?? null,
      },
      "Second Deposit Paid": {
        type: "checkbox",
        checkbox: opts.secondDepositPaid ?? false,
      },
      "Second Deposit Session Id": {
        type: "rich_text",
        rich_text: opts.secondDepositSessionId
          ? [{ plain_text: opts.secondDepositSessionId }]
          : [],
      },
      "First Deposit Due": {
        type: "date",
        date:
          opts.firstDepositDue === null || opts.firstDepositDue === undefined
            ? null
            : { start: opts.firstDepositDue, end: null },
      },
      "Second Deposit Due": {
        type: "date",
        date:
          opts.secondDepositDue === null || opts.secondDepositDue === undefined
            ? null
            : { start: opts.secondDepositDue, end: null },
      },
      "First Deposit Reminded": {
        type: "checkbox",
        checkbox: opts.firstDepositReminded ?? false,
      },
      "Second Deposit Reminded": {
        type: "checkbox",
        checkbox: opts.secondDepositReminded ?? false,
      },
      "Balance Reminded": {
        type: "checkbox",
        checkbox: opts.balanceReminded ?? false,
      },
      Order: {
        type: "relation",
        relation: opts.orderPageId ? [{ id: opts.orderPageId }] : [],
      },
    },
  };
}

/** Minimal "costing (custom orders)" page. `Labor Cost` / `Suggested Price` are
 * Notion formulas; `Material Usage Lines` is a relation. */
export function costingPage(opts: {
  id?: string;
  laborCost?: number | null;
  suggestedPrice?: number | null;
  usageLineIds?: string[];
}) {
  return {
    id: opts.id ?? "costing-page",
    properties: {
      Item: { type: "title", title: [{ plain_text: "Costing item" }] },
      "Labor Cost": {
        type: "formula",
        formula: { type: "number", number: opts.laborCost ?? null },
      },
      "Suggested Price": {
        type: "formula",
        formula: { type: "number", number: opts.suggestedPrice ?? null },
      },
      "Material Usage Lines": {
        type: "relation",
        relation: (opts.usageLineIds ?? []).map((id) => ({ id })),
      },
    },
  };
}

/** Minimal "material usage database" page. `Line Material Cost` is a Notion
 * formula; `Usage Type` is a select (Material | Packaging). */
export function materialUsagePage(opts: {
  id?: string;
  name?: string;
  materialCost?: number | null;
  usageType?: string;
}) {
  return {
    id: opts.id ?? "usage-page",
    properties: {
      "Usage Line": {
        type: "title",
        title: opts.name ? [{ plain_text: opts.name }] : [],
      },
      "Line Material Cost": {
        type: "formula",
        formula: { type: "number", number: opts.materialCost ?? null },
      },
      "Usage Type": {
        type: "select",
        select: opts.usageType ? { name: opts.usageType } : null,
      },
    },
  };
}

/** Minimal "Invoice Line Items" page. `Line Total` is a Notion formula. */
export function lineItemPage(opts: {
  id?: string;
  name?: string;
  type?: string;
  total?: number | null;
}) {
  return {
    id: opts.id ?? "line-item",
    properties: {
      "Line Item": {
        type: "title",
        title: opts.name ? [{ plain_text: opts.name }] : [],
      },
      "Line Type": {
        type: "select",
        select: opts.type ? { name: opts.type } : null,
      },
      "Line Total": {
        type: "formula",
        formula: { type: "number", number: opts.total ?? null },
      },
    },
  };
}

/**
 * Minimal Reviews page as returned by a query on the reviews database — only
 * the properties the READ side maps (`reviews.schema.ts`). Defaults are the
 * publishable combination, so a test names only the field it wants to break.
 */
export function reviewPage(opts: {
  id?: string;
  rating?: number | null;
  comment?: string;
  customerName?: string;
  orderNumber?: string;
  email?: string | null;
  emailVerified?: boolean;
  status?: string | null;
  consent?: boolean;
  createdTime?: string | null;
  url?: string | null;
  /** Inventory page ids on the `Product` relation — what makes a row a review of
   * a shop piece. Omit for a custom-order review (the property is present but
   * empty); pass `null` to model a database that has no such column at all. */
  productIds?: string[] | null;
}) {
  const rt = (value?: string) => ({
    type: "rich_text",
    rich_text: value ? [{ plain_text: value }] : [],
  });
  return {
    id: opts.id ?? "review-page",
    // `createdTime: null` models a page Notion returned without the timestamp.
    ...(opts.createdTime === null
      ? {}
      : { created_time: opts.createdTime ?? "2026-08-01T12:00:00.000Z" }),
    ...(opts.url === null
      ? {}
      : { url: opts.url ?? "https://notion.so/review-page" }),
    properties: {
      Rating: {
        type: "number",
        number: opts.rating === undefined ? 5 : opts.rating,
      },
      Review: rt(opts.comment ?? "Beautiful work."),
      "Customer Name": rt(opts.customerName),
      Status: {
        type: "select",
        select:
          opts.status === null ? null : { name: opts.status ?? "Published" },
      },
      "Consent to Publish": {
        type: "checkbox",
        checkbox: opts.consent ?? true,
      },
      // Read only by the staff (moderation) projection; the public one never
      // touches these.
      "Order Number": rt(opts.orderNumber ?? "000002"),
      Email: {
        type: "email",
        email:
          opts.email === null ? null : (opts.email ?? "skater@example.com"),
      },
      "Email Verified": {
        type: "checkbox",
        checkbox: opts.emailVerified ?? true,
      },
      ...(opts.productIds === null
        ? {}
        : {
            Product: {
              type: "relation",
              relation: (opts.productIds ?? []).map((id) => ({ id })),
            },
          }),
    },
  };
}

/**
 * A raw "Website Contact Messages" page, as the studio request queue reads one.
 *
 * Every property here is written by one of the six contact-database writers, so
 * the defaults model the commonest row the queue sees: a cancellation request
 * filed against a custom order and not yet triaged. Pass `null` to model a
 * property Notion returned empty, and omit the value to take the default.
 */
export function contactRequestPage(
  opts: {
    id?: string;
    subject?: string;
    requestType?: string | null;
    stage?: string | null;
    customerName?: string;
    email?: string | null;
    phone?: string | null;
    message?: string;
    item?: string;
    size?: string;
    createdTime?: string | null;
    url?: string | null;
  } = {},
) {
  const rt = (value?: string) => ({
    type: "rich_text",
    rich_text: value ? [{ plain_text: value }] : [],
  });
  const select = (value: string | null | undefined, fallback: string) => ({
    type: "select",
    select: value === null ? null : { name: value ?? fallback },
  });

  return {
    id: opts.id ?? "request-page",
    ...(opts.createdTime === null
      ? {}
      : { created_time: opts.createdTime ?? "2026-08-01T12:00:00.000Z" }),
    ...(opts.url === null
      ? {}
      : { url: opts.url ?? "https://notion.so/request-page" }),
    properties: {
      "Message (subject)": {
        type: "title",
        title:
          opts.subject === ""
            ? []
            : [{ plain_text: opts.subject ?? "Cancellation: ORD-000002" }],
      },
      "Request type": select(opts.requestType, "Cancellation"),
      Stage: select(opts.stage, "New"),
      "Customer name": rt(opts.customerName),
      Email: {
        type: "email",
        email:
          opts.email === null ? null : (opts.email ?? "skater@example.com"),
      },
      Phone: {
        type: "phone_number",
        phone_number: opts.phone === null ? null : (opts.phone ?? undefined),
      },
      Message: rt(
        opts.message ??
          "Cancellation requested for custom order ORD-000002.\n\nReason: —",
      ),
      Item: rt(opts.item),
      Size: rt(opts.size),
    },
  };
}
