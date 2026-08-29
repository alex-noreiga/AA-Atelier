// The stored half of a vendor credential the app renews itself, backed by the
// `integration_tokens` table. Today the only provider is Instagram.
//
// Unlike every other repository in this folder, what is stored here is not an
// integrity fact over something Notion owns — it IS the credential, because the
// vendor issues tokens that expire and nowhere else in the stack can be written
// at runtime (see the migration's header). The env var remains the seed and the
// last resort; this is the chain of renewals that grows from it.
//
// Both functions are deliberately narrow and take a `DbClient`, so the caller —
// not the repository — decides what a database failure means. For the feed that
// is "fall back to the env token"; for the refresh pass it is "alert and try
// again tomorrow".

import { getDb, type DbClient } from "./client.js";

/** A stored token, as the table holds it. */
export interface StoredIntegrationToken {
  accessToken: string;
  /** When the vendor said it stops working, or null when it did not say. */
  expiresAt: Date | null;
  /** Digest of the env-var token this chain of renewals descends from, or null
   * for a row written before seeds were tracked. Compared — never used as a
   * credential — to notice that the atelier has pasted a different token in. */
  seedFingerprint: string | null;
  refreshedAt: Date;
}

interface TokenRow {
  access_token: string;
  expires_at: Date | string | null;
  seed_fingerprint: string | null;
  refreshed_at: Date | string;
}

/** Postgres hands back a `Date` for a timestamptz, but a driver or a fake may
 * hand back the ISO text; normalize so callers only ever see a Date. */
function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The stored token for `provider`, or null when nothing has been stored yet. */
export async function readIntegrationToken(
  provider: string,
  db: DbClient = getDb(),
): Promise<StoredIntegrationToken | null> {
  const rows = await db.query<TokenRow>(
    `select access_token, expires_at, seed_fingerprint, refreshed_at
       from integration_tokens
      where provider = $1`,
    [provider],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    accessToken: row.access_token,
    expiresAt: toDate(row.expires_at),
    seedFingerprint: row.seed_fingerprint,
    refreshedAt: toDate(row.refreshed_at) ?? new Date(0),
  };
}

/** What a write puts in the row. */
export interface IntegrationTokenWrite {
  provider: string;
  accessToken: string;
  expiresAt: Date | null;
  seedFingerprint: string | null;
}

/**
 * Store `provider`'s current token, replacing whatever was there.
 *
 * An upsert rather than an insert because there is only ever one live token per
 * provider: the previous one is superseded the moment a refresh returns, and
 * keeping the history would be keeping expired credentials.
 */
export async function writeIntegrationToken(
  token: IntegrationTokenWrite,
  db: DbClient = getDb(),
): Promise<void> {
  await db.query(
    `insert into integration_tokens
       (provider, access_token, expires_at, seed_fingerprint, refreshed_at)
     values ($1, $2, $3, $4, now())
     on conflict (provider) do update
       set access_token     = excluded.access_token,
           expires_at       = excluded.expires_at,
           seed_fingerprint = excluded.seed_fingerprint,
           refreshed_at     = now()`,
    [token.provider, token.accessToken, token.expiresAt, token.seedFingerprint],
  );
}
