// Notion database schema mapping.
//
// Two hard-won lessons are encoded here (see `.agents/memory/`):
//   1. Property *types* must match the live Notion schema, not the name.
//      "Order Number" is a `rich_text` property (values have leading zeros
//      like "000002"), NOT a `number`.
//   2. The stage/status option list is edited live in Notion — never hardcode
//      it. `extractStageOptions` reads it from the database schema.
//
// All property-name string literals live here so a Notion schema rename is a
// one-line change rather than a scatter-hunt across the codebase.

import type { z } from "zod";
import type { CreateOrderBody } from "@workspace/api-zod";
import type { InvoiceView } from "./invoice.schema.js";

export const ORDER_NAME_PROPERTY = "Order Name";
export const ORDER_NUMBER_PROPERTY = "Order Number";
// The customer's email, stored as a Notion `email` property so it can be read
// back to verify a measurement-change request (order lookup itself never
// exposes it). Orders created before this property existed read back empty.
export const ORDER_EMAIL_PROPERTY = "Email";
const STAGE_PROPERTY_NAME = "Stage";
// Deposit properties the atelier sets on a custom order after quoting it. The
// customer pays the deposit from the status page; the Stripe webhook marks it
// paid. Property *types* must match the live Notion schema (see lessons above).
export const ORDER_DEPOSIT_AMOUNT_PROPERTY = "Deposit Amount"; // number (dollars)
export const ORDER_DEPOSIT_PAID_PROPERTY = "Deposit Paid"; // checkbox
export const ORDER_DEPOSIT_SESSION_PROPERTY = "Deposit Session Id"; // rich_text
// The second (progress) deposit, tracked on the order alongside the first. Both
// are credited against the invoice balance (see invoice.service.ts). Only the
// amount + paid flag are read here — the second deposit isn't collected online.
export const ORDER_DEPOSIT2_AMOUNT_PROPERTY = "Deposit 2 Amount"; // number (dollars)
export const ORDER_DEPOSIT2_PAID_PROPERTY = "Deposit 2 Paid"; // checkbox
// Order-side record of a paid invoice balance. The Stripe webhook sets these
// (mirroring the deposit trio) when the customer pays the final balance.
export const ORDER_INVOICE_PAID_PROPERTY = "Invoice Paid"; // checkbox
export const ORDER_INVOICE_SESSION_PROPERTY = "Invoice Session Id"; // rich_text
// Relation to the order's invoice in the "invoices & payments" database (limit 1
// in Notion, so at most one). The invoice flow follows this to read/write it.
export const ORDER_INVOICES_RELATION_PROPERTY = "Invoices"; // relation → invoices
// The delivery/competition target the atelier sets on a custom order once it's
// quoted and scheduled. Drives the per-stage production milestones (see
// schedule.service.ts). `Milestones Generated` is the idempotency marker the
// reconciliation cron flips once an order's milestones exist.
export const ORDER_DUE_DATE_PROPERTY = "Due Date"; // date
export const ORDER_MILESTONES_GENERATED_PROPERTY = "Milestones Generated"; // checkbox
// Relation to the Client CRM database (the synced end of the CRM's "Orders"
// dual relation). Set on order create when a client record was upserted, so the
// order lands against a durable customer record. See `clients.repository.ts`.
export const ORDER_CLIENT_PROPERTY = "Client"; // relation → Client CRM

/** Validated new-order payload, derived from the OpenAPI contract. */
export type CreateOrderInput = z.infer<typeof CreateOrderBody>;

/** Domain view of an order returned to the status-lookup flow. */
export interface OrderRecord {
  orderNumber: string;
  orderName: string;
  currentStage: string;
  stages: string[];
  /** Present once the atelier has set a deposit on the order. */
  depositAmount?: number;
  /** Whether the deposit has been paid. */
  depositPaid?: boolean;
  /** Present once the atelier has set a second (progress) deposit. */
  deposit2Amount?: number;
  /** Whether the second deposit has been paid. */
  deposit2Paid?: boolean;
  /** The order's Notion page id — needed to query/write its invoice. Stripped
   * from the HTTP response by the `GetOrderStatusResponse` zod parse. */
  pageId?: string;
  /** The linked invoice's Notion page id, or undefined when no invoice exists. */
  invoicePageId?: string;
  /** The customer-facing invoice, attached by `getOrderStatus` only once the
   * invoice exists and the atelier has flipped "Invoice Ready". */
  invoice?: InvoiceView;
}

interface NotionStatusOption {
  id: string;
  name: string;
}

export interface NotionDatabaseSchema {
  properties: Record<
    string,
    {
      type: string;
      status?: { options: NotionStatusOption[] };
    }
  >;
}

