// One-time backfill of legacy Notion order rows so history stops being stranded
// (roadmap: "Backfill legacy rows so history isn't stranded"). Two gaps:
//
//   1. Custom orders placed before the typed `Email` + measurement properties
//      existed have that data only in the page BODY (buildOrderPageBlocks writes
//      "Email: …" and a "Measurements (unit)" section as paragraphs). Those rows
//      read back empty for the account portal / measurement history and the
//      email-verified request gates. This recovers the values from the body
//      blocks and stamps them onto the typed properties.
//   2. Shop orders placed before the `SHP-` number was minted have no `Order
//      Number`, so `findShopOrdersByEmail` drops them from the account portal.
//      This stamps a deterministic `SHP-LEGACY-…` number (derived from the page
//      id, so it's stable + idempotent) to make them discoverable.
//
// Idempotent: a field is only written when it's currently empty, so re-running
// heals gaps without clobbering anything. Runs OUT-OF-BAND with a raw Notion
// client so it stays self-contained (no app-source imports, runnable via
// `node --experimental-strip-types`). Pass `--dry-run` to log what WOULD change
// without writing:
//
//   NOTION_API_KEY=… NOTION_ORDERS_DATABASE_ID=… NOTION_SHOP_ORDERS_DATABASE_ID=… \
//   pnpm --filter @workspace/api-server db:backfill-legacy -- --dry-run
//
// Property names + body labels mirror the app constants (orders.schema.ts /
// orders.blocks.ts / shop-orders.blocks.ts); keep them in sync if renamed.

import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(import.meta.dirname, "../../../../.env") });

const NOTION_BASE = "https://api.notion.com";
const NOTION_VERSION = "2022-06-28";
const DRY_RUN = process.argv.includes("--dry-run");

// Typed properties on the Custom Orders database (orders.schema.ts).
const ORDER_NUMBER_PROPERTY = "Order Number"; // rich_text
const ORDER_EMAIL_PROPERTY = "Email"; // email
const MEASUREMENT_NUMBER_PROPERTIES = [
  "Waist",
  "Chest",
  "Hips",
  "Height",
  "Body Girth",
] as const;
const ORDER_MEASUREMENT_UNIT_PROPERTY = "Measurement Unit"; // select
// Body-block labels (orders.blocks.ts). "Chest" maps to the `bust` value; the
// body writes it under the "Chest" label, so label === property name here.
const BODY_EMAIL_LABEL = "Email";
const SHOP_ORDER_NUMBER_PROPERTY = "Order Number"; // rich_text (shop orders)

type NotionPage = { id: string; properties: Record<string, unknown> };
type NotionBlock = { type: string } & Record<string, unknown>;

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

