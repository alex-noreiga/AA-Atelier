-- 0002_lock_down_public_tables.sql — close the PostgREST exposure on the Phase-3
-- Postgres layer.
--
-- 0001 created these tables but left them reachable from the public internet.
-- Supabase serves the `public` schema through PostgREST, and its
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public` grants ALL to `anon` +
-- `authenticated`. The `anon` key ships in the browser bundle
-- (VITE_PUBLIC_SUPABASE_ANON_KEY), so anyone could read AND write every row:
-- customer emails (`clients`), the email→order→Stripe-session map
-- (`order_index`), and — sharpest — `processed_payments`, where forging a
-- 'processing' claim stalls a paid order's Notion write and deleting a 'done'
-- row lets the same order record twice.
--
-- Nothing in the app goes through PostgREST: the API server connects directly as
-- `postgres` over POSTGRES_URL (lib/db/client.ts), and a table owner bypasses
-- RLS. So this is a pure lock-down with no runtime behavior change.
--
-- Two layers, deliberately both — either alone would close it, together they
-- survive one being undone:
--   1. RLS with NO policies → deny-all for anon/authenticated even if grants return.
--   2. REVOKE the grants    → deny-all even if RLS is later disabled.
-- Plus the schema default privileges, so a future `create table` in `public`
-- doesn't silently reopen the same hole.

-- 1. Row level security. No policies are created on purpose: RLS with zero
--    policies denies every row to non-owner roles. `service_role` is BYPASSRLS
--    and the app's `postgres` role owns these tables, so both are unaffected.
alter table public.schema_migrations   enable row level security;
alter table public.clients             enable row level security;
alter table public.order_index         enable row level security;
alter table public.processed_payments  enable row level security;

-- 2. Revoke the PostgREST-facing grants outright. `service_role` keeps its access.
revoke all on public.schema_migrations  from anon, authenticated;
revoke all on public.clients            from anon, authenticated;
revoke all on public.order_index        from anon, authenticated;
revoke all on public.processed_payments from anon, authenticated;

-- 3. Stop future objects in `public` from inheriting those grants. This only
--    resets defaults set by the CURRENT role (`postgres`) — which is the role
--    that owns every table this app creates. Supabase's own `supabase_admin`
--    defaults are left alone deliberately: they govern Supabase-managed objects,
--    and rewriting them risks breaking the platform's internals.
--
--    Consequence to know: if a future migration ever adds a PostgREST RPC, it
--    must `grant execute` to anon/authenticated explicitly. Today the app makes
--    no PostgREST calls at all, so deny-by-default is the correct posture.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
