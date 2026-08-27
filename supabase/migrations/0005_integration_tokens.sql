-- 0005_integration_tokens.sql — the current access token for a vendor that
-- issues short-lived ones the app is expected to renew itself.
--
-- One row per provider; today the only one is `instagram`. It exists because an
-- Instagram long-lived token expires 60 days after it is issued and the vendor
-- offers no permanent alternative: the only way for the feed to keep working is
-- for something to call `refresh_access_token` before then and REMEMBER the
-- answer. Vercel's environment cannot be written at runtime, and a secret does
-- not belong in the Notion settings database (see CLAUDE.md, "Studio
-- Settings"), so the app's own Postgres is the only place the renewed token can
-- live.
--
-- This is therefore the second table here that IS the record rather than an
-- integrity layer over Notion (the first being `staff_availability`), and for
-- the same reason: there is no second store to fall back to. The fallback that
-- does exist is the `INSTAGRAM_ACCESS_TOKEN` env var, which seeds this row and
-- takes over again if the stored token ever lapses — so a studio whose refresh
-- has been broken for two months is fixed by pasting a fresh token into Vercel,
-- which is where they would look anyway.
--
-- `seed_fingerprint` is what makes that rotation work immediately instead of at
-- the next expiry. It is a digest of the env token this row's chain descends
-- from; when the env var is changed the digest stops matching and the stored
-- chain is abandoned in favour of the new seed. A digest rather than the token
-- because the comparison only needs equality, and a value that is never used as
-- a credential cannot be leaked as one.

create table integration_tokens (
  provider         text primary key,
  access_token     text not null,
  -- When the vendor says the token stops working. Null when it did not say —
  -- read as "unknown", never as "never expires": the resolver treats an unknown
  -- expiry as still usable but always due for a refresh, which is the safe way
  -- round (a needless refresh costs one request; a skipped one costs the feed).
  expires_at       timestamptz,
  seed_fingerprint text,
  refreshed_at     timestamptz not null default now()
);

-- Same lock-down as 0002, and here it is the sharpest it gets: this table holds
-- a live API credential, and Supabase serves `public` through PostgREST with an
-- `anon` key that ships in the browser bundle. RLS with no policies denies every
-- row to non-owner roles, and the revoke holds even if RLS is later disabled.
-- The app connects as the owning `postgres` role, which bypasses both.
alter table public.integration_tokens enable row level security;
revoke all on public.integration_tokens from anon, authenticated;
