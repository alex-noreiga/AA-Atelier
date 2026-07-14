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

/** Read the customer email off an order page (empty for pre-Email orders). */
export function extractOrderEmail(page: NotionOrderPage): string {
  return page.properties[ORDER_EMAIL_PROPERTY]?.email ?? "";
}
