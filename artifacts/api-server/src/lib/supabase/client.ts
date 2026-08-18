// Thin lazily-constructed Supabase client. The project URL + anon key are read
// at first use (not at module load), mirroring the Stripe/Notion clients in
// `lib/stripe/client.ts` / `lib/notion/client.ts`, so the server — and the tests
// — can import this module without credentials.
//
// The server uses Supabase for ONE thing: verifying the access-token JWT a
// signed-in customer sends as a Bearer credential (see `middlewares/auth.ts`).
// It never manages a session of its own, so the client is built with sessions
// disabled. Verification runs through `auth.getClaims`, which fetches the
// project's JWKS once per warm instance and then verifies tokens locally — no
// per-request round-trip to Supabase (matching the old HMAC verify's cost).
//
// Create a project at https://supabase.com and copy its Project URL + anon
// (publishable) key into SUPABASE_URL / SUPABASE_ANON_KEY.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function createSupabaseClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let client: SupabaseClient | null = null;

/** A test-injected client that, when set, wins over the env-built singleton.
 * Integration tests set a fake here so the auth gate can be exercised without a
 * real Supabase project. */
let override: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (override) return override;
  if (!client) {
    const url = process.env.SUPABASE_URL;
    if (!url) {
      throw new Error("SUPABASE_URL environment variable is not set");
    }
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!anonKey) {
      throw new Error("SUPABASE_ANON_KEY environment variable is not set");
    }
    client = createSupabaseClient({ url, anonKey });
  }
  return client;
}

/** Whether the account portal's auth backend is configured. When false the
 * portal is inert: the sign-in page reports it and `requireCustomer` 401s —
 * mirroring the old `authConfigured()` env-gated-degrade. */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/** Test seam: inject a fake client (or null to clear it). */
export function __setSupabaseClientForTests(c: SupabaseClient | null): void {
  override = c;
}

/** Test seam: drop the memoized singleton so the next call rereads env. */
export function __resetSupabaseClient(): void {
  client = null;
  override = null;
}
