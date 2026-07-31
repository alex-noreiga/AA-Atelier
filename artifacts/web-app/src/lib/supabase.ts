// The browser Supabase client — the single source of the customer's auth
// session. supabase-js persists the session (access + refresh tokens) in
// localStorage and refreshes it automatically; `detectSessionInUrl` completes
// the OAuth / magic-link / password-reset redirect on page load. The access
// token is handed to the generated API client as a Bearer credential (see
// `lib/auth-context.tsx`), which the server verifies.
//
// Config is build-time Vite env (`VITE_SUPABASE_*`). When unset the client is
// null and the portal degrades to "sign-in unavailable" — the same env-gated
// inertness the server side has via `supabaseConfigured()`.
//
// The anon key is a public client key by design; it carries no privileged
// access (row-level security governs data), so shipping it to the browser is
// expected. The tradeoff vs the old httpOnly-cookie session is that the token
// now lives in JS-readable storage, so an XSS bug could exfiltrate it — an
// accepted cost of the standard Bearer-transport model.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The Supabase→Vercel integration injects the public config as
// VITE_PUBLIC_SUPABASE_* (Vite exposes it since it starts with VITE_); a plain
// VITE_SUPABASE_* also works for a simple local .env.
const url = (import.meta.env.VITE_PUBLIC_SUPABASE_URL ??
  import.meta.env.VITE_SUPABASE_URL) as string | undefined;
const anonKey = (import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

/** Whether Supabase Auth is configured for this build. */
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;
