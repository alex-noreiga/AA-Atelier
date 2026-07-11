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
export const STAGE_PROPERTY_NAME = "Stage";

/** Validated new-order payload, derived from the OpenAPI contract. */
export type CreateOrderInput = z.infer<typeof CreateOrderBody>;

/** Domain view of an order returned to the status-lookup flow. */
export interface OrderRecord {
  orderNumber: string;
  orderName: string;
  currentStage: string;
  stages: string[];
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
    Stage?: { type: "status"; status: { name: string } | null };
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
