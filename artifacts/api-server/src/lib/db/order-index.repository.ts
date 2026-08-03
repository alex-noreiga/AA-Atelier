// App-owned discovery index for the account portal. A row is written (best-effort)
// when the app creates a custom or shop order, and backfilled from Notion once.
// It holds only identity + durable fields — never Stage/Status, which are atelier-
// edited in Notion and would go stale here — so the portal uses it to DISCOVER a
// customer's order numbers (case-insensitive, client-joined), then fetches live
// detail from Notion. This fixes the exact-email + legacy-order gaps of the old
// Notion `email: { equals }` lookup.

import { getDb, type DbClient } from "./client.js";
import { normalizeEmail } from "../email.js";

export type OrderKind = "custom" | "shop";

export interface OrderIndexInput {
  orderNumber: string;
  kind: OrderKind;
  email: string;
  notionPageId: string;
  orderName?: string | null;
  clientId?: string | null;
  /** Shop orders only: the Stripe checkout session id (unique). */
  stripeSessionId?: string | null;
}

export interface OrderRef {
  orderNumber: string;
  notionPageId: string;
}

/**
 * Insert a discovery-index row for an order. Idempotent on `order_number`, so a
 * retry or the backfill never duplicates (a re-run is a no-op).
 */
export async function writeOrderIndex(
  input: OrderIndexInput,
  db: DbClient = getDb(),
): Promise<void> {
  await db.query(
    `insert into order_index
       (order_number, kind, client_id, email, notion_page_id, order_name, stripe_session_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (order_number) do nothing`,
    [
      input.orderNumber,
      input.kind,
      input.clientId ?? null,
      normalizeEmail(input.email),
      input.notionPageId,
      input.orderName ?? null,
      input.stripeSessionId ?? null,
    ],
  );
}

/**
 * Every indexed order of a given kind for a customer's email, newest first. The
 * match is case-insensitive (the `email` column is `citext`). Returns the order
 * number + Notion page id so the caller can fetch live detail from Notion.
 */
export async function findOrderRefsByEmail(
  email: string,
  kind: OrderKind,
  db: DbClient = getDb(),
): Promise<OrderRef[]> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];

  const rows = await db.query<{
    order_number: string;
    notion_page_id: string;
  }>(
    `select order_number, notion_page_id
       from order_index
      where email = $1 and kind = $2
      order by created_at desc`,
    [normalized, kind],
  );
  return rows.map((r) => ({
    orderNumber: r.order_number,
    notionPageId: r.notion_page_id,
  }));
}
