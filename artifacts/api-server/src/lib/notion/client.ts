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
let productCategoriesClient: NotionClient | null = null;
let shopOrdersClient: NotionClient | null = null;
let productionScheduleClient: NotionClient | null = null;
let clientCrmClient: NotionClient | null = null;
let invoicesClient: NotionClient | null = null;
let invoiceLineItemsClient: NotionClient | null = null;
let costingClient: NotionClient | null = null;
let materialUsageClient: NotionClient | null = null;

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
 * Client for the optional "Product Categories" database — the data-driven source
 * for which shop categories show a size chart (a "Show size guide" checkbox per
 * category). Same lazy construction, reads `NOTION_PRODUCT_CATEGORIES_DATABASE_ID`.
 * Optional: when the env var is unset the client's `databaseId` is empty, and the
 * repository treats that as "not configured" so the shop falls back to its
 * built-in sized-category list.
 */
export function getProductCategoriesNotionClient(): NotionClient {
  if (!productCategoriesClient) {
    productCategoriesClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_PRODUCT_CATEGORIES_DATABASE_ID ?? "",
    });
  }
  return productCategoriesClient;
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
 * Client for the "invoices & payments" database — one invoice per custom order,
 * holding its line-item relation, deposit status, and the balance-paid record
 * the app writes back. Same lazy construction, reads `NOTION_INVOICES_DATABASE_ID`.
 */
export function getInvoicesNotionClient(): NotionClient {
  if (!invoicesClient) {
    invoicesClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_INVOICES_DATABASE_ID ?? "",
    });
  }
  return invoicesClient;
}

/**
 * Client for the "Invoice Line Items" database — the itemized garment/material/
 * labor lines the app reads to build a customer's invoice. Same lazy
 * construction, reads `NOTION_INVOICE_LINE_ITEMS_DATABASE_ID`.
 */
export function getInvoiceLineItemsNotionClient(): NotionClient {
  if (!invoiceLineItemsClient) {
    invoiceLineItemsClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_INVOICE_LINE_ITEMS_DATABASE_ID ?? "",
    });
  }
  return invoiceLineItemsClient;
}

/**
 * Client for the "costing (custom orders)" database — one costing item per
 * garment/component, holding the labor + margin-loaded suggested price the
 * invoice generator reads to itemize an order. Same lazy construction, reads
 * `NOTION_COSTING_DATABASE_ID`.
 */
export function getCostingNotionClient(): NotionClient {
  if (!costingClient) {
    costingClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_COSTING_DATABASE_ID ?? "",
    });
  }
  return costingClient;
}

/**
 * Client for the "material usage database" — the per-material usage lines under
 * a costing item, each with its own material cost. The invoice generator reads
 * these to write one Material invoice line per usage line. Same lazy
 * construction, reads `NOTION_MATERIAL_USAGE_DATABASE_ID`.
 */
export function getMaterialUsageNotionClient(): NotionClient {
  if (!materialUsageClient) {
    materialUsageClient = createNotionClient({
      apiKey: process.env.NOTION_API_KEY ?? "",
      databaseId: process.env.NOTION_MATERIAL_USAGE_DATABASE_ID ?? "",
    });
  }
  return materialUsageClient;
}