export interface NotionOrderPage {
  id: string;
  properties: {
    "Order Number"?: {
      type: "rich_text";
      rich_text: Array<{ plain_text: string }>;
    };
    "Order Name"?: { type: "title"; title: Array<{ plain_text: string }> };
    Email?: { type: "email"; email: string | null };
    // TODO(measurements-b): add the five measurement `number` properties + a
    // unit `select` here once they migrate off body blocks, so a direct edit
    // can read them back and `PATCH /v1/pages/{id}` can update them in place.
    Stage?: { type: "status"; status: { name: string } | null };
    "Deposit Amount"?: { type: "number"; number: number | null };
    "Deposit Paid"?: { type: "checkbox"; checkbox: boolean };
    "Deposit 2 Amount"?: { type: "number"; number: number | null };
    "Deposit 2 Paid"?: { type: "checkbox"; checkbox: boolean };
    Invoices?: { type: "relation"; relation: Array<{ id: string }> };
    "Due Date"?: {
      type: "date";
      date: { start: string; end: string | null } | null;
    };
    "Milestones Generated"?: { type: "checkbox"; checkbox: boolean };
  };
}

export interface NotionQueryResponse {
  results: NotionOrderPage[];
}

/** Read the live "Stage" status options from a fetched database schema. */
export function extractStageOptions(schema: NotionDatabaseSchema): string[] {
  return (
    schema.properties[STAGE_PROPERTY_NAME]?.status?.options.map(
      (option) => option.name,
    ) ?? []
  );
}

export function extractOrderNumber(page: NotionOrderPage): string {
  return (
    page.properties[ORDER_NUMBER_PROPERTY]?.rich_text
      ?.map((t) => t.plain_text)
      .join("") ?? ""
  );
}

export function extractOrderName(page: NotionOrderPage): string {
  return (
    page.properties[ORDER_NAME_PROPERTY]?.title
      ?.map((t) => t.plain_text)
      .join("") ?? ""
  );
}

export function extractCurrentStage(page: NotionOrderPage): string {
  return page.properties[STAGE_PROPERTY_NAME]?.status?.name ?? "";
}

/** The deposit amount (dollars), or undefined when the atelier hasn't set one. */
export function extractDepositAmount(
  page: NotionOrderPage,
): number | undefined {
  const property = page.properties[ORDER_DEPOSIT_AMOUNT_PROPERTY];
  if (property?.type !== "number" || typeof property.number !== "number") {
    return undefined;
  }
  return property.number;
}

/** Whether the deposit checkbox is ticked. */
export function extractDepositPaid(page: NotionOrderPage): boolean {
  const property = page.properties[ORDER_DEPOSIT_PAID_PROPERTY];
  return property?.type === "checkbox" ? property.checkbox : false;
}

/** The second deposit amount (dollars), or undefined when the atelier hasn't set one. */
export function extractDeposit2Amount(
  page: NotionOrderPage,
): number | undefined {
  const property = page.properties[ORDER_DEPOSIT2_AMOUNT_PROPERTY];
  if (property?.type !== "number" || typeof property.number !== "number") {
    return undefined;
  }
  return property.number;
}

/** Whether the second-deposit checkbox is ticked. */
export function extractDeposit2Paid(page: NotionOrderPage): boolean {
  const property = page.properties[ORDER_DEPOSIT2_PAID_PROPERTY];
  return property?.type === "checkbox" ? property.checkbox : false;
}

/** The linked invoice's page id (the `Invoices` relation is limit-1 in Notion),
 * or undefined when the order has no invoice yet. */
export function extractInvoiceRelationId(
  page: NotionOrderPage,
): string | undefined {
  const property = page.properties[ORDER_INVOICES_RELATION_PROPERTY];
  if (property?.type !== "relation") return undefined;
  return property.relation[0]?.id;
}

/** Read the customer email off an order page (empty for pre-Email orders). */
export function extractOrderEmail(page: NotionOrderPage): string {
  return page.properties[ORDER_EMAIL_PROPERTY]?.email ?? "";
}

/** The order's due date (ISO `start`), or undefined when the atelier hasn't set one. */
export function extractDueDate(page: NotionOrderPage): string | undefined {
  const property = page.properties[ORDER_DUE_DATE_PROPERTY];
  if (property?.type !== "date" || !property.date?.start) {
    return undefined;
  }
  return property.date.start;
}

/** Whether an order's milestones have already been generated. */
export function extractMilestonesGenerated(page: NotionOrderPage): boolean {
  const property = page.properties[ORDER_MILESTONES_GENERATED_PROPERTY];
  return property?.type === "checkbox" ? property.checkbox : false;
}