/** Read a page's top-level body blocks, following pagination. */
async function readBlocks(pageId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${NOTION_BASE}/v1/blocks/${pageId}/children`);
    url.searchParams.set("page_size", "100");
    if (cursor) url.searchParams.set("start_cursor", cursor);
    const res = await fetch(url, { headers: notionHeaders() });
    if (!res.ok) {
      throw new Error(`Notion blocks read failed (${res.status})`);
    }
    const data = (await res.json()) as {
      results: NotionBlock[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
    blocks.push(...data.results);
    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

/** The plain text of any block that carries a `rich_text` array (paragraph /
 * heading_2), joined. */
function blockText(block: NotionBlock): string {
  const body = block[block.type] as
    { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return (body?.rich_text ?? [])
    .map((t) => t.plain_text ?? "")
    .join("")
    .trim();
}

function readEmail(prop: unknown): string {
  return ((prop as { email?: string | null })?.email ?? "").trim();
}
function readRichText(prop: unknown): string {
  const p = prop as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return (p?.rich_text ?? [])
    .map((t) => t.plain_text ?? "")
    .join("")
    .trim();
}
function readNumber(prop: unknown): number | null {
  const n = (prop as { number?: number | null })?.number;
  return typeof n === "number" ? n : null;
}

/** Parse the "Label: value" body paragraphs + the "Measurements (unit)" heading
 * that `buildOrderPageBlocks` writes, into a label→value map (+ the unit). */
function parseOrderBody(blocks: NotionBlock[]): {
  values: Map<string, string>;
  unit: string | null;
} {
  const values = new Map<string, string>();
  let unit: string | null = null;
  for (const block of blocks) {
    const text = blockText(block);
    if (!text) continue;
    if (block.type === "heading_2") {
      const m = text.match(/^Measurements\s*\(([^)]+)\)/i);
      if (m) unit = m[1].trim();
      continue;
    }
    const idx = text.indexOf(": ");
    if (idx > 0)
      values.set(text.slice(0, idx).trim(), text.slice(idx + 2).trim());
  }
  return { values, unit };
}

/** Deterministic, stable legacy shop-order number from the page id (idempotent
 * — the same page always yields the same number). */
function legacyShopOrderNumber(pageId: string): string {
  return `SHP-LEGACY-${pageId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

async function patchProperties(
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  if (DRY_RUN) return;
  const res = await fetch(`${NOTION_BASE}/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    throw new Error(
      `Notion page update failed (${res.status}): ${await res.text()}`,
    );
  }
}

async function backfillCustomOrders(databaseId: string): Promise<void> {
  const pages = await queryAll(databaseId);
  let emailFilled = 0;
  let measurementsFilled = 0;
  let skipped = 0;

  for (const page of pages) {
    const hasEmail = !!readEmail(page.properties[ORDER_EMAIL_PROPERTY]);
    const hasMeasurements = MEASUREMENT_NUMBER_PROPERTIES.every(
      (p) => readNumber(page.properties[p]) !== null,
    );
    if (hasEmail && hasMeasurements) {
      skipped++;
      continue;
    }

    // Only pay for the body read when something is actually missing.
    const { values, unit } = parseOrderBody(await readBlocks(page.id));
    const patch: Record<string, unknown> = {};

    if (!hasEmail) {
      const email = values.get(BODY_EMAIL_LABEL);
      if (email) {
        patch[ORDER_EMAIL_PROPERTY] = { email: email.toLowerCase() };
        emailFilled++;
      }
    }

    // Measurements only recover as a complete set (the intake requires all five
    // together, and a measure-at-fitting order legitimately has none).
    if (!hasMeasurements) {
      const parsed = MEASUREMENT_NUMBER_PROPERTIES.map((label) => {
        const raw = values.get(label);
        const n = raw !== undefined ? Number(raw) : NaN;
        return Number.isFinite(n) ? n : null;
      });
      if (parsed.every((n) => n !== null)) {
        MEASUREMENT_NUMBER_PROPERTIES.forEach((label, i) => {
          patch[label] = { number: parsed[i] };
        });
        if (unit)
          patch[ORDER_MEASUREMENT_UNIT_PROPERTY] = { select: { name: unit } };
        measurementsFilled++;
      }
    }

    if (Object.keys(patch).length > 0) {
      const orderNumber = readRichText(page.properties[ORDER_NUMBER_PROPERTY]);
      console.log(
        `${DRY_RUN ? "[dry-run] would update" : "updated"} custom order ${orderNumber || page.id}: ${Object.keys(patch).join(", ")}`,
      );
      await patchProperties(page.id, patch);
    } else {
      skipped++;
    }
  }

  console.log(
    `custom orders: email filled ${emailFilled}, measurements filled ${measurementsFilled}, skipped ${skipped}`,
  );
}

async function backfillShopOrders(databaseId: string): Promise<void> {
  const pages = await queryAll(databaseId);
  let numbered = 0;
  let skipped = 0;

  for (const page of pages) {
    if (readRichText(page.properties[SHOP_ORDER_NUMBER_PROPERTY])) {
      skipped++;
      continue;
    }
    const orderNumber = legacyShopOrderNumber(page.id);
    console.log(
      `${DRY_RUN ? "[dry-run] would stamp" : "stamped"} shop order ${page.id} -> ${orderNumber}`,
    );
    await patchProperties(page.id, {
      [SHOP_ORDER_NUMBER_PROPERTY]: {
        rich_text: [{ text: { content: orderNumber } }],
      },
    });
    numbered++;
  }

  console.log(`shop orders: numbered ${numbered}, skipped ${skipped}`);
}

async function main(): Promise<void> {
  if (DRY_RUN) console.log("DRY RUN — no writes will be made.\n");
  const ordersDb = process.env.NOTION_ORDERS_DATABASE_ID;
  const shopDb = process.env.NOTION_SHOP_ORDERS_DATABASE_ID;

  if (ordersDb) await backfillCustomOrders(ordersDb);
  if (shopDb) await backfillShopOrders(shopDb);
  if (!ordersDb && !shopDb) {
    console.log(
      "No NOTION_ORDERS_DATABASE_ID / NOTION_SHOP_ORDERS_DATABASE_ID set; nothing to backfill.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
