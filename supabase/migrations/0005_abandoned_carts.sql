-- 0005_abandoned_carts.sql — one pending cart-recovery reminder per email.
--
-- The shop's cart lives in the browser (localStorage); the app has no
-- server-side cart to watch go stale. So the abandoned-cart reminder stores the
-- one thing it needs: "this email asked to be reminded about this cart". A row
-- here is a PENDING reminder, not a history — it is deleted when the reminder
-- sends, when a paid checkout with the same email lands (the webhook), or when
-- it expires unsent. That delete-on-resolution shape is deliberate: it is the
-- idempotency marker (no row ⇒ nothing to send twice, the same claim direction
-- as restock_alerts) AND the data-minimization story (an email + cart snapshot
-- never outlives the days it takes to act on it).
--
-- `email` is the key, so one email holds one pending cart: a second save
-- replaces the snapshot and restarts the clock, which is what a customer who
-- kept shopping means. `items` is a display snapshot for the email's copy only
-- — nothing in it is ever trusted for money (checkout reprices from live
-- inventory, exactly as it does for the cart itself).

create table abandoned_carts (
  email      citext primary key,
  items      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index abandoned_carts_updated_at_idx on abandoned_carts (updated_at);

-- Same lock-down as 0002 applies to every other table: Supabase serves `public`
-- through PostgREST and the `anon` key ships in the browser bundle, so a table
-- left open would let anyone read saved carts (emails + what they shopped for)
-- or delete rows to suppress reminders. Both layers, for the same reason as
-- 0002: RLS with no policies denies every row to non-owner roles, and the
-- revoke holds even if RLS is later disabled. The app connects as the owning
-- `postgres` role, which bypasses both.
alter table public.abandoned_carts enable row level security;
revoke all on public.abandoned_carts from anon, authenticated;
