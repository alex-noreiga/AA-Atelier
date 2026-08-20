-- 0003_restock_alerts.sql — one row per back-in-stock request already answered.
--
-- The back-in-stock alert needs exactly one app-owned fact: "have we already
-- told this person their piece returned?" That is the shape the Postgres layer
-- exists for (see 0001's header) — a uniqueness constraint Notion can't enforce,
-- owned by the app rather than the atelier. Keeping it here instead of a
-- `Restock Notified` checkbox on Website Contact Messages means the feature
-- needs no Notion setup at all, and the marker can't be un-ticked by hand into a
-- second email.
--
-- The key is the Notion page id of the request row, so the claim is per REQUEST,
-- not per person or per piece: someone who asks about two sizes is answered
-- about each. `insert … on conflict do nothing` is the claim, exactly like
-- `processed_payments` — but with no confirm/release cycle, because unlike a
-- payment the worst case here is a lost alert, not a double charge, and a claim
-- that is never followed by a send is the safe way to fail.

create table restock_alerts (
  request_page_id text primary key,
  item            text not null,
  size            text not null default '',
  email           citext not null,
  alerted_at      timestamptz not null default now()
);
create index restock_alerts_item_idx on restock_alerts (item);

-- Same lock-down as 0002 applies to every other table: Supabase serves `public`
-- through PostgREST and the `anon` key ships in the browser bundle, so a table
-- left open would let anyone read the waiting list (emails + what they want) or
-- forge rows to suppress alerts. Both layers, for the same reason as 0002: RLS
-- with no policies denies every row to non-owner roles, and the revoke holds
-- even if RLS is later disabled. The app connects as the owning `postgres` role,
-- which bypasses both.
alter table public.restock_alerts enable row level security;
revoke all on public.restock_alerts from anon, authenticated;
