# Back-in-stock alerts

Closes the loop on the shop's "notify me when it's back" requests. `POST /api/notify`
has captured and acknowledged restock requests since the shop shipped, but nothing ever
told the customer when the piece returned — the requests sat in the contact inbox, with
consent, unanswered.

**Nothing is configured in Notion — no automation, no webhook, no added property.** It
reuses the contact database (where the requests already live), the inventory database,
the orders Resend sender, the nightly cron, and the studio dashboard. The one new piece
of infrastructure is a Postgres table, `restock_alerts`.

## Why it's shaped this way

- **It deliberately does NOT ride a Notion trigger — that was the second draft, and it
  was wrong.** The first two attempts modelled this on the order status-change email: a
  Notion automation on the inventory database POSTing a webhook, plus a `Restock
Notified` checkbox on Website Contact Messages as the idempotency marker. Both were
  cut on the owner's call, and the reasoning generalizes: this branch is the one
  **retiring** Notion-side plumbing (`studio-internal-tools.md`), and a feature that
  needs a webhook wired plus a property added is a feature that silently doesn't work
  until someone does both. What replaced them are two triggers the app already owns and
  a table it already has the layer for.

- **Trigger: the nightly reconciliation cron + a studio tool.** `sendDueRestockAlerts`
  is a fourth pass in `reconcileMilestones`, next to the fitting and payment reminders —
  the same "there is no Notion→app trigger, so ride the nightly run" precedent, and no
  new cron (Vercel Hobby caps them). The dashboard's **"Send back-in-stock alerts"**
  tool calls the identical function for same-day sends. Worst-case latency without
  pressing anything is one night, which for a restock is fine.

- **It is a SWEEP, not a per-row handler.** Both triggers call `notifyRestock`, which
  reads live inventory, takes every available piece, and answers the requests waiting on
  them. The tool's `item` is **optional** and only narrows which pieces are considered —
  so blank (the cron's mode) and named (the atelier's) share one code path, and naming a
  piece can never assert it is in stock. This is also what made the tool usable: an
  earlier version required typing an exact `Item Name`, which is a bad thing to make
  someone do from memory.

- **Inventory is read fresh.** `listVariants(client, { fresh: true })` skips the 60s
  cache read (still refreshing it). Without this, pressing the tool right after
  restocking could report the piece still sold out for up to a minute — which reads as
  the feature being broken, at exactly the moment someone is testing it.

- **Idempotency is `restock_alerts` in Postgres, keyed on the request's Notion page id.**
  `insert … on conflict do nothing` — the `processed_payments` claim primitive, minus its
  confirm/release cycle, because the worst case of a claim that never leads to a send is
  a lost alert rather than a swallowed payment. So a claim **error** is treated as "not
  claimed" and the send is skipped: an unrecorded alert repeats next run, and a duplicate
  is worse than a delay. Keyed per REQUEST, so someone who asked about two sizes is
  answered about each.

- **`POSTGRES_URL` is a hard requirement here, unlike everywhere else in the DB layer.**
  Every other Postgres caller degrades to pre-Postgres behavior; this one can't, because
  without the marker a nightly sweep re-emails the same people every night. Unset ⇒ the
  pass no-ops with a warn and the studio tool returns **`attention`** (not `noop`) with
  the fix — nothing will ever send until someone configures it, so it must not read as a
  quiet nothing-to-do.

- **The size gate fails closed.** `restockSatisfiesRequest` (`services/restock.ts`, pure)
  answers a size-less request whenever the piece is back, answers a size-named request
  only when that band is in `Sizes Available`, treats a row with no bands as answerable
  whole, and says **no** for a band that has since been dropped. Deliberately the
  opposite bias to `measurement-lock.ts` (fails open) and the same as `orderDelivered`: a
  wrong "it's back!" walks a customer into a sold-out page and burns the one email we
  get. An unanswered request is never claimed, so it stays in the queue.

- **Matching is the `Item` text = the inventory row's own `Item Name`** (the shop passes
  `variant.name` into the notify dialog). **Renaming an inventory item orphans every
  request filed under the old name** — they stay visible in the contact inbox, nothing
  errors.

- **`shopCardId()` is exported from `products.service.ts`** rather than re-derived, so
  the email's `/shop/:productId` deep link can't drift from the id the shop addresses
  (`group-<slug>` for a `Website Group` row, the page id otherwise). `groupVariants` now
  routes both card branches through it.

- **Customer email only.** From the orders sender, best-effort, no atelier notification:
  the run reports what it did to whoever started it, and the dashboard breaks the count
  down per piece. Same reasoning as the fitting reminder.

## Known limit

With no marker in Notion, the sweep reconsiders **every back-in-stock request ever
filed** — so a request from a year ago is answered if its piece returns. That is
arguably correct (they asked, and were never told) but worth knowing; deleting stale
rows in the contact inbox is the lever. The scan goes through the bounded `scanDatabase`
helper, so it can't fan out unboundedly on a serverless function.

## Setup (one time)

Run the database migrations so `restock_alerts` exists — `pnpm --filter
@workspace/api-server db:migrate` against `POSTGRES_URL_NON_POOLING`, or the manual
`migrate.yml` workflow. That is the whole setup. `0003_restock_alerts.sql` carries its
own RLS + revoke lock-down inline (it is numbered past main's `0002_lock_down_public_tables.sql`,
which will not cover a table created after it).

## Testing in production

Sign in to `/studio` as staff, file a back-in-stock request against yourself from the
shop, restock the piece in Notion, then press **"Send back-in-stock alerts"** — blank to
sweep everything, or name the piece. The result panel reports exactly what happened:
emailed N customers across M pieces (broken down per piece), or "not in stock", "everyone
waiting has already been told", "no waiting request matches the sizes that are back". Not
yet exercised against live Notion, Postgres, or Resend; the suites mock all three.
