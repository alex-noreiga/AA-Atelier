// One-time backfill of the Postgres account-portal index (`clients` +
// `order_index`) from the existing Notion orders + shop-orders databases, so
// orders placed before the index existed become discoverable in the account
// portal. Idempotent (`on conflict do nothing` / upsert-by-email), so it's safe
// to re-run to heal any best-effort write gaps.
//
// Runs OUT-OF-BAND against the DIRECT connection (bulk writes), reading Notion
// with a raw client so it stays self-contained (no app-source imports, runnable
// via `node --experimental-strip-types`):
//
//   NOTION_API_KEY=… NOTION_ORDERS_DATABASE_ID=… NOTION_SHOP_ORDERS_DATABASE_ID=… \
//   POSTGRES_URL_NON_POOLING=… pnpm --filter @workspace/api-server db:backfill
//
// Property names mirror the app constants (orders.schema.ts / shop-orders.blocks.ts
// / clients.repository.ts); keep them in sync if those are ever renamed.

import path from "node:path";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: path.resolve(import.meta.dirname, "../../../../.env") });

const NOTION_BASE = "https://api.notion.com";
const NOTION_VERSION = "2022-06-28";

type NotionPage = {
  id: string;
  properties: Record<string, unknown>;
};

function notionHeaders(): Record<string, string> {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/** Query a Notion database, following pagination. */
async function queryAll(databaseId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(`${NOTION_BASE}/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
    });
    if (!res.ok) {
      throw new Error(
        `Notion query failed (${res.status}): ${await res.text()}`,
      );
    }
    const data = (await res.json()) as {
      results: NotionPage[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    pages.push(...data.results);
    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function readRichText(prop: unknown): string {
  const p = prop as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return (p?.rich_text ?? [])
    .map((t) => t.plain_text ?? "")
    .join("")
    .trim();
}

function readEmail(prop: unknown): string {
  const p = prop as { email?: string | null } | undefined;
  return (p?.email ?? "").trim();
}

function readFirstRelationId(prop: unknown): string | null {
  const p = prop as { relation?: Array<{ id: string }> } | undefined;
  return p?.relation?.[0]?.id ?? null;
}

/** Resolve an order's email: its own Email property, else (for legacy rows) the
 * Email on its linked Client CRM page. Returns "" when neither is available. */
async function resolveEmail(
  page: NotionPage,
  emailProp: string,
  clientProp: string,
): Promise<string> {
  const direct = readEmail(page.properties[emailProp]);
  if (direct) return direct;

  const clientId = readFirstRelationId(page.properties[clientProp]);
  if (!clientId) return "";
  const res = await fetch(`${NOTION_BASE}/v1/pages/${clientId}`, {
    headers: notionHeaders(),
  });
  if (!res.ok) return "";
  const client = (await res.json()) as NotionPage;
  return readEmail(client.properties["Email"]);
}

type Sql = ReturnType<typeof postgres>;

async function upsertClient(sql: Sql, email: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into clients (email)
    values (${email})
    on conflict (email) do update set updated_at = now()
    returning id`;
  return rows[0].id;
}

async function indexOrders(
  sql: Sql,
  databaseId: string,
  kind: "custom" | "shop",
  numberProp: string,
  emailProp: string,
  clientProp: string,
): Promise<{ indexed: number; skipped: number }> {
  const pages = await queryAll(databaseId);
  let indexed = 0;
  let skipped = 0;

  for (const page of pages) {
    const orderNumber = readRichText(page.properties[numberProp]);
    const email = (
      await resolveEmail(page, emailProp, clientProp)
    ).toLowerCase();
    if (!orderNumber || !email) {
      skipped++;
      continue;
    }
    const clientId = await upsertClient(sql, email);
    await sql`
      insert into order_index
        (order_number, kind, client_id, email, notion_page_id)
      values (${orderNumber}, ${kind}, ${clientId}, ${email}, ${page.id})
      on conflict (order_number) do nothing`;
    indexed++;
  }
  return { indexed, skipped };
}

async function main(): Promise<void> {
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("Set POSTGRES_URL_NON_POOLING (or POSTGRES_URL).");
  const ordersDb = process.env.NOTION_ORDERS_DATABASE_ID;
  const shopDb = process.env.NOTION_SHOP_ORDERS_DATABASE_ID;

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    if (ordersDb) {
      const r = await indexOrders(
        sql,
        ordersDb,
        "custom",
        "Order Number",
        "Email",
        "Client",
      );
      // eslint-disable-next-line no-console
      console.log(`custom orders: indexed ${r.indexed}, skipped ${r.skipped}`);
    }
    if (shopDb) {
      const r = await indexOrders(
        sql,
        shopDb,
        "shop",
        "Order Number",
        "Customer Email",
        "Client",
      );
      // eslint-disable-next-line no-console
      console.log(`shop orders: indexed ${r.indexed}, skipped ${r.skipped}`);
    }
    if (!ordersDb && !shopDb) {
      // eslint-disable-next-line no-console
      console.log(
        "No NOTION_ORDERS_DATABASE_ID / NOTION_SHOP_ORDERS_DATABASE_ID set; nothing to backfill.",
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
