// Thin Postgres client. The connection string is read at first use (not at
// module load), mirroring the Notion/Stripe/Supabase clients, so the server —
// and the tests — can import this module without a database. Repositories depend
// on the narrow `DbClient` interface (a parameterized `query`), never on the
// underlying driver, so a fake can be injected in tests exactly like `NotionClient`.
//
// Runtime uses the POOLED `POSTGRES_URL` (Supabase PgBouncer, transaction mode):
// prepared statements are disabled and the pool is kept tiny (`max: 1`) because
// each warm serverless instance holds its own pool feeding the shared pooler.
// Migrations / the backfill script instead build their own client on
// `POSTGRES_URL_NON_POOLING` (direct connection — DDL can't traverse PgBouncer).
//
// The Supabase→Vercel integration provides these vars. Unset ⇒ `postgresConfigured()`
// is false and every caller degrades to the pre-Postgres behavior.

import postgres from "postgres";

/** The seam every repository depends on: a parameterized query returning rows.
 * Keeps repos driver-agnostic and trivially fakeable (see test/support/fake-db.ts). */
export interface DbClient {
  /** Run a parameterized statement (`$1`, `$2`, …) and return the rows. */
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
  /** Close the underlying pool. Used by the migrate/backfill scripts; the
   * long-lived serverless singleton never calls it. */
  end(): Promise<void>;
}

export interface DbConfig {
  url: string;
  /** Pool size. Runtime uses 1 (PgBouncer); scripts on the direct URL may raise it. */
  max?: number;
}

export function createDbClient(config: DbConfig): DbClient {
  const sql = postgres(config.url, {
    prepare: false, // PgBouncer transaction mode can't keep prepared statements.
    max: config.max ?? 1,
    idle_timeout: 20,
  });

  return {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await sql.unsafe(text, params as never[]);
      return rows as unknown as T[];
    },
    async end(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}

let client: DbClient | null = null;

/** A test-injected client that, when set, wins over the env-built singleton. */
let override: DbClient | null = null;

export function getDb(): DbClient {
  if (override) return override;
  if (!client) {
    const url = process.env.POSTGRES_URL;
    if (!url) {
      throw new Error("POSTGRES_URL environment variable is not set");
    }
    client = createDbClient({ url });
  }
  return client;
}

/** Whether the Postgres layer is configured. When false, callers degrade to the
 * pre-Postgres behavior (the account portal falls back to Notion by-email
 * lookups, the Stripe webhook keeps its Notion read-before-write dedup). */
export function postgresConfigured(): boolean {
  return Boolean(process.env.POSTGRES_URL);
}

/** Test seam: inject a fake client (or null to clear it). */
export function __setDbForTests(c: DbClient | null): void {
  override = c;
}

/** Test seam: drop the memoized singleton so the next call rereads env. */
export function __resetDb(): void {
  client = null;
  override = null;
}
