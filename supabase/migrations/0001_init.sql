-- 0001_init.sql — Postgres integrity + read-model layer (Phase 3 "real database").
--
-- Applied by src/scripts/migrate.ts against POSTGRES_URL_NON_POOLING (direct
-- connection — DDL can't traverse Supabase's PgBouncer). Notion stays the record
-- for the order lifecycle; these tables hold only app-owned, integrity-bearing
-- facts: Stripe payment dedup, and a discovery index for the account portal.

create extension if not exists citext;

-- Applied-migration bookkeeping for the runner.
create table if not exists schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

-- One row per customer, keyed on the canonical (lowercased) email. citext makes
-- every `where email = $1` case-insensitive — the core account-portal fix.
create table clients (
  id             uuid primary key default gen_random_uuid(),
  email          citext unique not null,
  notion_page_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- App-owned discovery index for the account portal. Written best-effort when an
-- order/shop-order is created, and backfilled from Notion once. Holds ONLY
-- identity + durable fields — never Stage/Status (those are atelier-edited in
-- Notion and would go stale here); the portal fetches live status from Notion by
-- order_number / notion_page_id.
create table order_index (
  id                uuid primary key default gen_random_uuid(),
  order_number      text not null unique,
  kind              text not null check (kind in ('custom', 'shop')),
  client_id         uuid references clients (id),
  email             citext not null,
  notion_page_id    text not null,
  order_name        text,
  stripe_session_id text unique,
  created_at        timestamptz not null default now()
);
create index order_index_email_idx on order_index (email);
create index order_index_client_id_idx on order_index (client_id);

-- Atomic Stripe idempotency, replacing the Notion read-before-write dedup. The
-- webhook claims a session id here (insert … on conflict do nothing), does the
-- Notion write, then confirms; a failure releases the claim so a retry reprocesses.
create table processed_payments (
  stripe_session_id text primary key,
  kind              text not null,
  status            text not null default 'processing'
                      check (status in ('processing', 'done')),
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz
);
