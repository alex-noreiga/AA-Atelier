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
import type { StageMilestone } from "./production-schedule.blocks.js";
import type { InvoiceView, InvoiceDepositView } from "./invoice.schema.js";

export const ORDER_NAME_PROPERTY = "Order Name";
export const ORDER_NUMBER_PROPERTY = "Order Number";
// The customer's email, stored as a Notion `email` property so it can be read
// back to verify a measurement-change request (order lookup itself never
// exposes it). Orders created before this property existed read back empty.
export const ORDER_EMAIL_PROPERTY = "Email";
const STAGE_PROPERTY_NAME = "Stage";
// Relation to the order's invoice in the "invoices & payments" database (limit 1
// in Notion, so at most one). The invoice is the source of truth for everything
// the customer pays online (both deposits + the balance); the invoice flow
// follows this relation to read/write it. See `invoice.service.ts`.
export const ORDER_INVOICES_RELATION_PROPERTY = "Invoices"; // relation → invoices
// Relation to the order's costing items ("costing (custom orders)" database).
// The invoice generator follows this to itemize the order — each costing item
// contributes its material usage lines + labor + margin. See
// `services/invoice-generator.service.ts`.
export const ORDER_COSTING_ITEMS_RELATION_PROPERTY = "Costing Items"; // relation → costing
// The delivery/competition target the atelier sets on a custom order once it's
// quoted and scheduled. Drives the per-stage production milestones (see
// schedule.service.ts). `Milestones Generated` is the idempotency marker the
// reconciliation cron flips once an order's milestones exist.
export const ORDER_DUE_DATE_PROPERTY = "Due Date"; // date
export const ORDER_MILESTONES_GENERATED_PROPERTY = "Milestones Generated"; // checkbox
// Set when the customer confirmed a rush order at intake (a neededBy date inside
// the studio's rush window, acknowledged with the disclosed surcharge). It's a
// flag for the atelier — the app never prices the fee; the atelier adds a
// "Surcharge" invoice line, which flows into the balance. See `orders.blocks.ts`.
export const ORDER_RUSH_PROPERTY = "Rush Order"; // checkbox
// The furthest stage the customer has been emailed about, stored as a rich_text
// marker so the status-change webhook only notifies on FORWARD movement — a
// backward stage edit (a correction/rework) or a re-fire must not email. Empty
// for orders that predate this or haven't been notified yet. Written after a
// notification is sent. See `services/order-notification.service.ts`.
export const ORDER_LAST_NOTIFIED_STAGE_PROPERTY = "Last Notified Stage"; // rich_text
// Relation to the Client CRM database (the synced end of the CRM's "Orders"
// dual relation). Set on order create when a client record was upserted, so the
// order lands against a durable customer record. See `clients.repository.ts`.
export const ORDER_CLIENT_PROPERTY = "Client"; // relation → Client CRM
// Set by the cancellation-refund flow when the atelier processes a cancellation
// (`setOrderCancelled`). An additive marker (absent ⇒ false), like `Rush Order`
// / `Milestones Generated`: the app reads it back to surface a cancelled state
// on the tracking page and suppress payment CTAs. See
// `services/order-cancellation.service.ts`.
export const ORDER_CANCELLED_PROPERTY = "Cancelled"; // checkbox
// The customer's measurements, stored as typed properties (five `number`s + a
// unit `select`) so they can be read back for the account portal — the resolution
// of the old `TODO(measurements-b)`. They're ALSO rendered as page-body blocks
// (see `orders.blocks.ts`) for the atelier's at-a-glance page view; both are
// written once from the same intake data, so they don't drift. `Chest` maps to the
// contract's `bust` field (the intake label was neutralized to "Chest"). Orders
// placed before these properties existed have their measurements only in the body
// blocks, so they read back empty here.
export const ORDER_WAIST_PROPERTY = "Waist"; // number
export const ORDER_BUST_PROPERTY = "Chest"; // number (contract field: bust)
export const ORDER_HIPS_PROPERTY = "Hips"; // number
export const ORDER_HEIGHT_PROPERTY = "Height"; // number
export const ORDER_BODY_GIRTH_PROPERTY = "Body Girth"; // number
export const ORDER_MEASUREMENT_UNIT_PROPERTY = "Measurement Unit"; // select (inches | cm)
// The customer's color choices from the order form, stored so the atelier sees
// them on the order (write-only — the app never reads these back). `Colors` is a
// multi_select of the picked palette color names (filterable); `Color Usage` is
// the free-text note on how they'd like those colors used. Exact fabric + finish
// is finalized at consultation, so only these two are captured at intake. Written
// only when the customer supplied them.
export const ORDER_COLORS_PROPERTY = "Colors"; // multi_select
export const ORDER_COLOR_USAGE_PROPERTY = "Color Usage"; // rich_text

