# Postgres integrity layer (Phase 3 "real database")

The "real database" half of the Phase-3 "Supabase: accounts + a real database"
card. A small **optional** Postgres layer (the same Supabase project that backs
account auth) holding only **app-owned, integrity-bearing facts** that Notion
can't enforce. Notion stays the record for the order lifecycle. It is **entirely
degrade-safe**: unset `POSTGRES_URL` ⇒ `postgresConfigured()` is false and every
caller falls back to the pre-Postgres behavior.

## What's actually wired (vs provisioned)

The single migration `supabase/migrations/0001_init.sql` provisions **four**
tables — `schema_migrations`, `clients`, `order_index`, `processed_payments` —
but **only `processed_payments` has a repository and a caller today.**

- **`processed_payments` — LIVE.** Atomic Stripe idempotency for **shop orders**.
  `lib/db/processed-payments.repository.ts`: `claimPayment` (`insert … on conflict
(stripe_session_id) do nothing`, returning `claimed` / `done` / `in_progress`,
  with a `STALE_CLAIM_MINUTES = 10` reclaim window so a crash between claim and
  confirm can't swallow a payment forever), `confirmPayment`, `releasePayment`.
- **`clients` + `order_index` — SCHEMA-AHEAD-OF-CODE.** The intended email-keyed
  customer + order discovery index for the account portal (`citext` email so
  `where email = $1` is case-insensitive). **No repository, no writer, no reader
  anywhere in `src/`.** The account overview still reads orders live from Notion
  (`findOrdersByEmail`). Don't document these as functional; there is also **no
  backfill script** (the word appears only in comments).

## Load-bearing decisions

- **The one caller is `checkout.service.ts` `recordPaidOrder`.** Flow: if
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
- **Same client pattern as Notion/Stripe/Supabase.** `lib/db/client.ts` reads the
  URL at first use, exposes the narrow injectable `DbClient` seam (`query` + `end`)
  so repos are driver-agnostic and fakeable (`test/support/fake-db.ts`), with
  `__setDbForTests` / `__resetDb` seams. Driver is porsager `postgres` (a prod dep).

## Setup

All optional. On Vercel the Supabase integration provides `POSTGRES_URL` +
`POSTGRES_URL_NON_POOLING`; run `db:migrate` once against the non-pooled URL to
create the tables. Unset ⇒ the layer no-ops (Stripe dedup falls back to Notion).
Tests: `test/unit/db.client.test.ts`, `test/unit/processed-payments.repository.test.ts`,
and the `checkout.service` dedup-branch tests.
