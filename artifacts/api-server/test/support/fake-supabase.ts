// Test double for the Supabase client the auth gate uses. The server only ever
// calls `auth.getClaims(jwt)` to verify a customer's access token, so the fake
// stubs just that method and records every token it was asked to verify.
//
// Inject it with `__setSupabaseClientForTests` (from
// `src/lib/supabase/client.js`) so the real Express auth stack can be exercised
// without a Supabase project.

import type { SupabaseClient } from "@supabase/supabase-js";

/** The subset of a getClaims result the gate reads: `data.claims.{email,sub}`. */
export interface FakeClaims {
  email?: string;
  sub?: string;
  [key: string]: unknown;
}

export interface FakeSupabaseClient {
  /** Every access token passed to `getClaims`, in order. */
  readonly tokens: string[];
  auth: {
    getClaims(
      token: string,
    ): Promise<{ data: { claims: FakeClaims } | null; error: unknown }>;
  };
}

type GetClaimsImpl = (token: string) => {
  data: { claims: FakeClaims } | null;
  error: unknown;
};

/**
 * Build a fake Supabase client. `impl` decides what `getClaims` returns for a
 * given token — return `{ data: { claims }, error: null }` for a valid token, or
 * `{ data: null, error }` (or throw) for a rejected one. Cast to `SupabaseClient`
 * at the injection site (the fake only implements the one method the gate uses).
 */
export function makeFakeSupabaseClient(
  impl: GetClaimsImpl,
): FakeSupabaseClient {
  const tokens: string[] = [];
  return {
    tokens,
    auth: {
      async getClaims(token: string) {
        tokens.push(token);
        return impl(token);
      },
    },
  };
}

/** Cast helper: the fake implements only `auth.getClaims`, which is all the gate
 * touches, so narrowing it to a full `SupabaseClient` at the seam is safe. */
export function asSupabaseClient(fake: FakeSupabaseClient): SupabaseClient {
  return fake as unknown as SupabaseClient;
}
