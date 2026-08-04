// Postgres client index, keyed on the canonical (lowercased) email — the join hub
// the account-portal order lookups resolve against. This mirrors the Notion CRM's
// `upsertClientByEmail` dedupe-by-email, but in a real table with a unique
// constraint, so `citext` gives case-insensitive matching for free. Notion's
// Client CRM stays the atelier-facing record; this is the app's read-model key.

import { getDb, type DbClient } from "./client.js";
import { normalizeEmail } from "../email.js";

/**
 * Find-or-create a client row for this email and return its id. Optionally records
 * the Notion CRM page id (kept if already set). Returns null for a blank email.
 */
export async function upsertClientIndex(
  email: string,
  notionPageId: string | null = null,
  db: DbClient = getDb(),
): Promise<string | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const rows = await db.query<{ id: string }>(
    `insert into clients (email, notion_page_id)
     values ($1, $2)
     on conflict (email) do update
       set notion_page_id = coalesce(excluded.notion_page_id, clients.notion_page_id),
           updated_at = now()
     returning id`,
    [normalized, notionPageId],
  );
  return rows[0]?.id ?? null;
}