/** Validated new-order payload, derived from the OpenAPI contract. */
export type CreateOrderInput = z.infer<typeof CreateOrderBody>;

/** Domain view of an order returned to the status-lookup flow. */
export interface OrderRecord {
  orderNumber: string;
  orderName: string;
  currentStage: string;
  stages: string[];
  /** The order's Due Date (ISO yyyy-mm-dd), the atelier's target completion
   * date. Present once the atelier has set one in Notion. */
  estimatedCompletion?: string;
  /** The order's Notion page id — needed to query related milestones + invoice.
   * Stripped from the HTTP response by the `GetOrderStatusResponse` zod parse. */
  pageId?: string;
  /** The linked invoice's Notion page id, or undefined when no invoice exists. */
  invoicePageId?: string;
  /** Page ids of the order's costing items (`Costing Items` relation) — the
   * invoice generator itemizes from these. Empty when none are linked.
   * Stripped from the HTTP response by the `GetOrderStatusResponse` zod parse. */
  costingItemIds?: string[];
  /** True when the customer confirmed a rush order at intake (the `Rush Order`
   * checkbox). The invoice generator adds a priced rush surcharge line for these.
   * Stripped from the HTTP response by the `GetOrderStatusResponse` zod parse. */
  rush?: boolean;
  /** True once the atelier has cancelled the order (the `Cancelled` checkbox).
   * Surfaced in the status response so the tracking page shows a cancelled
   * banner and suppresses the payment/request affordances. */
  cancelled?: boolean;
}

/** The measurements on file for an order, read from its Notion properties.
 * Individual values are optional so a partially-filled order still maps; the
 * whole object is absent when the customer chose to be measured at a fitting (or
 * for an order predating the measurement properties). Matches the contract's
 * `AccountMeasurements`. */
export interface OrderMeasurements {
  unit: "inches" | "cm";
  waist?: number;
  bust?: number;
  hips?: number;
  height?: number;
  bodyGirth?: number;
}

/** A lightweight custom-order view for the account dashboard — the fields a
 * summary card needs, with none of the per-order milestone/invoice fan-out
 * `getOrderStatus` does. `stages` is the live ordered list so the card can show
 * progress (e.g. "stage 3 of 6"). */
export interface OrderSummary {
  orderNumber: string;
  orderName: string;
  currentStage: string;
  stages: string[];
  estimatedCompletion?: string;
  /** The customer's measurements, when stored as readable properties. Absent for
   * measure-at-fitting orders and orders that predate the measurement properties. */
  measurements?: OrderMeasurements;
}

/** The status-lookup response: the raw record plus the derived production-lock
 * flag, the per-stage milestone dates the timeline renders, the staged deposits,
 * and (when ready) the customer-facing invoice — all sourced from the invoice. */
