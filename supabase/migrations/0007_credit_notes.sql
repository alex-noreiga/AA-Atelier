-- 0007_credit_notes.sql — the way an issued invoice changes.
--
-- 0006 made an issued invoice immutable, which is what stops the charges moving
-- under a customer who has already been shown them. It also left the atelier
-- with no way to reduce one: an invoice issued for too much, work that was
-- dropped, a goodwill discount. The answer is not to reopen the document — it is
-- to write a second one against it, which is how invoicing has always handled
-- this and why the tool that issues refuses to re-issue.
--
-- A credit note REDUCES WHAT IS OWED. It is emphatically NOT a refund: if the
-- customer has already paid, moving money back is a separate act with its own
-- tools (`cancellation-refund` / `return-refund`, which go through Stripe and
-- record themselves in the payment ledger). Crediting an invoice the customer
-- has settled leaves them owed money and says so; it does not quietly send any.
--
-- Append-only, like `payments` and `issued_invoices`: a credit note is never
-- edited or deleted. Unlike `issued_invoices` there is deliberately NO unique
-- key on the invoice — an invoice may be credited more than once, for different
-- reasons, on different days. What bounds it instead is the rule in
-- `credit-note.service.ts`: the credits on an invoice may never exceed what it
-- charges, because a document cannot be reduced below nothing.

create table credit_notes (
  id              bigint generated always as identity primary key,

  -- The studio's own credit-note series, formatted from `id` exactly as the
  -- invoice series is. Sequential, not gapless.
  credit_number   text not null unique,

  -- The ISSUED invoice this credits. Not unique: an invoice can carry several.
  invoice_page_id text not null,
  order_number    text not null,

  issued_at       timestamptz not null default now(),
  -- The staff email that raised it, from the verified session.
  issued_by       text not null default '',

  currency        text not null default 'usd',
  -- Integer cents, POSITIVE — the sign is in the word "credit", and storing it
  -- negative would invite a reader to add it to a subtotal and get it right by
  -- accident. Every consumer subtracts explicitly.
  amount_cents    bigint not null,
  -- Why, in the atelier's words. Shown to the customer on their invoice, so it
  -- is part of the document rather than an internal note.
  reason          text not null default '',

  constraint credit_notes_amount_check check (amount_cents > 0)
);

create index credit_notes_invoice_page_id_idx on credit_notes (invoice_page_id);
create index credit_notes_order_number_idx on credit_notes (order_number);

-- Same lock-down as 0002: `public` is served through PostgREST and the `anon`
-- key ships in the browser bundle, so a table left at the defaults would let
-- anyone write a credit note against any invoice — reducing what a customer
-- owes the studio, from the browser. Both layers, so either surviving alone
-- still denies.
alter table public.credit_notes enable row level security;
revoke all on public.credit_notes from anon, authenticated;
