-- 0006_issued_invoices.sql — the invoice as ISSUED: an immutable snapshot of
-- what a customer was actually shown and asked to pay.
--
-- `Invoice Ready` was a checkbox, not an event. Ticking it published an invoice
-- whose line items stayed fully editable in Notion afterwards — so the document
-- could change under a customer who had already been shown it, and already paid
-- a deposit against it, with nothing anywhere recording what it used to say. It
-- also carried no number and no date of its own: `Invoice ID` is set to the
-- order's `ORD-` number and is display-only.
--
-- Issuing writes the charges here, once. From then on the customer's invoice
-- page, its PDF and the balance checkout all read this row rather than
-- recomputing from live Notion, so what was shown is what is charged.
--
-- WHAT IS FROZEN, AND WHAT DELIBERATELY IS NOT.
--
--   Frozen: the LINES and their subtotal. Those are the charges, and a charge
--   that moves after the customer has seen it is the defect this table exists
--   to close.
--
--   Live: which deposits have been PAID, and therefore the balance due. Paying
--   a deposit legitimately reduces what is owed — that is the invoice working,
--   not drifting — so `balance = subtotal − deposits paid` is still computed at
--   read time from the invoice head. The deposit SCHEDULE is snapshotted into
--   `deposits` as part of the document's own record of what it said, but it is
--   the live head that decides what is payable, because deposits are payable
--   before an invoice is itemized at all.
--
-- Lines are JSONB rather than a second table: the snapshot is a document, read
-- whole and never queried a line at a time.

create table issued_invoices (
  id                bigint generated always as identity primary key,

  -- The studio's own invoice series. Formatted from `id`, so it is monotonic
  -- and unique by construction. GAPS ARE POSSIBLE (a rolled-back insert
  -- consumes an identity value) — the series is sequential, not gapless, which
  -- is the ordinary property of a database-issued number.
  invoice_number    text not null unique,

  -- The Notion invoice this was issued from. UNIQUE, and that is the whole
  -- immutability guarantee: an invoice can be issued exactly once, enforced by
  -- the database rather than by a caller remembering to check.
  invoice_page_id   text not null unique,
  order_number      text not null,

  issued_at         timestamptz not null default now(),
  -- The staff email that issued it, from the verified session.
  issued_by         text not null default '',

  currency          text not null default 'usd',
  -- Integer cents, like the payment ledger — dollars are for display only.
  subtotal_cents    bigint not null,
  -- Whether the final balance is taxed at checkout. Recorded so the document
  -- can SAY so: tax is computed by Stripe from an address collected at payment,
  -- which the invoice does not have at issue time, so the amount genuinely
  -- cannot be known here.
  taxed             boolean not null default false,

  -- The charged lines as they stood: [{ name, type, amountCents }, …].
  lines             jsonb not null,
  -- The deposit schedule as it stood: [{ stage, label, amountCents }, …].
  -- Part of the document's record; NOT what decides what is payable.
  deposits          jsonb not null default '[]'::jsonb,

  constraint issued_invoices_subtotal_check check (subtotal_cents >= 0)
);

create index issued_invoices_order_number_idx on issued_invoices (order_number);

-- Same lock-down as 0002: Supabase serves `public` through PostgREST and the
-- `anon` key ships in the browser bundle, so a table left at the defaults would
-- publish every invoice the studio has issued — and, worse here than in the
-- ledger, let anyone REWRITE one, which is exactly the thing this table exists
-- to make impossible. Both layers, so either surviving alone still denies.
alter table public.issued_invoices enable row level security;
revoke all on public.issued_invoices from anon, authenticated;