export interface OrderStatusResult extends OrderRecord {
  measurementsLocked: boolean;
  /** Per-stage target dates, once the atelier's milestones have been generated. */
  milestones?: StageMilestone[];
  /** The staged deposits (first, then second) the customer can pay online,
   * sourced from the invoice. Present once the atelier has set a deposit amount. */
  deposits?: InvoiceDepositView[];
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
    // The five measurement values + unit, stored as typed properties so the
    // account portal can read them back (the old TODO(measurements-b), now done).
    Waist?: { type: "number"; number: number | null };
    Chest?: { type: "number"; number: number | null };
    Hips?: { type: "number"; number: number | null };
    Height?: { type: "number"; number: number | null };
    "Body Girth"?: { type: "number"; number: number | null };
    "Measurement Unit"?: { type: "select"; select: { name: string } | null };
    Stage?: { type: "status"; status: { name: string } | null };
    Invoices?: { type: "relation"; relation: Array<{ id: string }> };
    "Costing Items"?: { type: "relation"; relation: Array<{ id: string }> };
    "Due Date"?: {
      type: "date";
      date: { start: string; end: string | null } | null;
    };
    "Milestones Generated"?: { type: "checkbox"; checkbox: boolean };
    "Rush Order"?: { type: "checkbox"; checkbox: boolean };
    Cancelled?: { type: "checkbox"; checkbox: boolean };
    "Last Notified Stage"?: {
      type: "rich_text";
      rich_text: Array<{ plain_text: string }>;
    };
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

/** The linked invoice's page id (the `Invoices` relation is limit-1 in Notion),
 * or undefined when the order has no invoice yet. */
export function extractInvoiceRelationId(
  page: NotionOrderPage,
): string | undefined {
  const property = page.properties[ORDER_INVOICES_RELATION_PROPERTY];
  if (property?.type !== "relation") return undefined;
  return property.relation[0]?.id;
}

/** The page ids of the order's costing items (`Costing Items` relation), or an
 * empty array when none are linked. */
export function extractCostingItemIds(page: NotionOrderPage): string[] {
  const property = page.properties[ORDER_COSTING_ITEMS_RELATION_PROPERTY];
  if (property?.type !== "relation") return [];
  return property.relation.map((r) => r.id);
}

/** Read the customer email off an order page (empty for pre-Email orders). */
export function extractOrderEmail(page: NotionOrderPage): string {
  return page.properties[ORDER_EMAIL_PROPERTY]?.email ?? "";
}

/** A Notion `number` property's value, or undefined when unset/blank. */
function readNumberProp(
  property: { type: "number"; number: number | null } | undefined,
): number | undefined {
  return property?.type === "number" && property.number !== null
    ? property.number
    : undefined;
}

/**
 * Read the customer's measurements off an order page. Returns undefined when no
 * measurement value is set — a measure-at-fitting order, or one that predates the
 * measurement properties (whose values live only in the page body). Unit defaults
 * to inches when values are present but the unit select is somehow blank.
 */
export function extractMeasurements(
  page: NotionOrderPage,
): OrderMeasurements | undefined {
  const waist = readNumberProp(page.properties[ORDER_WAIST_PROPERTY]);
  const bust = readNumberProp(page.properties[ORDER_BUST_PROPERTY]);
  const hips = readNumberProp(page.properties[ORDER_HIPS_PROPERTY]);
  const height = readNumberProp(page.properties[ORDER_HEIGHT_PROPERTY]);
  const bodyGirth = readNumberProp(page.properties[ORDER_BODY_GIRTH_PROPERTY]);

  if (
    waist === undefined &&
    bust === undefined &&
    hips === undefined &&
    height === undefined &&
    bodyGirth === undefined
  ) {
    return undefined;
  }

  const unitProperty = page.properties[ORDER_MEASUREMENT_UNIT_PROPERTY];
  const unitName =
    unitProperty?.type === "select" ? unitProperty.select?.name : undefined;
  const unit: OrderMeasurements["unit"] = unitName === "cm" ? "cm" : "inches";

  return {
    unit,
    ...(waist !== undefined ? { waist } : {}),
    ...(bust !== undefined ? { bust } : {}),
    ...(hips !== undefined ? { hips } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(bodyGirth !== undefined ? { bodyGirth } : {}),
  };
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

/** Whether the order was flagged as a rush order at intake. */
export function extractRush(page: NotionOrderPage): boolean {
  const property = page.properties[ORDER_RUSH_PROPERTY];
  return property?.type === "checkbox" ? property.checkbox : false;
}

/** Whether the atelier has cancelled the order (the `Cancelled` checkbox). */
export function extractCancelled(page: NotionOrderPage): boolean {
  const property = page.properties[ORDER_CANCELLED_PROPERTY];
  return property?.type === "checkbox" ? property.checkbox : false;
}

/** The furthest stage the customer has been emailed about (empty when never
 * notified / the property doesn't exist), used to gate status-change emails to
 * forward movement only. */
export function extractLastNotifiedStage(page: NotionOrderPage): string {
  return (
    page.properties[ORDER_LAST_NOTIFIED_STAGE_PROPERTY]?.rich_text
      ?.map((t) => t.plain_text)
      .join("") ?? ""
  );
}
