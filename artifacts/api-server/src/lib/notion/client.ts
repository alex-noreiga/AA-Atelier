// Thin Notion REST client. Config (API key + orders database id) is read at
// composition time rather than at module load, so the client is injectable for
// testing and the server can import this module without requiring credentials.
//
// Auth: the atelier's `NOTION_API_KEY` and `NOTION_ORDERS_DATABASE_ID` come
// from environment variables. Get a key at https://www.notion.so/my-integrations

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE_URL = "https://api.notion.com";

interface NotionClientConfig {
  apiKey: string;
  databaseId: string;
}

export interface NotionClient {
  readonly databaseId: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

function createNotionClient(config: NotionClientConfig): NotionClient {
  const { apiKey, databaseId } = config;

  return {
    databaseId,
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      if (!apiKey) {
        throw new Error("NOTION_API_KEY environment variable is not set");
      }
      return fetch(`${NOTION_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
    },
  };
}

let defaultClient: NotionClient | null = null;
let contactClient: NotionClient | null = null;
let inventoryClient: NotionClient | null = null;
let shopOrdersClient: NotionClient | null = null;
let productionScheduleClient: NotionClient | null = null;
let clientCrmClient: NotionClient | null = null;
let orderFormSubmissionsClient: NotionClient | null = null;

/**
 * Lazily-constructed client reading credentials from the environment. Deferring
 * construction to first use keeps env reads out of module load and lets tests
 * inject their own client before this is ever called.
 */
export function getNotionClient(): NotionClient {
  if (!defaultClient) {
    defaultClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_ORDERS_DATABASE_ID ?? "",
    });
  }
  return defaultClient;
}

/**
 * Client for the separate "Website Contact Messages" database. Same lazy
 * construction as `getNotionClient`, but reads `NOTION_CONTACT_DATABASE_ID`.
 */
export function getContactNotionClient(): NotionClient {
  if (!contactClient) {
    contactClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_CONTACT_DATABASE_ID ?? "",
    });
  }
  return contactClient;
}

/**
 * Client for the finished-goods "inventory" database that feeds the shop's
 * ready-to-ship section. Same lazy construction, reads
 * `NOTION_INVENTORY_DATABASE_ID`.
 */
export function getInventoryNotionClient(): NotionClient {
  if (!inventoryClient) {
    inventoryClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_INVENTORY_DATABASE_ID ?? "",
    });
  }
  return inventoryClient;
}

/**
 * Client for the "Shop Orders" database that records paid shop checkouts. Same
 * lazy construction, reads `NOTION_SHOP_ORDERS_DATABASE_ID`.
 */
export function getShopOrdersNotionClient(): NotionClient {
  if (!shopOrdersClient) {
    shopOrdersClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_SHOP_ORDERS_DATABASE_ID ?? "",
    });
  }
  return shopOrdersClient;
}

/**
 * Client for the "📅 Production Schedule" database that holds the per-stage
 * milestone rows generated from an order's due date. Same lazy construction,
 * reads `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`.
 */
export function getProductionScheduleNotionClient(): NotionClient {
  if (!productionScheduleClient) {
    productionScheduleClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_PRODUCTION_SCHEDULE_DATABASE_ID ?? "",
    });
  }
  return productionScheduleClient;
}

/**
 * Client for the "Client CRM" database. Same lazy construction, reads
 * `NOTION_CLIENT_CRM_DATABASE_ID`. This one is optional: when the env var is
 * unset the client's `databaseId` is empty, and the CRM upsert (see
 * `clients.repository.ts`) treats that as "skip" so orders behave as before.
 */
export function getClientCrmNotionClient(): NotionClient {
  if (!clientCrmClient) {
    clientCrmClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_CLIENT_CRM_DATABASE_ID ?? "",
    });
  }
  return clientCrmClient;
}

/**
 * Client for the "Order Form Submissions" hub database — the Notion intake row
 * that links an order to the atelier's back office (costing, invoicing,
 * production, materials, design). Same lazy construction, reads
 * `NOTION_ORDER_FORM_SUBMISSIONS_DATABASE_ID`. Optional: when the env var is
 * unset the client's `databaseId` is empty, and the hub linker (see
 * `order-form-submissions.repository.ts`) treats that as "skip" so a website
 * order is created exactly as before until the env var is configured.
 */
export function getOrderFormSubmissionsNotionClient(): NotionClient {
  if (!orderFormSubmissionsClient) {
    orderFormSubmissionsClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_ORDER_FORM_SUBMISSIONS_DATABASE_ID ?? "",
    });
  }
  return orderFormSubmissionsClient;
}
