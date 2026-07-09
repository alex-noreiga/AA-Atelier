// Notion integration (connector: notion) — https://developers.notion.com/reference/intro
// Uses the Replit connectors proxy for authenticated requests. Never cache the client;
// tokens can expire and refresh, so a fresh proxy fetch is created per call.
import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

const NOTION_VERSION = "2022-06-28";

export const ORDERS_DATABASE_ID = process.env.NOTION_ORDERS_DATABASE_ID ?? "";

const STAGE_PROPERTY_NAME = "Stage";

interface NotionStatusOption {
  id: string;
  name: string;
}

interface NotionDatabaseSchema {
  properties: Record<
    string,
    {
      type: string;
      status?: { options: NotionStatusOption[] };
    }
  >;
}

let cachedStages: { stages: string[]; fetchedAt: number } | null = null;
const STAGE_CACHE_TTL_MS = 60_000;

async function fetchLiveOrderStages(): Promise<string[]> {
  if (cachedStages && Date.now() - cachedStages.fetchedAt < STAGE_CACHE_TTL_MS) {
    return cachedStages.stages;
  }

  const response = await notionProxy(`/v1/databases/${ORDERS_DATABASE_ID}`);
  if (!response.ok) {
    if (cachedStages) {
      // Serve the last known-good list rather than failing the whole lookup
      // if Notion is briefly unreachable.
      return cachedStages.stages;
    }
    throw new Error(
      `Notion database schema fetch failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as NotionDatabaseSchema;
  const stageProperty = data.properties[STAGE_PROPERTY_NAME];
  const stages = stageProperty?.status?.options.map((option) => option.name) ?? [];

  cachedStages = { stages, fetchedAt: Date.now() };
  return stages;
}

interface NotionOrderPage {
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

interface NotionQueryResponse {
  results: NotionOrderPage[];
}

export interface OrderRecord {
  orderNumber: string;
  orderName: string;
  currentStage: string;
  stages: string[];
}

async function notionProxy(path: string, init?: RequestInit): Promise<Response> {
  return connectors.proxy("notion", path, {
    method: init?.method ?? "GET",
    headers: {
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: init?.body,
  });
}

export interface NewOrderData {
  fullName: string;
  email: string;
  phone: string;
  preferredContact: "email" | "phone" | "text";
  waist: number;
  bust: number;
  hips: number;
  height: number;
  bodyGirth: number;
  measurementUnit: "inches" | "cm";
  imageUrls?: string[];
  description?: string;
  neededBy?: Date;
}

function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${timestamp}-${random}`;
}

function textBlock(label: string, value: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { type: "text", text: { content: `${label}: ` }, annotations: { bold: true } },
        { type: "text", text: { content: value } },
      ],
    },
  };
}

function headingBlock(text: string) {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: text } }],
    },
  };
}

function dividerBlock() {
  return { object: "block", type: "divider", divider: {} };
}

export async function createOrder(data: NewOrderData): Promise<string> {
  if (!ORDERS_DATABASE_ID) {
    throw new Error(
      "NOTION_ORDERS_DATABASE_ID is not configured for the orders database",
    );
  }

  const orderNumber = generateOrderNumber();
  const unit = data.measurementUnit;

  const properties: Record<string, unknown> = {
    "Order Name": {
      title: [{ text: { content: `${data.fullName} – Custom Dress` } }],
    },
    "Order Number": {
      rich_text: [{ text: { content: orderNumber } }],
    },
  };

  const contactSection = [
    headingBlock("Contact Information"),
    textBlock("Full Name", data.fullName),
    textBlock("Email", data.email),
    textBlock("Phone", data.phone),
    textBlock("Preferred Contact", data.preferredContact),
    dividerBlock(),
  ];

  const measurementSection = [
    headingBlock(`Measurements (${unit})`),
    textBlock("Waist", String(data.waist)),
    textBlock("Bust", String(data.bust)),
    textBlock("Hips", String(data.hips)),
    textBlock("Height", String(data.height)),
    textBlock("Body Girth", String(data.bodyGirth)),
    dividerBlock(),
  ];

  const dressSection: unknown[] = [headingBlock("Dress Details")];
  if (data.description) {
    dressSection.push(textBlock("Description", data.description));
  }
  if (data.neededBy) {
    const dateStr =
      data.neededBy instanceof Date
        ? data.neededBy.toISOString().split("T")[0]
        : String(data.neededBy);
    dressSection.push(textBlock("Needed By", dateStr));
  }
  dressSection.push(dividerBlock());

  const imageBlocks =
    data.imageUrls && data.imageUrls.length > 0
      ? [
          headingBlock("Inspiration Images"),
          ...data.imageUrls.map((url) => ({
            object: "block",
            type: "image",
            image: { type: "external", external: { url } },
          })),
        ]
      : [];

  const children = [
    ...contactSection,
    ...measurementSection,
    ...dressSection,
    ...imageBlocks,
  ];

  const body: Record<string, unknown> = {
    parent: { database_id: ORDERS_DATABASE_ID },
    properties,
    children,
  };

  const response = await notionProxy("/v1/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion page creation failed with status ${response.status}: ${errorText}`,
    );
  }

  return orderNumber;
}

export async function findOrderByNumber(
  orderNumber: string,
): Promise<OrderRecord | null> {
  if (!ORDERS_DATABASE_ID) {
    throw new Error(
      "NOTION_ORDERS_DATABASE_ID is not configured for the orders database",
    );
  }

  const trimmedOrderNumber = orderNumber.trim();
  if (!trimmedOrderNumber) {
    return null;
  }

  const [response, stages] = await Promise.all([
    notionProxy(`/v1/databases/${ORDERS_DATABASE_ID}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: "Order Number",
          rich_text: { equals: trimmedOrderNumber },
        },
        page_size: 1,
      }),
    }),
    fetchLiveOrderStages(),
  ]);

  if (!response.ok) {
    throw new Error(`Notion query failed with status ${response.status}`);
  }

  const data = (await response.json()) as NotionQueryResponse;
  const page = data.results[0];
  if (!page) {
    return null;
  }

  const orderName =
    page.properties["Order Name"]?.title?.map((t) => t.plain_text).join("") ??
    "";
  const currentStage = page.properties.Stage?.status?.name ?? "";

  return {
    orderNumber: trimmedOrderNumber,
    orderName,
    currentStage,
    stages,
  };
}
