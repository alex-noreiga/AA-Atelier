# Postgres integrity layer (Phase 3 "real database")

The "real database" half of the Phase-3 "Supabase: accounts + a real database"
card. A small **optional** Postgres layer (the same Supabase project that backs
account auth) holding only **app-owned, integrity-bearing facts** that Notion
can't enforce. Notion stays the record for the order lifecycle. It is **entirely
degrade-safe**: unset `POSTGRES_URL` ⇒ `postgresConfigured()` is false and every
caller falls back to the pre-Postgres behavior.

## What's wired

`supabase/migrations/0001_init.sql` provisions four tables —
`schema_migrations`, `clients`, `order_index`, `processed_payments` — and
`0002_lock_down_public_tables.sql` closes them to PostgREST (below). All three
data tables have a repository and callers.

- **`processed_payments`.** Atomic Stripe idempotency for **shop orders**.
  `lib/db/processed-payments.repository.ts`: `claimPayment` (`insert … on conflict
(stripe_session_id) do nothing`, returning `claimed` / `done` / `in_progress`,
  with a `STALE_CLAIM_MINUTES = 10` reclaim window so a crash between claim and
  confirm can't swallow a payment forever), `confirmPayment`, `releasePayment`.
- **`clients` + `order_index`.** The email-keyed customer + order discovery index
  for the account portal (`citext` email so `where email = $1` is
  case-insensitive). Written **best-effort** on order/checkout (`upsertClientIndex`
  / `writeOrderIndex`, from `orders.service` + `checkout.service`) and read by the
  overview (`findOrderRefsByEmail`, `account.service`). The read is a
  **union, not a replacement**: `listCustomOrders` / `listShopOrders` start from
  the Notion by-email query and add any order numbers the index finds that the
  exact-email match missed, then read those back from Notion by number so
  Stage/measurements stay live. A DB failure degrades to the Notion-only result.
  `src/scripts/backfill-order-index.ts` (`db:backfill`) seeds the index from
  existing Notion orders.

## Load-bearing decisions

- **The Stripe caller is `checkout.service.ts` `recordPaidOrder`.** Flow: if
  `postgresConfigured()`, claim → write the Notion order → confirm; release +
  rethrow on failure so a Stripe redelivery reprocesses cleanly, and **throw** on a
  live `in_progress` claim so a concurrent delivery can't race a duplicate. A DB
  error is caught + logged and falls back to the Notion dedup, so a Postgres outage
  never blocks recording a paid order. The Notion `findOrderBySessionId` guard is
  **retained** as a reclaim-only backstop (`createShopOrder` isn't itself
  idempotent). **Custom-order payments don't use it** — `recordPayment` is
  idempotent via the Notion invoice write alone.
- **Pooled at runtime, direct for migrations.** The app reads the **pooled**
  `POSTGRES_URL` (Supabase PgBouncer, transaction mode) with
  `prepare:false, max:1, idle_timeout:20` (each warm serverless instance holds its
  own tiny pool feeding the shared pooler). Migrations use the **non-pooled**
  `POSTGRES_URL_NON_POOLING` (direct — DDL can't traverse PgBouncer).
- **Migrations run out-of-band, never in the deploy path.**
  `pnpm --filter @workspace/api-server db:migrate` (`src/scripts/migrate.ts`,
  applies `supabase/migrations/*.sql` in filename order, each in a transaction with
  its `schema_migrations` insert). It's a manual `workflow_dispatch` job
  (`.github/workflows/migrate.yml`), deliberately kept out of `build:vercel` and
  cold starts — DDL must not run there.
- **These tables are closed to the Data API — keep them that way.** Supabase serves
  the `public` schema through PostgREST and the `anon` key ships in the browser
  bundle (`VITE_PUBLIC_SUPABASE_ANON_KEY`), so a table left at Supabase's defaults
  is world-readable **and world-writable**. `0002_lock_down_public_tables.sql` turns
  RLS on with **no policies** (deny-all), revokes all grants from
  `anon`/`authenticated`, and resets the schema's `ALTER DEFAULT PRIVILEGES` so a
  future `create table` doesn't silently reopen it. The app is unaffected because it
  never uses PostgREST — it connects directly as `postgres`, which **owns** these
  tables and bypasses RLS. Two rules follow: a new `public` table needs its own
  `enable row level security` + `revoke` pair in the migration that creates it, and
  a PostgREST RPC (there are none) would need an explicit `grant execute`.
- **Same client pattern as Notion/Stripe/Supabase.** `lib/db/client.ts` reads the
  URL at first use, exposes the narrow injectable `DbClient` seam (`query` + `end`)
  so repos are driver-agnostic and fakeable (`test/support/fake-db.ts`), with
  `__setDbForTests` / `__resetDb` seams. Driver is porsager `postgres` (a prod dep).

## Setup

All optional. On Vercel the Supabase integration provides `POSTGRES_URL` +
`POSTGRES_URL_NON_POOLING`; run `db:migrate` once against the non-pooled URL to
create the tables. Unset ⇒ the layer no-ops (Stripe dedup falls back to Notion and
the portal reads Notion only). Tests: `test/unit/db.client.test.ts`,
`test/unit/processed-payments.repository.test.ts`, and the `checkout.service`
dedup-branch tests, all over `test/support/fake-db.ts`.

## Addendum — `restock_alerts` (0003)

A fourth table joined the layer with the back-in-stock alert: `restock_alerts`, one row
per answered restock request, keyed on the request's Notion page id. It reuses the
`processed_payments` claim primitive (`insert … on conflict do nothing`) **without** its
confirm/release cycle — the worst case of a claim that never leads to a send is a lost
alert, not a swallowed payment, so failing closed is right and there is nothing to
release.

It is the layer's **one caller with no degraded fallback**. Everywhere else an unset
`POSTGRES_URL` falls back to the pre-Postgres behavior; there is no such behavior here,
because without somewhere to record who has been told, the nightly sweep would email the
same people every night. Unset ⇒ the pass no-ops with a warn and the studio tool reports
`attention`. See `back-in-stock-alerts.md`.

`0003_restock_alerts.sql` carries its own RLS + revoke lock-down inline: it is numbered
past `0002_lock_down_public_tables.sql`, which locks down the tables that existed when it
was written and cannot cover one created later. Any future migration adding a table must
do the same.
