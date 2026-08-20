# Postgres integrity layer (Phase 3 "real database")

The "real database" half of the Phase-3 "Supabase: accounts + a real database"
card. A small Postgres layer (the same Supabase project that backs account auth)
holding **app-owned facts** Notion can't enforce or shouldn't own. Notion stays
the record for the order lifecycle. It is **degrade-safe everywhere except the
studio's working hours**: unset `POSTGRES_URL` ⇒ `postgresConfigured()` is false
and every other caller falls back to the pre-Postgres behavior, while
`staff_availability` throws — see below, and
`staff-availability-dashboard.md`.

## What's actually wired (vs provisioned)

`supabase/migrations/0001_init.sql` provisions **four** tables —
`schema_migrations`, `clients`, `order_index`, `processed_payments` — and
`0002_staff_availability.sql` adds a fifth. **All of them are wired now**
(`clients` + `order_index` gained their repositories and callers after this note
was first written; `staff_availability` arrived with the working-hours card).

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

## `staff_availability` — the exception to "optional"

Added by `0002_staff_availability.sql` for the studio's standing working hours
(the positive grid `computeSlots` starts from). Unlike the other tables this one
has **no fallback**, so `lib/db/staff-availability.repository.ts` throws a
pointed error when `POSTGRES_URL` is unset instead of returning an empty
schedule — "no working hours" and "no database configured" look identical from
the booking page and only one of them is a bug. **Appointment booking therefore
requires the layer**; everything else still degrades cleanly.

Two other things about it are worth carrying forward: the rules live in the
**DDL** (`time` columns, `check (end_time > start_time)`, `<@` constraints on the
weekday/location arrays), which is most of why it moved off a Notion database;
and the repository keeps a **60s TTL cache with fall-back-to-cache-on-error**,
busted on every write, so a database blip degrades booking to slightly stale
hours rather than none. Full reasoning in `staff-availability-dashboard.md`.

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
