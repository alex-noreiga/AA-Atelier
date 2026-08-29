-- 0005_payments.sql — the payment ledger: one row per movement of money.
--
-- Until now "has this been paid?" lived on the Notion invoice as three
-- checkboxes and three session-id text fields (`First/Second Deposit Paid`,
-- `Balance Paid`), and a shop order carried a single Stripe session id. That
-- shape has three defects this table exists to fix, and they are worth stating
-- because each one is a wrong number somebody has already read:
--
--   1. NO DATES. A checkbox records that money arrived, never when. It is why
--      `studio-analytics.service.ts` can only report bespoke work as *booked* in
--      the month the order came in, and can never report revenue in the month it
--      was actually collected. That comment names this table as the fix.
--   2. EXACTLY THREE PAYMENTS PER ORDER, FOREVER. A deposit split across two
--      cards, a customer who pays half a balance, a second attempt after a
--      decline — none is representable in a fixed set of checkboxes.
--   3. REFUNDS NEVER LAND. `order-cancellation.service` reads the invoice to
--      FIND the sessions, refunds them through Stripe, and writes nothing back,
--      so `Balance Paid` stays ticked on a fully-refunded order and the
--      dashboard counts it as collected.
--
-- This is an APPEND-ONLY ledger: rows are inserted, never updated or deleted. A
-- refund is a new negative row, not an edit to the charge it reverses, so the
-- history of an order is the rows in `paid_at` order and the current position is
-- their sum. Nothing here replaces Stripe as the authority on money — Stripe is
-- still asked before every refund (see lib/stripe/refunds.ts). This is the
-- studio's own record of what Stripe (or a customer's cash at a fitting) did,
-- with the timestamps Notion cannot hold.
--
-- Deliberately NOT foreign-keyed to `order_index`: that index is a best-effort
-- write and may be missing rows, and a ledger entry must never fail to record
-- because a discovery index was incomplete. `order_number` is the join key, the
-- same text the rest of the app addresses an order by (`ORD-…` / `SHP-…`).

create table payments (
  id                bigint generated always as identity primary key,

  -- Which order this money moved against. Text, not a relation — see the header.
  order_number      text not null,
  order_kind        text not null,
  -- The invoice stage for a custom order ('first_deposit' | 'second_deposit' |
  -- 'balance'); always '' for a shop order, which has no staged payments.
  stage             text not null default '',

  kind              text not null,
  -- Integer cents, SIGNED: positive for a charge, negative for a refund, so the
  -- balance of an order is a plain sum() and no reader has to know the rule.
  -- The check below ties the sign to `kind` so the two can never disagree.
  amount_cents      bigint not null,
  currency          text not null default 'usd',
  method            text not null default 'stripe',

  -- When the money actually moved. The whole point of the table: distinct from
  -- `recorded_at` (when we learned), so a payment backfilled months later still
  -- lands in the month it was collected.
  paid_at           timestamptz not null,

  -- The Stripe object this row records: the Checkout session for a charge, the
  -- refund for a refund. It is the IDEMPOTENCY KEY (unique index below) — the
  -- Stripe webhook is at-least-once, so without it a redelivery would append a
  -- second row and silently double-count revenue, which is the exact failure
  -- this table exists to prevent. Empty for a payment recorded by hand.
  external_id       text not null default '',
  -- Informational, for reconciling a row against a Stripe payout.
  payment_intent_id text not null default '',

  note              text not null default '',
  -- The staff email behind a hand-recorded payment; '' for anything automatic.
  recorded_by       text not null default '',
  recorded_at       timestamptz not null default now(),

  constraint payments_order_kind_check check (order_kind in ('custom', 'shop')),
  constraint payments_kind_check       check (kind in ('charge', 'refund')),
  constraint payments_method_check
    check (method in ('stripe', 'cash', 'check', 'transfer', 'other')),
  -- A charge is money in and a refund is money out. Enforced here as well as in
  -- the repository, so a hand-run `insert` can't introduce a row whose sign
  -- contradicts its label and quietly invert a month's takings.
  constraint payments_sign_check check (
    (kind = 'charge' and amount_cents > 0) or
    (kind = 'refund' and amount_cents < 0)
  )
);

-- PARTIAL unique index: one ledger row per Stripe object, while any number of
-- hand-recorded payments (external_id = '') stay possible on the same order —
-- a customer may well pay a deposit in two instalments of cash.
create unique index payments_external_id_key
  on payments (external_id) where external_id <> '';

create index payments_order_number_idx on payments (order_number);
create index payments_paid_at_idx      on payments (paid_at);

-- Same lock-down as 0002 and 0003: Supabase serves `public` through PostgREST
-- and the `anon` key ships in the browser bundle, so a table left at the
-- defaults would publish every payment this studio has ever taken — amounts,
-- dates and order numbers — and let anyone forge or delete rows in it. Both
-- layers, so either surviving alone still denies: RLS with no policies denies
-- every row to non-owner roles, and the revoke holds even if RLS is later
-- disabled. The app connects as the owning `postgres` role and bypasses both.
alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;
