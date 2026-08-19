<!--
STAGING FILE — not the instructions for this branch.

This is the cleaned CLAUDE.md for the `development` branch, whose code differs
from `main` (studio dashboard + internal tools, intake color picker, return
refunds; no SEO prerendering, Sheets 503 retry, or Postgres Data-API lockdown).
To apply: on `development`, replace CLAUDE.md with this file and delete this
staging copy from `main`.
-->

# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**AA-Atelier** is the order-management web app for a custom figure skating/dance
costume business. Two core customer flows:

1. **Order status lookup** — a customer enters an order number and sees a vertical
   timeline of their garment's progress.
2. **New order intake** — a customer submits contact details, body measurements,
   and dress notes to place a custom order.

These sit inside a marketing site: a landing page plus Services, About, Shop, and
Contact, reachable from a global navbar. All are fully built out.

**There is no traditional database for orders.** Orders live in a **Notion**
database the team manages through the Notion UI; the API server talks to the
Notion REST API. The one relational store is an optional Supabase Postgres
integrity layer (see [Postgres](#postgres)).

Deployed on **Vercel**. See `.agents/memory/vercel-migration.md`.

## Repository layout

A **pnpm workspace monorepo**. Package globs live in `pnpm-workspace.yaml`:
`artifacts/*`, `lib/*`, `tests`. Every workspace package is named
`@workspace/<name>`. (`scripts/` is plain bash tooling, deliberately _not_ a
workspace package.)

```
artifacts/
  web-app/           Frontend SPA (Vite + React 19 + Tailwind v4 + shadcn/ui)
    src/App.tsx      wouter routes + global <Navbar /> and <Footer />
    src/pages/       one component per route: home, track, order-form, invoice,
                     services, about, shop, shop-success, contact, appointments,
                     appointment-manage, account, account-login, account-callback,
                     account-reset, privacy, terms, shipping-returns, not-found
    src/components/  navbar.tsx (global nav), page-shell.tsx (page wrapper),
                     footer.tsx, legal-page.tsx, and ui/ (shadcn primitives —
                     pruned to only those used; re-add with `npx shadcn add <name>`)
    src/lib/pdf/     client-side jsPDF invoice + receipt documents
  api-server/        Backend (Express 5) — talks to Notion, bundled by esbuild
    src/routes/      thin HTTP handlers (validate → service → respond)
    src/services/    HTTP-agnostic use-cases
    src/middlewares/ zod validation, auth, rate limit, spam filter, error handler
    src/lib/notion/  Notion adapter: client, schema mapping, block builder, repos
    src/lib/google/  Google Calendar + Sheets (appointments)
    src/lib/resend/  Transactional email + the marketing audience sync
    src/lib/stripe/  Stripe client, payment methods, promotion codes
    src/lib/supabase/ Supabase client (verifies the account portal's JWT)
    src/lib/db/      Postgres integrity layer (client seam + repositories)
    src/lib/settings/ Studio Settings snapshot read by the sync config getters
    src/scripts/     migrate.ts, backfill-order-index.ts, backfill-legacy-fields.ts
api/
  index.ts           Vercel serverless entrypoint — re-exports the built Express app
lib/
  api-spec/          OpenAPI spec (openapi.yaml) + orval config — SOURCE OF TRUTH
  api-zod/           GENERATED zod schemas (server-side validation)
  api-client-react/  GENERATED react-query hooks + typed fetch client
  test-fixtures/     Shared domain fixtures for all three test suites
supabase/migrations/ Postgres schema (applied by `pnpm db:migrate`)
scripts/             cleanup.sh (`pnpm clean`), install-hooks.sh, git hooks
tests/               Playwright e2e (`e2e/`) and production smoke (`smoke/`) suites
.agents/memory/      Durable notes on past decisions & gotchas — READ THESE
vercel.json          Vercel build + routing config
```

## Architecture & data flow

```
Browser (web-app SPA)
  │  fetch /api/*
  ▼
Express app (artifacts/api-server)  ──►  Notion REST API (system of record)
                                    ├──►  Resend (customer + atelier email)
                                    ├──►  Stripe (checkout, refunds, promo codes)
                                    ├──►  Google Calendar + Sheets (appointments)
                                    ├──►  Supabase Auth (verify account-portal JWT)
                                    └──►  Postgres (optional integrity layer)
```

- **Locally:** the Vite dev server proxies `/api` to Express on `localhost:3000`
  (`artifacts/web-app/vite.config.ts`).
- **On Vercel:** `vercel.json` rewrites `/api/:path*` → `/api/index`, the
  serverless function at `api/index.ts`. That file imports the **pre-bundled**
  Express app from `artifacts/api-server/dist/app.mjs` (built by esbuild during
  `build:vercel`). It imports the built artifact — not the TS source — so
  `@vercel/node` doesn't type-check the whole workspace graph. **Don't "fix" this
  by importing the source.**

### API surface

Routes under `/api`. Everything is in the OpenAPI contract **except** where
marked _off-contract_ — those are hand-mounted in `app.ts` rather than the `/api`
router, because they are machine-to-machine or raw-bytes paths, not part of the
browser API or the generated client.

| Route                                         | Purpose                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                 | `{ status: "ok" }`                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET /studio/access`                          | "am I studio staff?" — the probe behind the navbar's staff-only Studio link. Runs the SAME `requireStaff` gate as the figures (401 / 403 / 200 `{ staff: true }`) and reads nothing: reaching the handler IS the answer                                                                                                                                                                                              |
| `GET /studio/analytics`                       | The internal dashboard's figures: custom + shop orders by stage, production load against due dates, revenue by month, deposits vs. balances, best-selling pieces. Aggregated live from Notion (bounded full-database scans, 60s cached). Same Bearer JWT as the portal PLUS a staff allowlist: 401 not signed in, 403 signed in but not staff                                                                        |
| `POST /studio/tools/:tool`                    | The atelier's five internal actions, run from the signed-in dashboard — `milestones`, `invoice-lines`, `status-email`, `cancellation-refund`, `return-refund`. Staff-gated; each returns a composed `{ status, title, message, details }`. **Contract-first**, unlike the links it replaced                                                                                                                          |
| `GET /account/overview`                       | The signed-in customer's custom orders + shop orders (with measurements) + upcoming appointments + referral, keyed by the email on their Supabase access token. Appointments come from Google Calendar and carry a signed manage token (best-effort — degrades to none on a calendar outage). Bearer-JWT gated (401). Sign-in runs on Supabase Auth in the browser; there is **no** server login/logout/verify route |
| `GET /orders/:orderNumber`                    | Order status + stage list                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /orders`                                | Creates a Notion page, returns the order number, sends a confirmation email, best-effort upserts a Client CRM record by email and links the order to it. Optional `referenceImageIds` are attached as image blocks                                                                                                                                                                                                   |
| `POST /orders/reference-images`               | _Off-contract._ Relays one raw customer-uploaded reference image to Notion's File Upload API and returns its `file_upload` id                                                                                                                                                                                                                                                                                        |
| `POST /orders/:n/payments/:stage`             | Stripe Checkout session for one payment stage — `first_deposit`, `second_deposit`, or `balance` — each priced server-side from the order's Notion invoice                                                                                                                                                                                                                                                            |
| `POST /orders/:n/measurement-change-requests` | Files a measurement-change request into "Website Contact Messages" (`Request type = Measurement update`). Gated: values-or-appointment, email must match the order, rejected once in production (`MEASUREMENT_LOCK_FROM_STAGE`). Never edits the order                                                                                                                                                               |
| `POST /orders/:n/reviews`                     | Files a post-delivery review (rating, testimonial, optional credit name, publish consent, photos) into the Notion "Reviews" database. Gated on final stage + email match                                                                                                                                                                                                                                             |
| `POST /orders/:n/cancellation-requests`       | Files a cancellation request into the contact database (`Request type = Cancellation`). Gated on email match; rejected once delivered (that's a return). Never refunds                                                                                                                                                                                                                                               |
| `POST /contact`                               | Saves a contact message to "Website Contact Messages" + acknowledgement email                                                                                                                                                                                                                                                                                                                                        |
| `GET /products`                               | Shop inventory + the live category list, from the Notion "inventory" database                                                                                                                                                                                                                                                                                                                                        |
| `GET /colors`                                 | The studio's intake color palette for the order form's picker (id + name + hex per chip). Read from the atelier-editable `COLOR_PALETTE` Studio Settings value, falling back to a built-in primary palette, so it's always non-empty. No dedicated Notion database                                                                                                                                                   |
| `GET /shop-orders/:orderNumber`               | A shop order's fulfillment `Status` + the live status list, for the tracking timeline                                                                                                                                                                                                                                                                                                                                |
| `POST /shop-orders/:n/cancellation-requests`  | Shop cancellation request. Email match only (no delivered gate)                                                                                                                                                                                                                                                                                                                                                      |
| `POST /shop-orders/:n/return-requests`        | Return/exchange request (`Request type = Return / exchange`). Email must match (403); legacy orders with no stored email are accepted but flagged unverified. Never refunds                                                                                                                                                                                                                                          |
| `POST /notify`                                | Back-in-stock request (`Request type = Back in stock`) + confirmation email                                                                                                                                                                                                                                                                                                                                          |
| `POST /newsletter`                            | Marketing opt-in (`Request type = Newsletter`) + best-effort welcome email from the contact sender. **No** atelier notification                                                                                                                                                                                                                                                                                      |
| `POST /checkout`                              | Prices requested in-stock items from live Notion inventory, creates a Stripe Checkout session, returns the hosted URL                                                                                                                                                                                                                                                                                                |
| `GET /checkout/session/:id`                   | A session's status + itemized receipt for the success page                                                                                                                                                                                                                                                                                                                                                           |
| `GET /appointments/options`                   | Bookable appointment types (duration, allowed staff + locations) + booking timezone                                                                                                                                                                                                                                                                                                                                  |
| `GET /appointments/availability`              | Open slots for a type/location/(staff) over a date window — config working hours minus Google Calendar free/busy                                                                                                                                                                                                                                                                                                     |
| `POST /appointments`                          | Books an open slot (re-checked server-side), writes a Google Calendar event inviting the customer (+ Meet for virtual), emails a confirmation with a signed manage link                                                                                                                                                                                                                                              |
| `GET /appointments/manage`                    | Current details of a booking, identified by the signed token, read live from Google Calendar                                                                                                                                                                                                                                                                                                                         |
| `POST /appointments/reschedule`               | Moves the booking to a new open slot — same staff/type/location, PATCHes the event, re-notifies, emails                                                                                                                                                                                                                                                                                                              |
| `POST /appointments/cancel`                   | Cancels the booking by its signed token; deletes the event, frees the slot, emails. Idempotent                                                                                                                                                                                                                                                                                                                       |
| `POST /webhooks/stripe`                       | _Off-contract._ Stripe → server (raw body, signed). On `checkout.session.completed` records the paid order in "Shop Orders", or routes a `custom_payment` to the invoice                                                                                                                                                                                                                                             |
| `POST /webhooks/notion-stage-change`          | _Off-contract._ A Notion database automation posts here on a `Stage` change; the server reads the order back from Notion and sends the status-update email. Forward-movement only. Bearer `CRON_SECRET` or `?secret=`                                                                                                                                                                                                |
| `GET /cron/generate-milestones`               | _Off-contract._ Vercel Cron reconciliation (Bearer `CRON_SECRET`, JSON): generates per-stage milestone rows, then sends due fitting and payment reminders                                                                                                                                                                                                                                                            |

`CRON_SECRET` survives for exactly two machine callers that can send a header:
**Vercel Cron** → `GET /cron/generate-milestones`, and the **Notion stage-change
automation** → `POST /webhooks/notion-stage-change` (which also still accepts
`?secret=` — the one place left that reads the secret from a URL, kept only
because a live automation may already be configured that way). Everything else the
atelier used to trigger from a `?secret=` link now runs from the staff-gated
dashboard; see **Internal tools on the studio dashboard**.

### Email side effects

The customer-notification POST endpoints (`/orders`, `/contact`, `/notify`,
`/newsletter`, `/appointments`, `/appointments/reschedule`,
`/appointments/cancel`, the measurement-change, review, cancellation, and
return-request endpoints) each send a customer email via **Resend** as a
**best-effort** side effect after the Notion write: logged-and-swallowed on
failure, never changing the response status. Adapter:
`artifacts/api-server/src/lib/resend/`.

Each also sends an **internal atelier notification** (with **Reply-To** set to the
customer) — but only when the category's inbox var is set; unset means the
notification is skipped and only the customer email goes out. Customer-facing and
atelier-facing builders live side by side in `lib/resend/emails.ts`. The
exception is `/newsletter`, which deliberately sends **no** atelier notification:
a mailing-list opt-in needs no triage.

Emails resolve a **sender** and **inbox** per **category** (`lib/resend/config.ts`)
— **orders**, **contact**, **appointments** — with per-category overrides falling
back to the base vars when unset, so an unset override is identical to a
single-address setup. The service resolves the pair via
`fromAddress(category)` / `atelierInbox(category)`; the client uses a per-message
`from` over its base. See [Environment variables](#environment-variables).

**Order status-change emails** are the one notification that can't fire from a
request — stage changes happen inside Notion and there is no Notion→app trigger.
They're driven by a Notion database automation calling
`POST /api/webhooks/notion-stage-change`. Same Resend adapter, same best-effort
contract.

### Production error alerting

On top of logging, the app emails an alert to `ALERT_INBOX_EMAIL` (default
`alexandra@a3iceanddance.com`) on error-level conditions that would otherwise be
invisible: an unhandled 500 (`middlewares/error.ts`), a failed Stripe-webhook
record, a failed milestone cron, and a customer email Resend rejects
(`lib/resend/send.ts`). This is `services/alert.service.ts` (`reportError` /
`reportEmailFailure`).

A Vercel Log Drain was rejected because Log Drains need a Pro plan (the project is
on Hobby) and an in-process, **awaited** send flushes reliably on serverless,
where a fire-and-forget drain can be frozen before it delivers.

Load-bearing rules:

- The alert sends via the **strict** `sendEmail` and logs its own failures at
  `warn`, **never re-entering `reportError`** — this is the loop guard.
- It self-gates when `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are unset, so it's
  inert in dev/test and never blocks a response.
- A per-instance 5-minute de-dupe bounds repeats (it cannot throttle across
  serverless instances).
- It is deliberately **not** wired to the CRM-upsert catch (`warn`-level, order
  unaffected) or the shipping-rate catch (documented degraded-but-OK,
  high-frequency), to keep alerts high-signal.

## The API is contract-first — the most important convention

`lib/api-spec/openapi.yaml` is the **single source of truth** for the HTTP API.
Two packages are **generated from it** by [orval](https://orval.dev) and must
never be hand-edited:

- `lib/api-zod` — zod schemas the **server** uses to validate/parse requests and
  responses (`CreateOrderBody`, `GetOrderStatusResponse`, …).
- `lib/api-client-react` — **react-query hooks** (`useGetOrderStatus`, …) and a
  typed `customFetch` client for the frontend.

Files under `src/generated/` carry a "Do not edit manually" header. To change the
API:

1. Edit `lib/api-spec/openapi.yaml`.
2. Run `pnpm --filter @workspace/api-spec run codegen` (orval, then a re-typecheck
   of the libs).
3. Update the server route handlers and frontend as needed.

`lib/api-client-react/src/custom-fetch.ts` is the **mutator** — hand-written, not
generated. It's the fetch/error-handling layer all generated hooks route through,
and is safe to edit. See `.agents/memory/orval-zod-codegen-drift.md`.

Both frontend flows go through the generated client: `pages/track.tsx` uses
`useGetOrderStatus` (custom) and `useGetShopOrderStatus` (shop);
`pages/order-form.tsx` uses the `useCreateOrder` mutation. The form's local zod
schema is checked against the generated `NewOrderRequest` where it hands data to
the mutation, so it can't silently drift from the contract.

## Working with Notion (read `.agents/memory/` first)

The integration lives in `artifacts/api-server/src/lib/notion/`: `client.ts` (REST
client), and per-domain `*.schema.ts` (property-name constants + extraction
helpers), `*.blocks.ts` (page-body builders), `*.repository.ts` (create/lookup).
Keep that prefixed convention.

Auth: the server reads `NOTION_API_KEY` and the database ids from environment
variables via `createNotionClient`, **at first use rather than module load**. The
integration must be shared with every database or queries 404.

### 1. Property types must match the live schema, not the property name

"Order Number" is a Notion `rich_text` property, **not** `number` — values have
leading zeros (`"000002"`). Filters must use `rich_text: { equals }`. Before
writing any Notion filter, inspect the actual `type` of the property on a sample
page. See `.agents/memory/notion-status-filters.md`.

### 2. Never hardcode a Notion option list

The atelier edits select/status options directly in Notion and expects changes to
appear without a redeploy.

- **Order stages.** `fetchLiveOrderStages()` reads the **Stage** options live from
  `GET /v1/databases/{id}` with a 60s in-memory TTL cache, falling back to the
  cached list on error (`notion/orders.repository.ts`). Don't reintroduce a
  hardcoded constant. (The per-stage _description text_ in
  `web-app/src/lib/stage-descriptions.ts` is cosmetic flavor only.)
- **Shop categories** are a dedicated "Product Categories" database. Each
  inventory row points at one via a `Category` **relation**;
  `listCategoryRecords()` (`notion/product-categories.repository.ts`, same 60s
  cache + fallback) reads the name, `Show size guide`, `Size Guide Type`, and
  `Sort` order, and `products.service` resolves each product's category, `sized`
  flag, and `sizeGuide` by joining the relation. A rename propagates
  automatically (the relation follows the page); a new category defaults unsized.
  `NOTION_PRODUCT_CATEGORIES_DATABASE_ID` is required — there is no fallback.
- **Which size chart a category shows is Notion-driven, not name-matched.** The
  shop has two charts (`web-app/src/components/size-chart-dialog.tsx`): the
  ready-to-wear body-measurement chart (Jalie bands) and the skate-soaker
  blade-length chart. A category's `Size Guide Type` **select** picks between them
  through the same relation, so renaming a category never breaks routing. A soaker
  category is treated as sized regardless of its `Show size guide` checkbox, so
  the atelier only sets the one select. On the API this is `Product.sizeGuide`
  (`garment` | `soaker`, omitted ⇒ garment); the frontend passes it to
  `SizeChartDialog`'s `variant` prop.

**Deliberate exceptions** — targeted business rules that name specific option
_values_. Rename these options in Notion and you must update the code:

| Constant                      | Value it names                                                                        | Where                          |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------ |
| `STATUS_IN_STOCK`             | "In Stock", the only sellable status                                                  | `products.schema.ts`           |
| `MEASUREMENT_LOCK_FROM_STAGE` | The stage at/after which measurements freeze (default `Cutting/Pinning`, overridable) | `services/measurement-lock.ts` |
| `SIZE_GUIDE_TYPE_SOAKER`      | `"Skate soaker"`, routing a category to the blade chart                               | `product-categories.schema.ts` |
| `USAGE_TYPE_PACKAGING`        | `"Packaging"` usage lines, never itemized                                             | `costing.schema.ts`            |
| `FITTING_REMINDER_STAGES`     | The stage(s) that trigger a fitting reminder (default `Fitting`)                      | `services/fitting-reminder.ts` |

`measurementsLocked()` is the lock gate, consumed by
`services/measurement-change.service.ts`.

### 3. The contact database has six writers

"Website Contact Messages" holds contact-form messages (`contact.blocks.ts`),
back-in-stock requests (`notify.blocks.ts`), measurement-change requests
(`measurement-change.blocks.ts`), newsletter opt-ins (`newsletter.blocks.ts`),
cancellation requests (`cancellation.blocks.ts`), and shop return/exchange
requests (`return-request.blocks.ts`), separated by the **Request type** select
(`Inquiry` / `Back in stock` / `Measurement update` / `Newsletter` /
`Cancellation` / `Return / exchange`).

A restock request carries **Item** and **Size** as real properties, a
measurement-change request carries the order number + requested measurements, and
a return/exchange request carries the shop order number + kind + reason (reusing
the shared **Item** property), so the atelier can filter by request type rather
than reading it out of free text. A newsletter opt-in needs no property of its own
— email plus the shared Subject/Stage/Request type carry it, with its `source`
(footer / order form) folded into the subject.

**The shared property names are exported from `contact.blocks.ts` and imported by
the other five — keep it that way so they can't drift** (the return writer also
reuses `NOTIFY_ITEM_PROPERTY` from `notify.blocks.ts`).

All six best-effort **link to the Client CRM** via the shared `Client` relation
(`CONTACT_CLIENT_PROPERTY`), using the same `upsertClientByEmail` the order flow
uses: an inquiry / back-in-stock / newsletter opt-in creates a `Lead`; a
measurement change / cancellation / return reuses the order's existing (`Active`)
client. See `.agents/memory/notion-p2-duplicates.md`.

### The newsletter opt-in and the Resend audience

`POST /api/newsletter` records explicit marketing consent, sends a best-effort
**welcome** email from the **contact** sender (keeping it off transactional
orders@), and sends **no** internal atelier notification. Two capture surfaces
feed it: a footer field (`components/newsletter-signup.tsx`) and an intake
checkbox on the order form (`pages/order-form.tsx` fires a separate best-effort
`useSubscribeNewsletter` call, so the order contract is untouched). It needs no
new database — it reuses the contact database, the Resend contact sender, and the
optional Client CRM.

**The mailing list is managed in Resend, not Notion — Notion is the record, not
the list manager.** A list needs one-click unsubscribe (a Gmail/Yahoo bulk-sender
requirement), a way to send a campaign, and reputation isolation from
transactional mail; Notion does none of these. So on opt-in the subscriber is
**also** best-effort synced into a **Resend Marketing Audience**
(`upsertAudienceContactBestEffort` in `lib/resend/audience.ts`), which is the
sending list and the **subscription authority** (it owns subscribed/unsubscribed).

Campaigns are composed and sent as Resend **Broadcasts from the dashboard** —
there is deliberately **no** in-app campaign sender or scheduled-send cron. Resend
attaches the one-click unsubscribe and `List-Unsubscribe` header to every
Broadcast, which is what makes the "unsubscribe anytime" copy on the order form
and the **Marketing emails** section of `pages/privacy.tsx` true.

Load-bearing: `lib/resend/audience.ts` is the **only** place the app uses Resend's
Contacts API (everything else in `lib/resend/` is transactional `send`); it
**self-gates** on `RESEND_AUDIENCE_ID` (unset ⇒ sync skipped, opt-in still
captured in Notion) and is **best-effort** (a Resend hiccup never fails the
opt-in). The upsert re-subscribes a previously-unsubscribed email that re-opts-in
(create with `unsubscribed: false`, else PATCH by email).

Setup: create an Audience in Resend → **Audiences**, set `RESEND_AUDIENCE_ID`,
send via Resend → **Broadcasts** (free ≤1,000 contacts; the Marketing track bills
apart from transactional above that).

## Studio Settings (atelier-editable config in Notion)

Runtime **business tunables** can be retuned live from an optional **"Studio
Settings"** Notion key/value database, so the atelier changes them in Notion
instead of editing env vars and redeploying. Same live-read philosophy as stages,
categories, and working hours.

1. **Only non-secret tunables live here.** Secrets (`NOTION_API_KEY`, `STRIPE_*`,
   `RESEND_API_KEY`, `SESSION_SECRET`, `CRON_SECRET`,
   `GOOGLE_SERVICE_ACCOUNT_KEY`, `SUPABASE_ANON_KEY`, `POSTGRES_URL`) and
   bootstrap wiring (every `NOTION_*_DATABASE_ID`, `SUPABASE_URL`,
   `APPOINTMENT_SHEET_ID`, `PUBLIC_BASE_URL`) stay in Vercel — a Notion database
   is not a secrets store, and you cannot read Notion settings without the API key
   and the settings database's own id, so those two are inherently bootstrap.
   Email **senders** (`RESEND_*_FROM_EMAIL`) also stay env-only: they're coupled
   to Resend domain verification, so a wrong value would silently break delivery.

   The readable keys are enumerated in `SETTING_KEYS` (`lib/settings/store.ts`):
   `RUSH_SURCHARGE_RATE`, `MEASUREMENT_LOCK_FROM_STAGE`, the four `APPOINTMENT_*`
   policy vars, the four notification inboxes (`ATELIER_INBOX_EMAIL`,
   `ATELIER_CONTACT_INBOX_EMAIL`, `ATELIER_APPOINTMENTS_INBOX_EMAIL`,
   `ALERT_INBOX_EMAIL`), and the four reward amounts (`REFERRAL_CREDIT_AMOUNT`,
   `REFERRAL_WELCOME_PERCENT`, `RETURNING_DISCOUNT_PERCENT`,
   `REWARD_CODE_EXPIRES_DAYS`).

2. **Resolution order is Notion → env → default.** Every getter reads
   `settingValue(KEY) ?? process.env[KEY] ?? default`, so an unset row or an
   unconfigured database behaves **exactly** as env-only did. The Notion `Setting`
   (title) matches the env var name 1:1 so the mapping can't drift; a `Value` and
   a human `Description` complete the row. A blank `Value` reads as unset.

3. **Sync getters, primed once per request.** The getters are synchronous; Notion
   I/O is async. `app.ts` mounts a middleware that `await primeSettings()` at the
   start of every request, refreshing the in-memory snapshot the getters read. The
   read itself is a 60s TTL cache + fallback (`lib/notion/settings.repository.ts`),
   self-gating to an empty map when `NOTION_SETTINGS_DATABASE_ID` is unset or a
   fetch fails, so a settings hiccup never errors a request. Until primed (tests,
   first request) the snapshot is empty and everything falls back to env. Test
   seams: `__setSettingsSnapshot` / `__resetSettings` (store) and
   `__resetSettingsCache` (repository).

Setup (optional — unset ⇒ env-only): create the database with a `Setting` title,
a `Value` text, and a `Description` text; share the integration with it; set
`NOTION_SETTINGS_DATABASE_ID`; fill in a `Value` only for what you want to
override. Code: `lib/notion/settings.{schema,repository}.ts`,
`lib/settings/store.ts`, `getSettingsNotionClient` in `notion/client.ts`, the
prime middleware in `app.ts`, and the consuming getters (`services/rush.ts`,
`services/measurement-lock.ts`, `lib/appointments/settings.ts`,
`lib/resend/config.ts`, `services/alert.service.ts`,
`services/rewards.service.ts`).

## Working with Stripe (shop checkout)

The shop sells ready-to-ship items through **Stripe Checkout (hosted)**. The
client-side cart (`web-app/src/lib/cart.tsx`, persisted to localStorage) POSTs
`{ variantId, size?, quantity }[]` to `/api/checkout`; the server prices them from
live Notion inventory, creates a session, and returns its URL; the browser
redirects; Stripe calls `/api/webhooks/stripe` on completion, which records the
paid order in Notion. Code: `services/checkout.service.ts`, `lib/stripe/client.ts`,
`routes/checkout.ts`, `routes/stripe-webhook.ts`, `lib/notion/shop-orders.*`.

1. **Never trust client-sent money.** The cart sends only ids/sizes/quantities.
   `checkout.service` recomputes every price and availability from `listVariants()`
   (live Notion), converts dollars → integer cents (`Math.round(price * 100)`), and
   rejects sold-out / unpriced / unknown items with a `BadRequestError` (→ 400). An
   "inquire for price" item (no `Listed Price`) is not purchasable.

2. **The webhook needs the RAW body.** Stripe verifies the signature against the
   exact bytes, so `/api/webhooks/stripe` is mounted in `app.ts` with
   `express.raw()` **before** the global `express.json()`, and directly on the app
   rather than the `/api` router.

3. **Recording is idempotent.** With the **Postgres layer** configured, shop-order
   dedup is an atomic `processed_payments` **claim**: `recordPaidOrder` claims the
   session id (`insert … on conflict do nothing`), writes the Notion order, then
   confirms; a failure releases the claim so a redelivery reprocesses cleanly, and
   a still-`processing` claim throws so Stripe retries later instead of racing a
   duplicate. With Postgres unset it falls back to the Notion read-before-write
   dedup (`findOrderBySessionId` before insert). The Notion guard is retained
   either way as a reclaim-only backstop, since `createShopOrder` isn't itself
   idempotent. Custom-order payments don't use `processed_payments` —
   `recordPayment` is idempotent via the Notion invoice write alone (a redelivery
   sets the same paid checkbox).

4. **Inventory is manual for v1.** A sale does not decrement Notion stock — the
   atelier adjusts it by hand. `Quantity Available` is a Notion **formula** and
   can't be written; auto-decrement would need a new writable count property plus
   reservation logic. Don't wire it up without that.

5. **Shipping rates live in Stripe, not code.** `checkout.service` reads
   `STRIPE_SHIPPING_RATE_IDS` (comma-separated `shr_…` ids the atelier creates and
   prices in the Dashboard) and attaches them as the session's `shipping_options`;
   unset means no shipping is charged. The order's `Total` (Stripe `amount_total`)
   includes shipping + tax, and `buildShopOrderPageBlocks` adds "Shipping" and
   "Tax" lines to the Notion page body so the bullets reconcile with it.

   Each id is **validated at session-create time** (`resolveShippingOptions`):
   retrieved from Stripe and kept only if it exists, is active, and is priced in
   USD. An id that fails — deleted/archived, or from the wrong Stripe mode — is
   **dropped and logged at `error`** rather than 500-ing the checkout; if every id
   is invalid, checkout proceeds with no shipping charged. A stale id degrades the
   shop, it doesn't take it down — but watch the logs for "Skipping shipping rate".

6. **Tax is Stripe Tax, on the shop cart only.** `checkout.service` sets
   `automatic_tax: { enabled: true }` and `tax_behavior: "exclusive"` (listed
   prices are pre-tax), so tax is computed from the collected address — configure
   the origin and a default tax category in the Dashboard, or it computes $0.
   **Deposits are intentionally untaxed** (tax is assessed on the final balance),
   so `invoice.service` sets `automatic_tax` only on the `balance` stage.

7. **Receipts are Stripe's job; the success page mirrors them.** The emailed
   receipt is a Dashboard setting (Settings → Emails → "Successful payments"), not
   code. `getCheckoutSession` retrieves the session with `expand: ["line_items"]`
   and returns an itemized view (line items + subtotal / shipping / tax / total, in
   dollars); `pages/shop-success.tsx` renders it as an on-site receipt and offers a
   client-side PDF download (`lib/pdf/receipt-pdf.ts`). Works for both shop-cart
   orders and deposits.

8. **Each shop order gets a human-readable order number.** `createCheckoutSession`
   mints an `SHP-…` number (`generateShopOrderNumber` in `shop-orders.blocks.ts`)
   into `metadata.orderNumber`, so it reaches the webhook with no extra Stripe
   round-trip. `buildShopOrderProperties` writes it to the Shop Orders
   `Order Number` (rich_text) property, and `getCheckoutSession` returns it for the
   success page. The customer tracks the order at `pages/track.tsx`
   (`GET /shop-orders/:orderNumber` → `services/shop-orders.service.ts` →
   `findShopOrderByNumber` / `fetchLiveShopOrderStatuses`), which reports the live
   Notion `Status` workflow as a timeline (read live, never hardcoded — same rule
   as order stages). The number also appears in the shop confirmation email and
   the atelier notification. **The lookup only serves orders placed after this
   shipped** — older ones have no `Order Number`.

   Once shipped, the atelier can add **carrier tracking**: three **optional,
   additive** properties the app only ever reads — `Tracking Number` (rich_text),
   `Carrier` (rich_text, a display label), and `Tracking URL` (url).
   `findShopOrderByNumber` reads them via `readTracking`, **gated on the number**
   (a carrier/url with no number is meaningless, so it's dropped), into
   `ShopOrderRecord.tracking` → `ShopOrderStatus.tracking` (contract-first).
   `shop-order-result.tsx` renders a "Tracking" panel below the timeline: the
   number linked to the URL when set, else plain text. Suppressed on a cancelled
   order. Nothing to write — the atelier just adds the properties and fills them in.

9. **Matching add-ons are a self-relation on the inventory, resolved client-side.**
   A product can offer companion items (a skate soaker → its matching blade towel)
   via a **`Matching Add-ons`** relation pointing at other inventory rows. An
   add-on is an ordinary in-stock, priced, one-size variant that also appears as
   its own shop card. `products.schema.ts` maps the relation to `addOnIds: string[]`
   (`extractRelationIds`), the service passes it through (omitted when empty), and
   `ProductVariant.addOnIds` carries just the ids — the frontend resolves them
   against the already-loaded product list (`resolveAddOns` / `indexVariants` in
   `pages/shop.tsx`, keeping only in-stock priced add-ons), so the payload never
   carries the cloth twice. `add-to-cart.tsx` renders an opt-in checkbox per
   resolved add-on; a ticked one is added as its **own** cart line (quantity 1,
   independent of the main item), so `checkout.service` prices and stock-checks it
   with **no** checkout changes. Because they're distinct lines, removing the soaker
   doesn't remove the cloth (accepted for v1). Add-ons follow the _selected_
   variant, so a color-specific relation shows the right match.

10. **Installment financing (BNPL) is an opt-in env list, priced by Stripe.**
    `STRIPE_BNPL_METHODS` (comma-separated from `klarna`, `affirm`,
    `afterpay_clearpay`) offers buy-now-pay-later — Stripe pays the studio **in
    full up front** and carries the installment risk, so nothing extra reconciles
    on our side. `bnplPaymentMethodTypes()` (`lib/stripe/payment-methods.ts`)
    validates the list against the supported set (unknown ids dropped + logged at
    `error`) and returns `["card", ...methods]`.

    **Applied to the shop cart and the custom-order final balance only** — both
    collect an address that BNPL needs; deposits are partial pre-payments and stay
    card-only (`taxed ? bnplPaymentMethodTypes() : undefined` in `invoice.service`).
    Load-bearing: setting the var **pins** `payment_method_types` to card + these
    methods, **overriding Stripe's dynamic payment methods** on those sessions (so
    other Dashboard methods like Link won't appear); **unset ⇒
    `payment_method_types` is omitted ⇒ dynamic methods, exactly as before.** Card
    is always prepended and an all-invalid list degrades to omitted, so a typo can
    never produce a card-less checkout. Each method must **also** be enabled in the
    Dashboard, is **mode-scoped** like the shipping rates, and Stripe hides an
    ineligible method itself, so no amount-gating lives here.

Setup: create the "Shop Orders" Notion database (properties in
`shop-orders.blocks.ts`, including `Order Number`) and share the integration with
it. Local testing uses Stripe test-mode keys plus
`stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

### Custom-order payments (the invoice is the source of truth for all three stages)

Custom orders are quoted offline and paid online in **three staged payments**: a
**first deposit** (after the design is finalized), a **second deposit** (at the
first fitting), and the **final balance** (itemized materials + labor − both
deposits). All three are owned by the order's **invoice** in the atelier's Notion
finance system — the app **reads** that, it does not recreate or recompute the
costing. The order row carries only the `Invoices` relation (limit 1) and holds
**no** deposit fields.

- **`invoices & payments`** (`NOTION_INVOICES_DATABASE_ID`): one invoice per order
  (`Order` relation), with `Final Balance` (sums the linked `Line Total`s — it has
  been both a rollup and a formula; the app reads either), `Line Items` relation,
  `Invoice Ready`, and the payment fields: `First/Second Deposit Amount` (number),
  `First/Second Deposit Paid` (checkbox), `First/Second Deposit Session Id`
  (rich_text), `First/Second Deposit Due` (date), `Balance Paid` (checkbox),
  `Balance Payment Session Id` (rich_text), `Payment Deadline` (date). Three
  atelier-facing formulas sit on top and are **not** read by the app: `Paid to
Date`, `Remaining to Collect`, and `Payment Status`. Property names live in
  `lib/notion/invoice.schema.ts`.
- **`Invoice Line Items`** (`NOTION_INVOICE_LINE_ITEMS_DATABASE_ID`): each line has
  a `Line Type` (Garment / Material / Labor / Adjustment / Surcharge) and a
  `Line Total` (formula). Each material is its own row. **Deposits are not line
  items** — they live on the invoice head, so there is deliberately no "Deposit"
  option here.

One endpoint serves all three: `POST /orders/:n/payments/:stage`, `stage ∈
{first_deposit, second_deposit, balance}` (`routes/orders.ts` →
`createPaymentCheckout` in `services/invoice.service.ts`).

1. **Every amount is priced server-side from the invoice.** A deposit's amount is
   its `First/Second Deposit Amount`; the balance is `balanceDue = Σ(Line Totals) −
Σ(deposits marked paid)`, floored at 0 (`buildInvoiceView`). **`Line Type =
Deposit` rows are excluded from the subtotal** — deposits are payments against
   the total, not line items. That option no longer exists in Notion, so the filter
   is a **guard**, kept because re-adding it would otherwise bill a customer for
   their own deposit (Notion's `Final Balance` has no such filter, so a Deposit
   line would inflate the atelier's view while the app stayed correct). A stage
   with no amount set, an already-paid stage, or (for the balance) an unready
   invoice all 400.

2. **Deposits are payable before the invoice is itemized.** `getOrderStatus`
   surfaces `deposits[]` from the invoice head as soon as an amount is set,
   independent of `Invoice Ready`. The itemized `invoice` object (and the balance
   charge) is gated on `Invoice Ready`. Rendered by the tracking page's deposit
   cards and "View Invoice" button (`components/custom-order-result.tsx`) and by
   `pages/invoice.tsx` (`/invoice/:orderNumber`), which also offers a client-side
   PDF download (`lib/pdf/invoice-pdf.ts`).

3. **Tax on the balance only.** The balance checkout sets `automatic_tax`,
   `tax_behavior: "exclusive"`, and `billing_address_collection: "required"` (no
   shipping step). Deposits stay untaxed.

4. **Write-back is invoice-only and idempotent.** The **one** webhook routes
   `metadata.kind = "custom_payment"` to `recordPayment` → `markInvoicePaid(invoice,
stage, sessionId)`, which ticks that stage's paid checkbox and session-id text on
   the invoice, never the costing formulas. Everything else is a shop-cart order.
   The paid checkbox is the "already paid" guard; the shop-success page skips
   clearing the cart for `custom_payment`.

Setup: add the deposit + balance payment fields to **invoices & payments** (the
order keeps only the `Invoices` relation); share the integration with **invoices &
payments** and **Invoice Line Items**; set the two env vars.

### Generating invoice line items from the costing

Itemizing an invoice by hand is where a **double charge** creeps in: the
`costing (custom orders)` item is a _whole-garment aggregate_ (its `Suggested
Price` folds in materials + labor + margin), so a costing-item line **plus**
separate material/labor lines counts the same money twice. The `Unit Price`
formula resolves the costing item ahead of the material usage line, so even a
"Material" line linked to both silently bills the whole garment.

The generator removes this by owning the itemization. The studio dashboard's
**Itemize an invoice** tool (`POST /api/studio/tools/invoice-lines` with
`{ orderNumber }`, staff-gated) reads the order's costing and writes:

1. **one Material line per non-packaging material usage line**, priced at that
   line's `Line Material Cost` (at cost);
2. **one Labor line** at the summed costing `Labor Cost`;
3. **one reconciling `Adjustment` line, "Design & finishing"** = Σ(costing
   `Suggested Price`) − (materials + labor), folding the margin in so the itemized
   total lands **exactly** on the costing's margin-loaded price.

Load-bearing: every generated line prices via **`Manual Unit Price`** at quantity 1
and **never links the `Costing Item`** — that link only matters when the manual
price is blank, and avoiding it makes the aggregate-vs-components double charge
structurally impossible. It also sets the invoice title (`Invoice ID`) to the
order's `ORD-` number (display-only — lookup is by the order's `Invoices`
relation, never the title). **Idempotent**: it skips an invoice that already has
line items (a repeat run only reconciles the title, and reports that it did
nothing); to regenerate after changing the costing, delete the existing lines and
run it again. **Packaging** usage lines
(`USAGE_TYPE_PACKAGING`) are internal cost and never itemized.

Code: `services/invoice-generator.service.ts`, `services/studio-tools.service.ts`,
`lib/notion/costing.{schema,repository}.ts`,
`lib/notion/invoice-line-items.blocks.ts`, and the `createInvoiceLineItem` /
`setInvoiceTitle` writers in `lib/notion/invoice.repository.ts`.

Setup: share the integration with **costing (custom orders)** and the **material
usage database**; set `NOTION_COSTING_DATABASE_ID` +
`NOTION_MATERIAL_USAGE_DATABASE_ID`. There is no Notion trigger to add — the
generator is run from `/studio`, which is what retired the formula-property link
this used to need.

**The `Suggested Price` costing formula is the source of truth for the invoice
total.** Its Notion _description_ text is stale ("Break-even price + labor cost")
but the **formula is correct**: it marks up the break-even cost by the profit
margin and grosses up for selling fees — `round(base × (1 + margin) / (1 −
sellingFees), 2)` with **no `Channel` branch**. The fee is **data-driven**:
`Pricing Settings` has a **Custom / Direct** row (fees 0%) and a **Production /
Marketplace** row (6.5%), and each costing item relates to the right one, so one
formula prices every channel. **Don't "fix" the formula to match the stale
description, and don't add a `Channel` branch** (it would duplicate the Pricing
Settings relation). See `.agents/memory/invoice-building.md`.

## Order cancellation & refunds

A customer can request cancellation of a custom (`ORD-`) or shop (`SHP-`) order,
and the atelier processes the refund in one click — the same **gated customer
request + atelier button** split as every "a customer asks, the atelier actions"
flow.

1. **Customer request (contract-first).** `POST /orders/:n/cancellation-requests`
   and `POST /shop-orders/:n/cancellation-requests` file a `Request type =
"Cancellation"` row into the contact database (`cancellation.blocks.ts`),
   verified against the email on the order. The custom endpoint rejects a
   **delivered** order (409 — that's a return); the shop endpoint gates on email
   only. Best-effort customer confirmation + atelier notification + CRM link. This
   **never** refunds or edits the order. Code: `services/cancellation.service.ts`,
   `routes/orders.ts` + `routes/shop-orders.ts`,
   `lib/notion/cancellation.{blocks,repository}.ts`.

2. **Atelier refund action, from the studio dashboard.**
   `POST /api/studio/tools/cancellation-refund` with `{ orderNumber }`
   (staff-gated). It detects custom vs shop by the number prefix, refunds each paid
   Stripe payment, and sets a `Cancelled` checkbox. Custom orders refund each paid
   deposit + the balance, read off the invoice (`invoice.schema` reads
   `balanceSessionId` back — a read-only add, no new Notion field); shop orders
   refund the single stored checkout session. Code:
   `services/order-cancellation.service.ts`, `services/studio-tools.service.ts`,
   and the `setOrderCancelled` / `setShopOrderCancelled` writers.

3. **Refunds are idempotent and degrade, never double-charge.** Stripe does **not**
   dedupe `refunds.create` (unlike charges), so `refundCheckoutSession` calls
   `refunds.list({ payment_intent })` first and skips if any refund already exists
   — including one the atelier issued by hand — and passes an `idempotencyKey` for
   concurrent-press safety. A `$0`/full-promo session (null `payment_intent`) and a
   paid stage with no recorded session id (paid offline) are **skipped and surfaced
   as "manual refund needed"**, not failures. A per-session throw (e.g. a test-mode
   session id under a live key) is caught, logged at `error`, recorded in the
   summary, and the run continues. The `Cancelled` marker is set **only after every
   attempted refund succeeded**, so a partial failure leaves the order uncancelled
   and a re-run retries safely. The customer refund-confirmation email sends
   **only when something new happened** — a no-op re-run is silent.

4. **State stays in sync.** `cancelled` is surfaced on both status responses
   (`OrderStatus` / `ShopOrderStatus`) from the `Cancelled` checkbox, so the
   tracking page shows a cancelled banner and hides the deposit / invoice / review /
   measurement and cancellation affordances (`custom-order-result.tsx` /
   `shop-order-result.tsx`). The request dialog is the shared
   `components/cancellation-request-dialog.tsx`.

Setup: add a **`Cancelled` checkbox** to the **Order Tracking Pipeline** and **Shop
Orders** databases. Nothing else — the refund is run from the studio dashboard's
**Cancel & refund an order** tool, which is what retired the formula-property link
both databases used to carry. The `Cancellation` `Request type` option auto-creates
on first write.

## Production schedule (auto-generated stage milestones)

The atelier plans work in the **"📅 Production Schedule"** Notion database
(`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`), which has ready-made Timeline and
Calendar views keyed on `Target Completion Date`. The app **auto-generates one
dated milestone row per remaining stage** for any custom order with a firm due
date.

1. **Trigger is a reconciliation cron (plus an on-demand button), not a Notion
   push.** There is no Notion→app trigger, so the atelier sets a `Due Date` on the
   order and the reconciliation later scans for orders that have a due date but an
   unset `Milestones Generated` checkbox. Both entry points call
   `reconcileMilestones` (generation + the two reminder passes): a **Vercel Cron**
   job nightly (`GET /api/cron/generate-milestones`, in `vercel.json` `crons`) and
   on demand from the **studio dashboard** (`POST /api/studio/tools/milestones`,
   staff-gated), for catching up sooner than the next night. Code:
   `routes/cron.ts` → `services/schedule.service.ts` →
   `lib/notion/orders.repository.ts` (`findOrdersNeedingMilestones` /
   `markMilestonesGenerated`) + `lib/notion/production-schedule.{blocks,repository}.ts`.

2. **Scheduling is an even split over the live stage list — don't hardcode
   stages.** `computeMilestoneSchedule` spreads the stages from the order's current
   stage forward evenly across `[today, dueDate]` (the final stage lands on the due
   date; a past-due date clamps all to the due date). The stage list comes live from
   `fetchLiveOrderStages`, so the schedule adapts when the atelier edits stages. The
   milestone's `Production Stage` is a **select**, which Notion auto-creates options
   for, so no stage constant is baked in either. (`Production Stage` is the stage
   _label_, named apart from the derived `Milestone Status` formula below.)

3. **Idempotent.** The `Milestones Generated` checkbox plus an existing-milestones
   lookup (`orderHasMilestones`, by the `Order` relation) stop a re-run from
   duplicating rows. The checkbox is only flipped after every row for an order is
   written, and one order's failure is logged-and-skipped (retried next run) rather
   than aborting the batch. To **reschedule** after changing a due date, uncheck
   `Milestones Generated` and delete the stale rows; the next run regenerates.

4. **Completion status is a live Notion formula — there is no sync pass.** A
   milestone's state is the **`Milestone Status`** formula on the Production
   Schedule database, derived live from the order's `Stage`: an **`Order Stage
Index`** rollup reads the order's stage (through a `Stage Index Sys` index
   formula on Custom Orders, status→0–10), and `Milestone Status` compares this
   row's `Production Stage` index to it — past → `Completed`, current → `In
Progress` (`Completed` at the last stage), ahead → `Not Started`, unknown →
   blank. So the calendar reflects real progress with **nothing to sync**, and
   `buildMilestoneProperties` does not seed a status.

   **Trade-off:** the two formulas **hardcode the 11-stage pipeline order**
   (generation still reads the live list; the formulas degrade to blank for an
   unknown stage), so renaming or reordering Stage options means updating them.

   **Gotcha:** the fitting-reminder query reads `Milestone Status` **client-side**
   — it filters the query only on the `Production Stage` select and `Reminder Sent`
   checkbox, then evaluates the conditions from each row's computed value. A
   `formula: {…}` **filter** on this rollup-derived formula 400s via the API
   ("Unable to filter based on a formula of unknown type"), even though reading the
   value back per row works. Details and the one-time setup live in
   `.agents/memory/phase2-workspace-cards.md`.

Setup: add `Due Date` (date) + `Milestones Generated` (checkbox) to the Order
Tracking Pipeline; add `Production Stage` (select) + `Order` (relation → Order
Tracking Pipeline) to the Production Schedule; share the integration with it; set
`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID` + `CRON_SECRET`. Nothing needs adding in
Notion to run it on demand — that's the **Reconcile production milestones** tool on
`/studio`. Property names live in `orders.schema.ts` and `production-schedule.blocks.ts`.

## Automated fitting reminders

When a custom order's **"Fitting"** milestone approaches, the app emails the
customer a best-effort nudge to book, deep-linking into the booking flow
(`/appointments?type=fitting`). It wires the milestone reconciliation and the
Resend mailer together — no new endpoint, no new cron, no frontend change.

1. **It rides the nightly reconciliation.** `reconcileMilestones` runs
   `sendDueFittingReminders` after generation. It finds milestones whose
   `Production Stage` is a configured fitting stage, aren't `Completed`, haven't
   been reminded, and are **either** due on/before `today +
FITTING_REMINDER_LEAD_DAYS` **or** already at the fitting stage (`Milestone
Status = In Progress`).

   **The In-Progress clause is what catches an order running ahead of schedule:**
   it reaches Fitting before the target date, so a date-only filter would never
   fire before the stage advanced to `Completed`, and the reminder would be missed
   entirely.

2. **"Fitting" is a targeted business rule.** `fittingReminderStages()` reads
   `FITTING_REMINDER_STAGES` (default `Fitting`) and `fittingReminderLeadDays()`
   reads `FITTING_REMINDER_LEAD_DAYS` (default `10`). Rename the stage in Notion
   and set the override (or list a first/second fitting). The email's booking link
   uses `PUBLIC_BASE_URL` and is omitted when unset.

3. **Idempotent via a per-milestone `Reminder Sent` checkbox.** A due milestone is
   emailed once, then marked, so the nightly cron never re-sends. An absent or
   unchecked box reads as `false`. A milestone is marked reminded **even when the
   order carries no email** (a legacy order can't be reached — marking it stops a
   nightly re-check); if the order lookup itself throws, the row is left unmarked
   so the next run retries.

4. **Customer email only, best-effort.** Sends from the **appointments** sender.
   There is deliberately **no** atelier notification — the atelier already sees the
   schedule. Milestone rows don't carry the customer email, so each order is
   resolved back through its `Order` relation via
   `findOrderForStageNotificationByPageId`.

Code: `services/schedule.service.ts` (`sendDueFittingReminders`),
`services/fitting-reminder.ts`, `lib/notion/production-schedule.repository.ts`
(`findMilestonesNeedingFittingReminder` / `markFittingReminderSent`), and
`fittingReminderEmail` in `lib/resend/emails.ts`. Setup: add a **`Reminder Sent`**
checkbox to the Production Schedule database (the app writes it; leave unchecked).

## Payment & deposit due reminders

When a custom order's deposit or final balance is **coming due, or overdue**, the
app emails a best-effort nudge to pay, using the due dates already on the invoice.
Same shape as the fitting reminder — no new endpoint, cron, or frontend change
(the CTA deep-links to the tracking page, where the pay buttons live).

1. **It rides the nightly reconciliation.** `reconcileMilestones` runs
   `sendDuePaymentReminders` after generation and fitting reminders. It queries
   **invoices & payments** for invoices with an unpaid stage whose due date is on or
   before `today + PAYMENT_REMINDER_LEAD_DAYS` (which naturally covers
   already-overdue stages) and whose per-stage `Reminded` marker isn't set, then
   emails one reminder **per due stage**. Invoice rows don't carry the customer
   email, so each order is resolved through the invoice's **`Order` relation** via
   `findOrderForStageNotificationByPageId` — **the only place the app navigates
   invoice → order** (everywhere else it reads an invoice _from_ an order's
   `Invoices` relation).

2. **Every amount is read from the invoice, never invented.** A deposit's amount is
   its `First/Second Deposit Amount`; the balance is `Final Balance` − the deposits
   already marked paid (mirroring `buildInvoiceView`'s `balanceDue` without
   fetching line items), floored at 0 and **omitted from the email** when `Final
Balance` isn't set. The three stages' field mapping (due date, paid checkbox,
   `Reminded` marker, label) is the single `PAYMENT_STAGE_REMINDER_FIELDS` table;
   the balance's due date reuses `Payment Deadline`.

3. **Idempotent via a per-stage `Reminded` checkbox** (`First Deposit Reminded` /
   `Second Deposit Reminded` / `Balance Reminded`), flipped after the email. An
   absent or unchecked box reads as false. The order is resolved **once per
   invoice**, then each due stage is emailed and marked; a stage is marked reminded
   **even when the order carries no email**. If the order lookup throws, the
   invoice's stages are left unmarked so the next run retries.

   **This means one reminder per stage** — the first time it's within the window or
   overdue. A repeated-overdue nudge would need a second marker per stage.

   If the query 400s because the setup properties aren't added yet, the pass
   **degrades to a no-op with a `warn`**, so the nightly cron doesn't alert until
   the atelier configures it.

4. **Customer email only, best-effort.** Sends from the **orders** sender, with
   deliberately **no** atelier notification (the atelier already sees `Payment
Status` in Notion). The pay link uses `PUBLIC_BASE_URL`
   (`/track?orderNumber=…`) and is omitted when unset.

Code: `services/schedule.service.ts` (`sendDuePaymentReminders`),
`services/payment-reminder.ts`, `lib/notion/invoice.repository.ts`
(`findInvoicesNeedingPaymentReminder` / `markPaymentStageReminded`),
`extractPaymentReminderInvoice` + `PAYMENT_STAGE_REMINDER_FIELDS` in
`lib/notion/invoice.schema.ts`, and `paymentReminderEmail` in
`lib/resend/emails.ts`.

Setup on **invoices & payments**: add `First Deposit Due` / `Second Deposit Due`
(date) — the balance reuses `Payment Deadline` — plus the three `… Reminded`
checkboxes. Until those exist the pass is a no-op.

## Post-delivery review capture

Once a custom order reaches its **final (delivered) stage**, the tracking page
invites the customer to leave a review: a star rating, a short testimonial, an
optional credit name + publish consent, and photos of the finished piece.
`POST /api/orders/:n/reviews` is contract-first.

1. **"Delivered" is positional — don't hardcode a stage.** There is no "delivered"
   field on an order; `orderDelivered` (`services/delivery.ts`) treats the **last**
   stage in the live `fetchLiveOrderStages` list as delivered, exactly as
   `schedule.service.ts` does. The frontend recomputes the same test to decide
   whether to show the affordance, so the two can't disagree. It **fails closed**
   (no review) when the stage is unknown or the list is empty — a review is a
   one-way action we'd rather withhold on a stale read. This is the mirror of
   `measurement-lock.ts`, which fails **open**; the difference is deliberate.

2. **Two gates, same identity model as measurement-change.** The order must be
   delivered (else `ConflictError` → 409) and the supplied email must match the one
   on the order (`ForbiddenError` → 403). A legacy order with no stored email is
   accepted but flagged **`Email Verified = false`** for the atelier to vet. The
   shared gate is `services/order-identity.ts`; the lookup is
   `findOrderVerification`.

3. **Reviews get their own database and the atelier curates.** Unlike the contact
   writers, reviews land in a dedicated **"Reviews"** database
   (`NOTION_REVIEWS_DATABASE_ID`, **required** — the repository throws if unset).
   Each row carries `Rating` (number), `Review` (rich_text), `Customer Name`,
   `Order Number`, `Email`, `Consent to Publish` (checkbox), `Email Verified`
   (checkbox), a `Status` **select** defaulting to **"New"** (the atelier moves it
   to "Published"), and an optional best-effort `Client` relation. Property names
   live in `reviews.blocks.ts`.

4. **Photos reuse the reference-image upload — no new service.** The browser
   uploads each photo through the same `POST /api/orders/reference-images`
   raw-bytes endpoint the order form uses (via the shared `ReferenceImageUpload`
   component + `lib/reference-images.ts`) and sends the returned ids as `photoIds`;
   `reviews.blocks.ts` attaches them as image blocks.

5. **Best-effort email + CRM.** A customer thank-you (and an atelier notification
   when the inbox is set) go out under the **orders** category; the CRM upsert links
   the review to the customer. A failure never fails the request.

Code: `services/review.service.ts`, `services/delivery.ts`, `routes/orders.ts`,
`lib/notion/reviews.{blocks,repository}.ts`, `components/review-dialog.tsx`
(rendered by `components/custom-order-result.tsx` for delivered orders only).
Setup: create the Reviews database with the properties above, share the
integration, set `NOTION_REVIEWS_DATABASE_ID`, optionally add a `Client` relation.

## Rush order surcharge

A custom order whose needed-by date is sooner than the studio's standard lead time
is a **rush order** and carries a surcharge. The intake form detects this off the
existing "Needed By" date, discloses the surcharge, and requires the customer to
**acknowledge** it before the order can be placed.

1. **The fee is priced server-side, as one more invoice line written to Notion.**
   When the invoice-line-item generator runs for a rush order, it appends a
   **"Surcharge"** line (`LINE_TYPE_SURCHARGE`) priced at `RUSH_SURCHARGE_RATE`
   (default 15%) of the itemized garment subtotal (materials + labor + the
   reconciling adjustment, i.e. the costing's Suggested Price).

   **Pricing the fee server-side but writing it to Notion is what keeps the
   "Notion/invoice is the source of truth for money" rule intact** — the app never
   invents a total that diverges from Notion's `Final Balance`. The line flows into
   the balance like any other (`buildInvoiceView` sums all non-`Deposit` lines) and
   renders under its own "Surcharge" heading (`lib/invoice-format.ts` — ordered
   last, after Adjustments). The generator never links a costing item on the
   surcharge line, and it's covered by the same idempotency guard.

2. **Rush is derived from the date plus an explicit acknowledgement.**
   `isRushNeededBy` (`web-app/src/lib/rush.ts`) is true when the needed-by date
   falls within `VITE_RUSH_WINDOW_DAYS` of today. When true, the form shows the
   surcharge notice and a required acknowledgement checkbox (a `superRefine` blocks
   submit until ticked) and sends `rush: true`. A standard-timeline date sends no
   `rush` field. `NewOrderRequest.rush` is contract-first.

3. **Recorded as a flag, two ways.** `buildOrderProperties` sets a **`Rush Order`
   checkbox** (filterable in Notion) and `buildOrderPageBlocks` adds a body note,
   both only when `rush` is true (`ORDER_RUSH_PROPERTY`). The app reads neither
   back — they're an atelier signal, like the Due Date.

**Keep the frontend disclosure and the server rate in step:**
`VITE_RUSH_WINDOW_DAYS` / `VITE_RUSH_SURCHARGE_NOTE` are build-time Vite env;
`RUSH_SURCHARGE_RATE` is read at call time server-side (`0` disables the line).
Setup: the **`Rush Order` checkbox** on Custom Orders; the generator writes the
`Surcharge` `Line Type` option, which Notion auto-creates.

Code: `web-app/src/lib/rush.ts` + `pages/order-form.tsx`; `orders.blocks.ts` +
`orders.schema.ts`; `services/rush.ts` + `services/invoice-generator.service.ts`;
`web-app/src/lib/invoice-format.ts`.

## Referral & returning-skater rewards

Every customer gets a shareable **referral code**; when a skater they refer places
their first order, the referrer earns a **credit** and the new skater got a
**welcome discount** — and any repeat customer earns a **standing discount**. All
three are delivered as **Stripe promotion codes** redeemed in the checkout promo
box (`allow_promotion_codes: true` is on every Checkout path). The feature rides
the email-keyed Client CRM and adds **no new database** — reward state lives on
the CRM row.

1. **Two mechanics, one engine, driven from the paid-order moment.** There is no
   Notion→app trigger, but every moment that matters runs in-app: an order is
   _placed_ via `POST /orders` (`submitOrder`) and _paid_ via the Stripe webhook.
   `submitOrder` calls `captureReferralOnOrder` (stamp the referrer link + email
   the new skater their welcome code); `recordPaidOrder` and `recordPayment` call
   `runPaidOrderRewards(email, orderNumber)` at their tails, issuing the **referrer
   credit** (only once the referred order is paid — anti-abuse) and the
   **returning-skater discount**.

2. **Everything is best-effort and CRM/Stripe-optional.** A reward failure must
   never fail an order or 500 the webhook — a throw into the webhook makes Stripe
   retry, and the retry early-returns at the dedupe guard, so the reward would be
   lost. Every entry point is `try`/`catch` + `logger.warn`. When
   `NOTION_CLIENT_CRM_DATABASE_ID` is unset (or Stripe isn't configured) every
   reward path no-ops.

3. **Idempotency is layered.** A CRM checkbox is the fast guard — `Referral
Rewarded` and `Returning Reward Issued` — backed by Stripe's globally-unique
   promo `code` plus a per-reward `idempotencyKey` (`createDiscountCode` treats
   `resource_already_exists` as success). The returning trigger keys off **`First
Paid Order`** (a rich*text holding the customer's first paid order \_number*),
   not a boolean: a webhook retry or a later payment stage of the _same_ order
   carries the same number and can't fire the reward — only a genuinely different
   second order does.

4. **Two-sided referral, self/abuse-guarded.** `captureReferralOnOrder` resolves
   the code to a referrer (`findClientByReferralCode`), rejects a self-referral and
   an unknown code, skips an already-captured customer, then stamps `Referred By
Email` and issues the welcome code. The **referrer's** credit is a fixed `$`
   amount with a `minimum_amount` restriction, so a large single-use credit isn't
   burned on a tiny order; the welcome and returning codes are **percentages** (no
   currency mismatch with the USD checkouts). The referral **capture** surface is
   custom-order-only for now (`NewOrderRequest.referralCode`); the returning
   discount and the referrer's own redemption work on any checkout.

5. **Surfaced in the account portal.** `getAccountOverview` calls
   `ensureReferralCode` (best-effort), which generates a deterministic short code
   on first view and returns `AccountOverview.referral`
   (`{ code, creditAmount, returningCode? }`); `pages/account.tsx` renders a "Refer
   a friend" card. Absent when the CRM is off.

6. **Amounts are Studio-Settings tunables** (Notion → env → default):
   `REFERRAL_CREDIT_AMOUNT` (40), `REFERRAL_WELCOME_PERCENT` (10),
   `RETURNING_DISCOUNT_PERCENT` (10), `REWARD_CODE_EXPIRES_DAYS` (90).

Setup: **seven properties on the Client CRM** database (no new database, no new
env var, no Stripe Dashboard setup — codes are created programmatically):
`Referral Code`, `Referred By Email`, `Referral Rewarded` (checkbox), `First Paid
Order`, `Returning Reward Issued` (checkbox), `Referral Credit Code`, `Returning
Discount Code`.

Code: `services/rewards.service.ts`, `lib/stripe/promotions.ts`,
`lib/notion/clients.repository.ts` (reward reads + `patchClientProperties`), the
three reward builders in `lib/resend/emails.ts`, the `submitOrder` /
`recordPaidOrder` / `recordPayment` tails, `services/account.service.ts`,
`pages/order-form.tsx` + `pages/account.tsx`.

## Order status-change emails (Notion automation → webhook)

When a custom order advances to a new stage, the customer gets an email with a
**pipeline graphic** — an inline-HTML version of the on-site tracking timeline.
The stage change happens **inside Notion** and there is no Notion→app trigger, so
this is driven by a **Notion database automation**.

1. **Trigger is a Notion automation, not a poll.** Add a database automation on the
   Order Tracking Pipeline — _when `Stage` changes_ → _send webhook_ to
   `POST /api/webhooks/notion-stage-change`. **No hand-authored body is needed**:
   Notion's default payload carries the triggering page under `data.id`, and the
   route resolves the order off that page id (newer Notion often exposes only
   headers plus a fixed payload, with no editable body). An authored body
   `{ "orderNumber": … }` or `?order=` is still accepted and preferred when present.

   The POST is mounted with `express.raw` (before the JSON parser, like the Stripe
   webhook) and JSON-parses the buffer itself, **so the body is read regardless of
   the Content-Type Notion sends** — its webhook action sets the Content-Type and
   won't let you override it.

   Auth reuses `CRON_SECRET`, accepted two ways: an `Authorization: Bearer` header
   (preferred — the automation supports custom headers and it keeps the token out
   of URLs and logs) **or** a `?secret=` query token (the fallback the browser
   `/run` link uses, since a link can't send headers).

2. **Re-fetch, don't trust the payload.** The webhook carries only an identifier;
   the server reads the order back from Notion —
   `findOrderForStageNotification` (by number) or
   `findOrderForStageNotificationByPageId` (by `data.id`), both like
   `findOrderByNumber` but including the customer `Email` — and renders the email
   from the live `Stage` and live stage list, never the webhook's own copy. The
   send is best-effort from the **orders** sender; a missing email or unset stage is
   a graceful skip.

3. **Forward-only, via a `Last Notified Stage` marker.** The email sends only when
   the order has moved **forward** past the stage the customer was last emailed
   about. The Notion payload doesn't carry the _previous_ stage (and an automation
   condition can't compare status ordering), so the server keeps a `Last Notified
Stage` **rich_text** property: it reads the marker, sends only when the current
   stage is strictly ahead of it in the live pipeline, then advances the marker.

   A **backward** edit (a correction/rework) or a **re-fire** of the same stage is
   skipped, so double-fires are deduped for free. The marker is a **high-water
   mark** — it only ever advances — so re-traversing already-notified stages after a
   rework doesn't re-email. An empty marker counts as forward, so the first genuine
   change emails. The gate is the pure `isForwardStageChange`; the marker write is
   best-effort (a write hiccup at worst risks one duplicate on a later double-fire,
   never a wrong-direction email).

4. **On-demand send, and the fallback to the automation.** The studio dashboard's
   **Send a status update** tool (`POST /api/studio/tools/status-email` with
   `{ orderNumber, force? }`, staff-gated) runs the same send. **This is how the
   atelier tests in production** — run it for one test order (their own email) and
   no customer is touched, because no automation is firing for real orders until
   it's wired up. `force` resends even when the order hasn't moved forward (a
   forced resend never rewinds the high-water marker); the automation itself never
   forces.

   It's also the reliable alternative when the `Stage`-change automation can't be
   used — e.g. a Notion plan without webhook actions: advance the `Stage`, then run
   the tool. Forward-only like everything else, so running it again at the same
   stage is a no-op.

Setup: the Notion automation above, plus a **`Last Notified Stage`** (rich_text)
property on the Order Tracking Pipeline (the app writes it; leave it empty). The
per-stage description text mirrors `web-app/src/lib/stage-descriptions.ts`
(cosmetic, with a graceful fallback for unknown stages).

Code: `orderStageChangeEmail` in `lib/resend/emails.ts`,
`findOrderForStageNotification` / `findOrderForStageNotificationByPageId` +
`updateLastNotifiedStage` in `lib/notion/orders.repository.ts`,
`services/order-notification.service.ts`, `routes/order-notification.ts`.

## Appointment scheduling (real-time slot booking)

Customers book appointments (consultations, fittings, design reviews, general)
with a staff member from `pages/appointments.tsx` — a four-step flow (purpose →
format → time → details) through the generated client. Scheduling runs on **Google
Calendar**, not Notion: free/busy is the conflict source and each booking is a
calendar event. Code: `lib/appointments/*` (pure logic + config), `lib/google/*`
(Calendar + Sheets I/O), `services/appointments.service.ts`,
`routes/appointments.ts`.

1. **The type catalog is a targeted business rule in code.**
   `lib/appointments/catalog.ts` names the four types, their durations, and their
   routing rules (consultations are Alayna only; fittings, design reviews, and
   general appointments can be booked with either Alexandra or Alayna; fittings are
   in-person only). Duration drives slot math and staff/locations drive UI +
   validation, so these are values coupled to code. **The staff names must match
   the `Staff` column in the working-hours sheet.**

   **Booking gates split by who a type is for.** Each type carries one of two
   optional flags:
   - **Order-scoped types (fittings, design reviews)** set `requiresOrder`:
     `bookAppointment` requires an `orderNumber` and verifies it with
     `findOrderVerification` — missing number → 400, unknown order → 404,
     mismatched email → 403, legacy order with no stored email → accepted (can't
     lock those customers out).
   - **New-customer types (consultations, general)** set `requiresProjectDetails`:
     a new customer has no order number, so the request must carry non-empty
     `projectDetails` (blank → 400), a light screen on the funnel.

   Both fields are optional on `NewAppointmentRequest` and required only by the
   flagged type. `pages/appointments.tsx` renders the matching field and enforces
   the same requirement client-side, and `getAppointmentOptions` surfaces the flags
   so the UI knows which to show (the Purpose step labels order-scoped types
   "Requires an order number"). Both values are recorded on the calendar event and
   the atelier notification. Enforced in `enforceBookingGate`. To change which
   types are gated, flip the flags in the catalog — no other code changes.

2. **Working hours are a Google Sheet; conflicts are Google free/busy.**
   `computeSlots` (`lib/appointments/availability.ts`, pure + heavily unit-tested)
   needs a _positive_ grid of open hours, which Google free/busy can't give — it
   only says when someone is _busy_. That grid comes from a **Google Sheet** the
   atelier edits live: columns `Staff | Email | Day | Start | End | Locations`.
   `lib/google/sheets.repository.ts` reads it (`APPOINTMENT_SHEET_ID`, 60s cache +
   fallback; the service account reads it as itself via a direct share) and
   `lib/appointments/staff.ts` is the pure `parseScheduleRows` parser (`Mon-Fri`
   ranges, comma lists).

   The _subtractive_ side — every busy interval, including existing bookings **and**
   any event staff added (a day off is just a calendar event) — comes from the
   **FreeBusy API** (`listBusyInRange`), fed into `computeSlots` as `bookings`;
   `timeOff` is always empty. All wall-clock hours/slots are interpreted in
   `APPOINTMENT_TIMEZONE` (DST-correct via `lib/appointments/time.ts`, built on
   `Intl` — no date library); busy/bookings are UTC instants.

3. **Never trust a client-sent slot.** `POST /appointments` re-derives the type
   from the catalog and re-runs the _same_ `computeSlots` for the requested day
   (with fresh free/busy) before writing; a `start` that isn't currently an open
   slot — stale, taken, off the grid, or inside the lead-time window — is a
   `BadRequestError` (→ 400). The availability endpoint and the booking re-check
   share one function, so they can't disagree. Free/busy is read **fresh** (no
   cache) for this reason.

4. **Booking writes a calendar event, as the staff member.** Auth is a Google
   **Workspace service account with domain-wide delegation** (`lib/google/client.ts`):
   it impersonates each staff member (the `subject`) to read their free/busy and
   `events.insert` on their calendar with `sendUpdates=all` (a real Google invite
   to the customer) and, for virtual, a Google Meet link (`conferenceData`). The
   Meet + calendar links flow into the response, the confirmation email, and the
   success screen. **Google Calendar is the sole record — there is no Notion
   appointments database.**

5. **Booking is free and slots aren't held.** v1 has no Stripe step and no
   pending-hold: two simultaneous bookings for the same slot is a small, accepted
   race for a low-volume atelier. Policy is env-tuned (`APPOINTMENT_TIMEZONE`,
   `APPOINTMENT_MIN_LEAD_HOURS`, `APPOINTMENT_MAX_ADVANCE_DAYS`,
   `APPOINTMENT_SLOT_STEP_MINUTES`), all read at call time in
   `lib/appointments/settings.ts`.

6. **Google setup.** Enable the Calendar API **and the Sheets API**; create a
   service account (JSON key → `GOOGLE_SERVICE_ACCOUNT_KEY`); authorize its client
   id for `https://www.googleapis.com/auth/calendar` under Workspace Admin →
   Security → API controls → Domain-wide delegation. The working-hours **Sheet is
   shared with the service-account email** (Viewer) — no delegation needed there,
   since the SA reads it as itself. `google-auth-library` mints the tokens; the rest
   is raw `fetch`, mirroring the Notion adapter.

### Self-service reschedule & cancel (signed manage link)

A customer can reschedule or cancel their own booking from a link in the
confirmation email — no sign-in — freeing the slot automatically. Because there is
**no appointments database**, the durable handle is a **signed HMAC token**
(`lib/auth/tokens.ts`, signed with `SESSION_SECRET`). Its `"appointment"` purpose
— now the **only** token purpose — carries `{ email, eventId, staff }` with a
60-day TTL.

1. **The token is the authorization**, like a magic link: possession of the
   `${PUBLIC_BASE_URL}/appointments/manage?token=…` link is proof, with no
   cookie/account. `bookAppointment` mints it after the event is created and embeds
   it in the confirmation email. Gated on `authConfigured()` + `PUBLIC_BASE_URL`
   (`buildManageUrl`); unset ⇒ the link is omitted and the email falls back to
   "reply to us". **No new env var, no atelier setup.**

2. **The calendar event is the record — read live, never trust the token's copy.**
   `createCalendarEvent` returns the event `id` and stamps private
   `extendedProperties` (`EVENT_PROP_*`: type, location, confirmation, email, name)
   so the event is self-describing. `lib/google/calendar.repository.ts` provides
   `getCalendarEvent` (404/410 ⇒ null), `updateCalendarEvent` (PATCH = a merge, so
   attendees/Meet/props survive), and `cancelCalendarEvent` (DELETE, 404/410 ⇒
   idempotent success), all `sendUpdates=all` so Google re-notifies and the slot
   frees.

3. **Reschedule re-runs the same `computeSlots`** as booking, **locked to the same
   staff/type/location** — it's a move, not a rebooking, and PATCH can't change
   calendars. **Known limit:** the current booking counts as busy, so a new time
   overlapping the old one isn't offered. 404 if gone, 409 if already
   started/cancelled, 400 if the slot isn't open.

4. **Contract-first**, unlike the webhook/cron routes: `GET /appointments/manage`,
   `POST /appointments/reschedule`, `POST /appointments/cancel` are in
   `openapi.yaml` with generated hooks. `AppointmentDetails` carries `timezone` so
   the manage page renders times without a second options fetch. Emails are
   best-effort from the appointments sender.

Code: `services/appointment-manage.service.ts`, `routes/appointments.ts`,
`lib/resend/emails.ts` (`appointmentRescheduledEmail` / `appointmentCancelledEmail`
/ `appointmentChangeNotificationEmail`), `pages/appointment-manage.tsx` + shared
`lib/appointment-format.ts`.

**Deliberate fast-follow, not built:** the day-before reminder. It needs a new cron
doing a net-new `events.list`-by-window plus a per-event `aptReminded` marker; the
extended-property model above is the groundwork. See
`.agents/memory/appointment-reschedule-cancel.md`.

## Customer account portal (Supabase Auth)

A signed-in home base gathering a customer's custom orders and shop orders in one
place. **It is an identity layer over the existing lookups, not new order/invoice
logic.** Auth runs on **Supabase Auth**; Notion and Google Calendar stay the system
of record, still matched by **email**.

Frontend: `pages/account-login.tsx`, `account-callback.tsx`, `account-reset.tsx`,
`account.tsx`, `lib/supabase.ts`, `lib/auth-context.tsx`, `lib/auth-errors.ts`.
Backend: `services/account.service.ts`, `routes/account.ts`, `middlewares/auth.ts`,
`lib/supabase/client.ts`.

1. **Identity is the email; there is no user table.** The dashboard is the existing
   lookups **re-keyed from order number to email** — no accounts of our own to store
   or enumerate. Supabase owns the credential store (its `auth.users`); the app
   never persists a user record. `requireCustomer` normalizes the token's email at
   the gate (`normalizeEmail`) so Notion lookups key on the same canonical
   (lowercased) form the CRM dedupes on.

2. **Sign-in is Supabase-native and browser-driven.** `pages/account-login.tsx`
   calls supabase-js directly — **email+password** (`signInWithPassword` /
   `signUp`, with Supabase-managed hashing + email verification), **passwordless
   magic link** (`signInWithOtp`), **Google OAuth** (`signInWithOAuth`), and
   **forgot-password** (`resetPasswordForEmail` → `pages/account-reset.tsx` →
   `updateUser`). There is **no** server login/logout/verify route — the browser
   holds the session and logout is `supabase.auth.signOut()`. OAuth and magic-link
   redirects land on `pages/account-callback.tsx`, which lets supabase-js parse the
   token out of the URL (`detectSessionInUrl`, PKCE) and forwards to `/account`.

3. **Web session transport is a Bearer JWT, not a cookie.** supabase-js holds the
   session in the browser (localStorage, auto-refreshed) and the generated API
   client sends the access token via the **`setAuthTokenGetter` seam** in
   `custom-fetch.ts`; `lib/auth-context.tsx` wires that getter once and drops the
   cached overview query on any auth-state change, so data can't leak across
   identities. **Tradeoff:** the token is JS-readable (XSS-exposed) — accepted for
   the standard Bearer model. `custom-fetch.ts` still passes
   `credentials: "include"` for any incidental same-origin cookie, but the portal
   authenticates by the header.

4. **The server only verifies the JWT — it holds no session.** `requireCustomer`
   reads the Bearer token and verifies it with
   `getSupabaseClient().auth.getClaims(token)` (cached JWKS, local verification, no
   per-request round-trip; supports the ES256 asymmetric keys new projects default
   to), setting `res.locals.customer = { email, userId }` or throwing
   `UnauthorizedError` (→ 401; the frontend redirects to sign-in). Unset
   `SUPABASE_URL` / `SUPABASE_ANON_KEY` ⇒ the portal is inert (sign-in reports
   "unavailable", `/account/overview` 401s). `/account/overview` carries the
   `accountRateLimiter` (`middlewares/rate-limit.ts`, in-memory/per-instance) as a
   cheap brake on the authorization surface.

5. **`SESSION_SECRET` is not retired, but it no longer signs any sign-in token.**
   `lib/auth/tokens.ts` HMAC-signs only the **`appointment`**-purpose manage-link
   token. Supabase sends the branded verify / magic-link / reset emails itself over
   **custom SMTP = Resend**, configured in the Supabase dashboard, not
   `lib/resend/emails.ts` — the version-controlled source for that copy is
   `.agents/memory/supabase-auth-emails.md`.

6. **Contract.** `/account/overview` is the only account operation in
   `openapi.yaml` (hook `useGetAccountOverview`), secured with a `bearerAuth` (JWT)
   scheme.

7. **Notion queries are by email.** `findOrdersByEmail` and
   `findShopOrdersByEmail` filter on the `Email` / `Customer Email` property,
   paginated, returning lightweight summaries (no per-order milestone/invoice
   fan-out; the cards link out to `/track` and `/invoice/:n`). When Postgres is
   configured, `findOrderRefsByEmail` supplements these from the `order_index`
   read-model; unset ⇒ Notion alone. **Caveats:** Notion's email `equals` is
   **exact** (hence the gate-side `normalizeEmail`), and orders predating the
   `Email` property are invisible here — the customer can still track those by
   number.

8. **Scope:** orders + shop orders + invoices (which ride along the order detail
   pages) + a **referral** card, plus:
   - **Appointments.** `listUpcomingAppointmentsByEmail` runs one `events.list` per
     staff calendar, filtered by the **`aptEmail` private extended property**
     stamped on every booking — the read-by-customer path (there is still no
     appointments database). The event→DTO mapping is the shared
     `lib/appointments/event-details.ts`, reused by the manage service so they
     can't drift. Each summary carries a freshly-signed `manageToken`, so the
     portal's inline reschedule/cancel drive the **existing**
     `/appointments/reschedule|cancel` endpoints — no new mutation routes. Frontend
     controls are the shared `components/appointment-manage-panel.tsx` (also used by
     `pages/appointment-manage.tsx`); success invalidates the overview query.
     Best-effort: a calendar failure degrades to `appointments: []` and never fails
     the orders view. **Caveat:** bookings predating the `aptEmail` stamp won't list.
   - **Measurement history (display-only).** Measurements are written as typed
     Notion **properties** (five `number`s + a `Measurement Unit` select) in
     `buildOrderProperties`, alongside the page-body blocks the atelier reads — both
     from the one intake payload, so no drift. `extractMeasurements` reads them into
     `OrderSummary.measurements`, shown read-only under each custom order.
     **Caveat:** only orders placed after this migration have readable measurements.
     Editing still goes through the measurement-change request; **in-place editing
     (a PATCH) remains deferred.**

9. **Finished orders are denoted, not inferred — and filed away.** Every order
   carries a derived **`state`** (`AccountOrderState`: `active` / `completed` /
   `cancelled`), so the dashboard never reads completion out of a stage name. It's
   computed by `orderLifecycleState` (`services/delivery.ts`, alongside
   `orderDelivered`) so **both order kinds use the one positional rule**: an order
   is `completed` when its stage/status is the **last** in its live list (no stage
   name baked in, survives a rename), `cancelled` when the `Cancelled` checkbox is
   set — and cancelled **wins over** completed (a shop order can be cancelled after
   fulfilment; a custom one can't).

   Custom orders classify for free (the summary already carries its live `stages`);
   shop-order records don't carry their status list, so `listShopOrders` reads the
   live one (`fetchLiveShopOrderStatuses`, 60s cached) — **best-effort**: a failed
   read yields an empty list, classifying everything uncancelled as `active`, which
   is the safe way to be wrong (an order is never wrongly shown as finished).

   On `pages/account.tsx`, active orders stay under "Custom orders" / "Shop
   orders"; everything completed or cancelled collects in one **"Past orders"**
   section, collapsed by default and expanded when nothing is current, so a
   history-only account never looks empty. A past card carries a **Delivered /
   Cancelled badge** (the contract's finished state is the kind-neutral
   `completed`; the customer-facing word is the atelier's own "Delivered", for both
   kinds), drops the now-meaningless "Stage N of N" and target-completion line, and
   — when cancelled — drops the invoice link, since the refund is the atelier's and
   shouldn't point back at a pay screen. The `cancelled` flag on `OrderSummary` is
   internal: the zod response parse strips it and the dashboard is served the
   derived `state`.

Setup: create a Supabase project and set the four env vars (on Vercel these come
from the Supabase integration); enable Email+password (confirm-email) + Magic Link

- Google in the Supabase Auth dashboard (the Google OAuth-client and
  consent-screen steps are the runbook in `.agents/memory/supabase-google-signin.md`);
  point custom SMTP at Resend; add `${PUBLIC_BASE_URL}/account/callback` and
  `/account/reset` to the redirect allow-list. **No database of our own.** For the
  appointments and measurements additions: appointments reuse the existing Google
  Calendar integration (unset ⇒ they just don't appear); measurements need five
  `number` properties (`Waist`, `Chest`, `Hips`, `Height`, `Body Girth` — `Chest`
  maps to the contract's `bust` field) plus a `Measurement Unit` `select`
  (`inches`/`cm`) on the Order Tracking Pipeline. See `.agents/memory/account-portal.md`.

## Postgres

The optional **Postgres integrity layer** is provided by the same Supabase project.
Notion stays the record for the order lifecycle; Postgres holds only **app-owned,
integrity-bearing facts that Notion can't enforce**. It's **optional and
degrade-safe**: unset `POSTGRES_URL` ⇒ `postgresConfigured()` is false and every
caller falls back to the pre-Postgres behavior. Adapter: `lib/db/client.ts` (lazy
first-use env read, the narrow injectable `DbClient` seam — `query` + `end` — so
repos are driver-agnostic and fakeable like `NotionClient`; test seams
`__setDbForTests` / `__resetDb`).

1. **Three data tables are wired.** `supabase/migrations/0001_init.sql` provisions
   `schema_migrations`, `clients`, `order_index`, and `processed_payments`.
   `clients` + `order_index` are the email-keyed customer/order discovery index for
   the account portal — written **best-effort** on order/checkout
   (`upsertClientIndex` / `writeOrderIndex`, from `orders.service` +
   `checkout.service`) and read by the overview (`findOrderRefsByEmail`). When
   Postgres is unset the index no-ops and the portal reads Notion directly. A
   one-off `backfill-order-index.ts` (`pnpm db:backfill`) seeds it from existing
   Notion orders.

2. **`processed_payments` is atomic Stripe idempotency for shop orders.**
   `lib/db/processed-payments.repository.ts` — `claimPayment` (`insert … on
conflict (stripe_session_id) do nothing`, returning `claimed` / `done` /
   `in_progress`, with a `STALE_CLAIM_MINUTES = 10` reclaim window so a crash
   between claim and confirm can't swallow a payment forever), `confirmPayment`,
   `releasePayment`. `recordPaidOrder` claims → writes the Notion order → confirms,
   releasing and rethrowing on failure so a Stripe redelivery reprocesses, and
   throwing on a live `in_progress` claim so a concurrent delivery can't race a
   duplicate. The Notion `findOrderBySessionId` guard is retained as a reclaim-only
   backstop, and a DB error is caught and logged, falling back to that Notion dedup
   — **so a Postgres outage never blocks recording a paid order.**

3. **Pooled at runtime, direct for migrations; never in the deploy path.** The app
   reads the **pooled** `POSTGRES_URL` (Supabase PgBouncer, transaction mode) with
   `prepare: false, max: 1, idle_timeout: 20` (each warm serverless instance holds
   its own tiny pool feeding the shared pooler). Migrations run **out-of-band** via
   `pnpm --filter @workspace/api-server db:migrate` (`src/scripts/migrate.ts`,
   applying `supabase/migrations/*.sql` in filename order, each in a transaction
   with its `schema_migrations` insert) on the **non-pooled**
   `POSTGRES_URL_NON_POOLING` — **DDL can't traverse PgBouncer.** That's a manual
   `workflow_dispatch` job (`.github/workflows/migrate.yml`), deliberately kept out
   of `build:vercel` and cold starts. `postgres` (porsager) is a prod dependency.

Setup (optional — unset ⇒ no-op): on Vercel the Supabase integration provides
`POSTGRES_URL` + `POSTGRES_URL_NON_POOLING`; run `db:migrate` once against the
non-pooled URL. Tests: `test/unit/db.client.test.ts`,
`test/unit/processed-payments.repository.test.ts`, and the `checkout.service`
dedup-branch tests, all over `test/support/fake-db.ts`. See
`.agents/memory/postgres-integrity-layer.md`.

## Web analytics & cookie consent

Pageviews and client-side navigations via **Vercel Web Analytics**
(`@vercel/analytics/react`), gated behind an explicit **opt-in cookie-consent
banner**. Purely client-side — no backend, no data model, no new env var (enable
_Web Analytics_ in the Vercel project dashboard for data to flow). Files:
`lib/consent.tsx`, `components/analytics.tsx`,
`components/cookie-consent-banner.tsx`, all wired in `App.tsx`, plus a "Cookies and
analytics" section and a "Manage cookie preferences" control on `pages/privacy.tsx`.

1. **Consent is opt-IN, and analytics is the only thing it gates.**
   `ConsentProvider` holds one status — `"granted" | "denied" | "unset"` —
   persisted to `localStorage` under `aa-cookie-consent`. Until the visitor
   chooses, status is `"unset"`, the banner shows, and **nothing non-essential
   loads**. `ConsentedAnalytics` renders Vercel's `<Analytics />` **only** when
   status is `"granted"`, so no analytics request is made otherwise.

2. **Essential storage is never gated here.** The Supabase session is strictly
   necessary and out of scope — there is deliberately no "reject essential" path.
   Vercel Web Analytics is itself cookieless and doesn't track across sites; the
   opt-in gate is kept anyway for compliance and so the gate already exists if
   analytics ever moves to a cookie-based provider.

3. **The choice is revisitable.** `ManageCookiePreferences` on the privacy page
   calls the context's `reset()`, clearing the stored choice so the banner
   reappears — letting a visitor withdraw consent as easily as they gave it. This
   is why `pages/privacy.tsx` consumes `useConsent()` and its test wraps it in
   `ConsentProvider`.

Tests: `test/consent.test.tsx`, `test/cookie-consent-banner.test.tsx`,
`test/analytics.test.tsx` (with `@vercel/analytics/react` mocked).

## Invisible anti-spam (honeypot + timing + submission rate limit)

The fully-anonymous submission forms — **contact**, **notify**, and **newsletter**
— carry a zero-friction, no-third-party anti-spam layer so a bot can't cheaply
pollute the Notion contact database. Nothing is customer-visible; there is no
CAPTCHA. Three invisible signals:

1. **Honeypot** — a hidden `website` field a real visitor never sees or fills
   (off-screen + `aria-hidden` + `tabIndex=-1`, **not** `display:none`). Any
   non-empty value marks the submission as a bot.
2. **Timing** — an `elapsedMs` field. A submit faster than a human plausibly could
   (`< SPAM_MIN_FILL_MS`, default 2000; `0` disables) is a bot. **Absent ⇒ treated
   as human (fail open)**, so a client that can't measure it still works.
3. **Rate limit** — a shared per-IP `submissionRateLimiter` (5 / 10 min, the same
   in-memory/per-instance `express-rate-limit` as the account limiter — a
   best-effort brake, not a hard wall).

Load-bearing:

- **Contract-first.** `website` + `elapsedMs` are **optional** fields on
  `NewContactRequest` / `NewNotifyRequest` / `NewNewsletterRequest`. Optional ⇒ a
  legacy client that omits them keeps working.
- **Silent success-looking drop, never a 4xx.** `spamFilter(success)`
  (`middlewares/spam-filter.ts`) runs **after** `validate` (reading
  `res.locals.body`); a flagged request gets the exact success response the
  endpoint would return, with **no** Notion write or email — so a bot gets no
  signal it was caught and never learns to evade. The pure `isLikelySpam`
  predicate is unit-testable without HTTP.
- **No service or Notion-blocks change.** The middleware short-circuits before the
  service, and on a clean request the extra props are ignored downstream.
- **`SPAM_MIN_FILL_MS` is read fresh from env per call** and is **not** a
  Studio-Settings key.
- **Frontend reuse.** `web-app/src/lib/anti-spam.tsx` exports `HoneypotField`,
  `honeypotSchema` (spread into each form's local zod schema), and
  `useSubmitTimer()`, wired into `pages/contact.tsx`,
  `components/notify-dialog.tsx`, `components/newsletter-signup.tsx`, and the
  order-form newsletter path.

Tests: `test/unit/spam-filter.test.ts`,
`test/integration/contact.routes.test.ts`,
`test/integration/submission-rate-limit.routes.test.ts`, plus the frontend form
tests. This covers the anonymous forms only; the order/appointment/order-scoped
endpoints are out of scope.

## Relate requests & orders to their sources (Phase-2)

Four Phase-2 "Workspace" cards give Notion rows a real **relation** to the thing
they concern, so the atelier can click through and totals roll up. All the
relation **writes** are gated behind `NOTION_RELATION_LINKS` (read fresh from env
by `relationLinksEnabled()` in `services/request-links.ts`), because the app
writes to **existing** Notion properties — **writing a relation property that
doesn't exist 400s the whole page-create** — so the property must exist first.
Unset ⇒ no relation is written and behavior is exactly as before.

1. **Requests → their order.** Each writer threads the order's Notion page id (the
   verification lookups `findOrderVerification` / `findShopOrderVerification`
   return `pageId`) and, when enabled, sets a relation: a **custom**-order request
   links `Order` → Custom Orders, a **shop**-order request links `Shop Order` →
   shop orders (both on Website Contact Messages), and a **review** links `Order` →
   Custom Orders on Reviews. Helpers: `contactOrderRelation`
   (`lib/notion/contact.blocks.ts`, mirroring `contactClientRelation`) and the
   inline `Order` write in `reviews.blocks.ts`. Custom Orders carries an **Open
   Requests** rollup over the back-relation.
2. **Shop orders → inventory rows.** `checkout.service.ts` stamps each cart line's
   `variantId` (= the inventory Notion page id) onto the Stripe line's
   `price_data.product_data.metadata` (always on — harmless); the webhook retrieves
   the session with `expand: ["line_items.data.price.product"]`, recovers the
   deduped inventory ids, and (when enabled) writes them to the shop order's
   **`Inventory Items`** relation (`SHOP_ORDER_ITEMS_PROPERTY`, additive alongside
   the existing text bullets). inventory carries a **Times Ordered** rollup.
3. **The redundant invoice link is pruned.** Generated invoice line items no longer
   write the `Order` relation — it duplicated the invoice's own `Order` and nothing
   read it. **Delete the stale `Order` property on Invoice Line Items in Notion only
   after this ships**; deleting it before deploy would 404 the deployed generator.
4. **Backfill legacy rows.** `src/scripts/backfill-legacy-fields.ts`
   (`pnpm --filter @workspace/api-server db:backfill-legacy [-- --dry-run]`) is a
   one-time, idempotent backfill: it recovers a legacy custom order's `Email` +
   measurements from its page **body** blocks and stamps the typed properties, and
   stamps a deterministic `SHP-LEGACY-…` `Order Number` on legacy shop orders that
   lack one, so they surface in the email-keyed portal. Run it where
   `NOTION_API_KEY` + the database ids live; it is out-of-band, not in the deploy
   path.

Setup (done in Notion; enable with `NOTION_RELATION_LINKS=1`): an `Order` (→ Custom
Orders) + `Shop Order` (→ shop orders) relation on Website Contact Messages; an
`Order` (→ Custom Orders) relation on Reviews; an `Inventory Items` (→ inventory)
relation on shop orders; the five measurement number properties + `Measurement
Unit` select on Custom Orders; plus the `Open Requests` and `Times Ordered` count
rollups.

## Workspace record hygiene (Phase-2 — CRM, archiving, markers, templates)

Four more Phase-2 cards, all **additive Notion configuration the app never reads**
— no code, invisible to the deployed app (which keys on exact property names).
Recorded here only because two facts are load-bearing. Full detail in
`.agents/memory/phase2-workspace-crm-archive-markers.md`.

- **Order archiving is a `checkbox`, NEVER a `Stage` option.** Custom Orders and
  shop orders carry an `Archived` checkbox plus `Active Orders` / `Archived` views.
  It must stay a separate property because the app reads `Stage` **positionally** —
  `orderDelivered()` treats the **last** live stage as delivered (review gate,
  schedule, portal). **An "Archived" Stage after "Delivered" would silently become
  the delivered position and break all three.** Nothing in the app filters on
  `Archived`; it's a pure view-cleanliness convention.
- **The Custom Orders template pre-fills `Stage` + `Measurement Unit`.**
  `buildOrderProperties` deliberately **omits `Stage`** on create (a new page
  inherits Notion's Stage status default) and writes `Measurement Unit` **only when
  measurements are supplied** — so a hand-keyed order can miss the unit the portal
  reads back. The database template defaults `Stage = Consultation` and
  `Measurement Unit = inches`. **Don't rely on this in code** — it's an atelier
  convenience, not an app guarantee.
- **Client CRM reads as a customer record.** Rollups over the order relations:
  `Order Count`, `Lifetime Value`, `Paid to Date`, `First Order Date` /
  `Last Order Date`, `Shop Order Count` / `Shop Revenue`, and the blended
  `Total Orders` / `Total Lifetime Value`. The app reads **none** of these
  (`clients.repository.ts` reads only email / status / last-contact / reward
  fields), so they're safe to retune or extend.
- **App-owned markers are corralled out of the working views** (Last Notified
  Stage, Milestones Generated, Stage Index Sys, Reminder Sent, the reward flags,
  Stripe session ids). The curated views hide them; the collapsed "🔧 System"
  property group is a UI-only runbook step (property groups aren't API-reachable).

## Color selector (intake)

The custom-order intake form lets the customer **pick the colors they're
picturing** from the studio palette (a flat multi-select) and **describe how
they'd like them used** — deliberately a _starting point for the consultation_,
not a fabric spec. Exact fabric and finish (and any bodice-vs-skirt split) are
settled with the atelier later, so intake stays light.

1. **The palette is one Studio Settings value, not a database.** Because it's a
   small, rarely-changed list, it lives as a single atelier-editable
   **`COLOR_PALETTE`** Studio Settings row — the same **Notion → env → default**
   resolution as `rushSurchargeRate()`. `intakeColorPalette()` (`services/colors.ts`)
   reads `settingValue("COLOR_PALETTE") ?? process.env.COLOR_PALETTE`, parsed by
   `parseColorPalette` from a human-editable `Name #hex, Name #hex, …` string, and
   falls back to a **built-in primary palette** (`DEFAULT_PRIMARY_PALETTE`) so the
   picker always works with zero setup. Malformed entries (bad or missing hex) are
   skipped and duplicate slugs dropped, so a mis-typed value degrades gracefully.
   `GET /api/colors` (`routes/colors.ts`) serves it — a cheap read off the primed
   settings snapshot, with a short edge cache. Contract-first: `/colors` +
   `Color`/`ColorList` in `openapi.yaml`, so `useGetColors` is generated. `Color` is
   `{ id, name, hex }` (id = slug of the name).

2. **Always non-empty and degrade-safe.** The palette is never empty (the default
   backs it), so the picker always renders. If the `/colors` fetch itself errors the
   chips just don't render, the customer still describes what they want in the
   free-text usage note, and the order form still submits.

3. **Flat multi-select, controlled.** `ColorPicker` (`components/color-picker.tsx`)
   is a controlled, form-agnostic grid of `<button>` pill chips (the shadcn set has
   no checkbox/toggle), each a hex-fill dot plus the color name. Clicking toggles
   the name in/out of the selection. The form drives it via `setValue("colors", …)`
   and pairs it with a registered `colorUsage` textarea. The order body carries a
   flat `colors: string[]` plus `colorUsage`, both optional (contract-first on
   `NewOrderRequest`). Custom prints and fabric photos fold into the existing
   **Reference Images** upload on step 1 — there is no separate uploader.

4. **Recorded on the order (write-only).** `orders.blocks.ts` writes the picks as a
   **`Colors` multi_select** (filterable in Notion) plus a **`Color Usage`
   rich_text**, and mirrors both as page-body blocks in the Costume Details section.
   The app **never reads these back** — they're an atelier signal. Constants
   (`ORDER_COLORS_PROPERTY`, `ORDER_COLOR_USAGE_PROPERTY`) live in
   `orders.schema.ts`.

The color step is the second page of the two-step intake flow (step 1 = details,
step 2 = Colors + submit); see `order-form.tsx` (`STEPS`, the step gating). Setup
is **nothing** — the built-in palette works out of the box. To customize, add a
`COLOR_PALETTE` row to Studio Settings with a `Value` like
`Emerald #0B6E4F, Rose Gold #C5878C, Navy #1F2A44` (or set the env var), and add
**`Colors` (multi_select)** + **`Color Usage` (rich_text)** to the Order Tracking
Pipeline for the write-back.

## Studio analytics dashboard (internal, staff-gated)

The atelier's own numbers in one place — `pages/studio.tsx` at **`/studio`**, fed
by `GET /api/studio/analytics`: custom and shop orders by stage, production load
against due dates, revenue by month, deposits vs. balances, and best-selling shop
pieces. It's a **read-only aggregation over data the app already keeps** — nothing
new is written, no new database, no new vendor, no new env var beyond the staff
allowlist. Code: `services/studio-analytics.service.ts`, `routes/studio.ts`,
`middlewares/auth.ts` (`requireStaff`), `lib/staff.ts`, `lib/notion/scan.ts`, the
three `list*ForAnalytics` repository reads, and `web-app/src/pages/studio.tsx`.

1. **Auth is the customer's Supabase session plus an allowlist — no second auth
   vendor.** A staff member signs in exactly like a customer at `/account/login`;
   `requireStaff` verifies the same Bearer JWT `requireCustomer` does (both share
   one `resolveSessionCustomer`) and then checks the email against
   `STUDIO_STAFF_EMAILS` (`lib/staff.ts`). Not signed in ⇒ **401** (the page
   redirects to sign-in); signed in but failing the gate ⇒ **403** (bouncing them to
   sign-in would loop, so the page shows the reason).

   The allowlist is **env-only and NOT a Studio Setting** — access control isn't a
   business tunable, and anyone who could edit the settings database could otherwise
   grant themselves the studio's revenue figures. It **fails closed**: unset ⇒
   nobody is staff and the dashboard is inert, the opposite of the optional
   integrations' degrade-to-off.

2. **Staff must sign in with Google — the method is checked, not just the
   identity.** The studio's addresses are published on the site, so an allowlist
   alone is only as strong as the mailbox behind one: a leaked password or an
   intercepted magic link would be enough. So `requireStaff` also requires the
   session to have been established through Google, read from the access token's
   **`amr`** claim — what established _this_ session, unlike
   `app_metadata.provider`, which only says what's linked to the account. Supabase
   records an OAuth sign-in as `oauth` and doesn't name the provider, so this means
   "Google" precisely because Google is the only OAuth provider enabled on the
   project; **enable a second and the check widens with it.** The actual second
   factor is **2-step verification enforced in Google Workspace admin**, which buys
   real MFA with no enrollment flow of our own.

   Load-bearing: it **defaults ON** (`STUDIO_REQUIRE_GOOGLE`, opt-_out_ via
   `false`/`0`/`no`/`off`), because an access-control default you have to remember
   isn't one; it **fails closed** when a token carries no readable `amr`; the
   refusal is logged at `warn` with the email and methods; and the 403 message is
   rendered verbatim by the page, which offers a **Continue with Google** button
   that signs out first (Supabase would otherwise hand back the same session) and
   returns to `/studio` via `lib/post-signin.ts` — a `sessionStorage` hop rather
   than a `?next=` on the redirect URL, which would need its own Supabase
   allow-list entry and hand a stranger an open-redirect parameter.

3. **Full-database scans, bounded in one place.** Unlike every other Notion read
   here, the analytics have nothing to filter by — they summarize the whole book of
   work. `lib/notion/scan.ts` (`scanDatabase`) is the single paging implementation
   the three readers share (`listOrdersForAnalytics`, `listShopOrdersForAnalytics`,
   `listInvoicesForAnalytics`), capped at `MAX_SCAN_PAGES` (100 pages ≈ 10,000
   rows): hitting the cap **warns and returns a partial read** rather than fanning
   out unboundedly on a serverless function. One invoice scan replaces a per-order
   invoice fetch, and the aggregation is cached for 60s.

4. **Shop revenue and custom bookings are side by side, never summed.** A shop
   order records what was collected and when. A custom order's payments carry **no
   dates at all** — the invoice holds a paid _checkbox_ per stage — so the only
   honest monthly figure for bespoke work is what was **booked**: the invoice's
   `Final Balance`, attributed to the month the order came in. The contract carries
   them as two fields (`shopRevenue` / `customBooked`) and the UI labels them apart.
   Dating custom payments properly needs a real payment ledger. Months and "today"
   are read in `APPOINTMENT_TIMEZONE`, so a 9pm order on the 31st lands in the month
   the atelier worked it.

5. **Deposits vs. balances split without double counting.** Across every invoice on
   a live (non-cancelled) order: an unpaid deposit counts once as
   `depositsOutstanding`, and `balancesOutstanding` is what's left **beyond every
   deposit scheduled against the invoice** — so the two add to `outstandingTotal`
   with no overlap. A **paid balance settles the invoice outright** (the balance
   stage charges `Final Balance − deposits paid`, sweeping up an uncollected
   deposit), so it leaves nothing outstanding. An invoice whose `Order` relation is
   empty still counts; one on a cancelled order doesn't.

6. **Completion is positional, as everywhere else.** Both pipelines classify with
   the shared `orderLifecycleState` (`services/delivery.ts`) against the live stage
   / fulfilment-status lists, so an atelier rename never miscounts. An active order
   whose stage isn't in the live list still counts as active — it just has no bucket.

7. **Best sellers ride the inventory relation, and can legitimately be empty.** Top
   items are counted from each shop order's `Inventory Items` relation, deduped per
   order and resolved to names via `listVariants()`. That relation records _which_
   pieces were bought, not how many, so the figure is **orders containing the
   piece**, not units. Orders placed before the relation shipped (or with
   `NOTION_RELATION_LINKS` off) carry none, so the list comes back empty and the
   panel says why. The inventory read is the one **best-effort** source; the orders
   / shop orders / invoices scans **are** the dashboard, so a failure there surfaces
   as a 500 rather than quietly rendering zeroes.

8. **No charting dependency.** The panels are plain CSS bars — a charting library
   would be the largest dependency in the app for six panels of numbers, against the
   repo's pruned-dependencies rule. The page is `noindex`.

9. **The way in is a staff-only nav link, gated by the server's own answer.**
   `/studio` is deliberately **not in `NAV_LINKS`** (the public array stays flat and
   unconditional): `useNavLinks()` in `navbar.tsx` appends a separate `STUDIO_LINK`
   when — and only when — `useStudioAccess()` (`web-app/src/lib/studio-access.ts`)
   says so. That hook asks **`GET /api/studio/access`**, mounted behind the **same
   `requireStaff`** as the figures rather than re-deriving the answer client-side,
   so the link can never be offered to an account the dashboard would then refuse.
   The allowlist is never shipped to the browser, so asking the server is the only
   honest test, and it **fails closed**.

## Internal tools on the studio dashboard

The atelier's five internal actions — **reconcile production milestones**,
**itemize an invoice**, **send a status update**, **cancel & refund an order**,
**refund a return** — run from the signed-in `/studio` page through
`POST /api/studio/tools/:tool`. None of the underlying work changed; who is
allowed to trigger it did. Code: `services/studio-tools.service.ts` (the
dispatcher + the wording), `routes/studio.ts`, and
`web-app/src/components/studio-tools.tsx`.

1. **What replaced what.** Each tool used to be a `GET` link authenticating with
   `?secret=<CRON_SECRET>`, built by a **Notion formula property** and opened in a
   browser tab. Those routes are **deleted, not deprecated**:
   `…/cron/generate-milestones/run`, `…/webhooks/notion-stage-change/run`,
   `/api/invoices/generate-line-items[/run]`,
   `/api/orders/process-cancellation[/run]`, and
   `/api/shop-orders/process-return[/run]`. The Bearer halves went too — nothing
   machine-driven called them.
   `test/integration/retired-secret-links.routes.test.ts` asserts they stay gone,
   **because re-mounting one would put a money-moving credential back into URLs and
   browser history.**

2. **What deliberately survives on `CRON_SECRET`.** Two callers are machines that
   can send a header: **Vercel Cron** → `GET /api/cron/generate-milestones`, and the
   **Notion stage-change automation** → `POST /api/webhooks/notion-stage-change`.
   The webhook still also accepts `?secret=` — the one place left that reads the
   secret from a URL — kept only because a live automation may already be configured
   that way; it should use the `Authorization` header. `lib/cron-route.ts` is now
   just those two auth checks.

3. **Contract-first, unlike the links it replaced.** The retired routes were outside
   the OpenAPI contract because they were browser tabs, not API calls. This is an
   ordinary SPA JSON call, so it lives in `openapi.yaml` with a generated
   `useRunStudioTool` hook: the tool name is a **path-param enum** (an unknown tool
   is a 400 from the generated schema, not a route that quietly doesn't exist) and
   `amount` is validated as a non-negative number before any service sees it.

4. **The server owns the wording; the page renders it.** Every tool returns the same
   `{ tool, status, title, message, details[] }` — the summary sentences the HTML
   confirmation pages used to compose, moved into the service. So the dashboard
   renders one shape instead of five. `status` carries the meaning: **`ok`** (it did
   something), **`noop`** (there was nothing to do — every action is idempotent, so
   this is the normal result of a repeat run and **must not read as success**), and
   **`attention`** (it ran but left work for a human, e.g. a refund Stripe rejected,
   which leaves the order uncancelled precisely so a re-run can retry). Something
   the tool couldn't even start — a missing order number, an unknown order, an
   invoice that isn't ready — is thrown as `BadRequestError`/`NotFoundError` and
   surfaces as a 400/404 with its own message, shown verbatim.

5. **The two refunds confirm before running.** `cancellation-refund` and
   `return-refund` move real money against a hand-typed order number, so the UI asks
   again with the number echoed back, and editing the field re-arms the question.
   Editing an order number is also the fix for the one thing a formula link did
   better — it could never be typed wrong. That trade buys what a link never could:
   a **partial** return refund is a form field rather than an `&amount=180` appended
   to a URL by hand.

**Setup (one time, after this deploys):** delete the four formula-property link
fields in Notion — `Send Status Update` on Order Tracking Pipeline, the
invoice-generator link on invoices & payments, and the cancellation / return refund
links on Order Tracking Pipeline and Shop Orders — plus any "Open link" button
pointing at `…/generate-milestones/run`. Then **rotate `CRON_SECRET`**: it has sat
in Notion formulas and browser history, and now that only Vercel Cron and the
Notion automation send it, rotating costs one env var and one automation header.

## Return & exchange refunds (the atelier-facing half)

A customer files a return/exchange request from shop-order tracking (Approach A —
the request never refunds anything); the atelier reviews it and processes the
refund. Same customer-requests / atelier-actions split as order cancellation, and
it reuses that flow's `Cancelled`-marker shape — **but the refund arithmetic is
deliberately different.**

1. **`amount` is a TARGET TOTAL, not an increment.** `amount = X` means "the total
   refunded on this order should be $X", and the service issues
   `max(0, X − what Stripe says is already refunded)`. This is the whole design,
   because a return can't use the cancellation flow's "any refund exists ⇒ skip"
   guard: a restocking fee is a deliberate **partial** refund, an even exchange
   refunds **nothing**, and the atelier may **top a partial up to full** later.
   Under the cancellation guard the first partial would permanently block the
   top-up; under a naive "refund this increment" model a repeated run would refund
   twice. The declarative target gives all of it at once:
   - **Idempotent for the life of the order.** A re-run refunds $0 because the
     target is already met. A Stripe `idempotencyKey` can't do this job alone —
     those expire after 24h and the atelier may run it again a week later (the key
     is still passed, keyed on the target, for concurrent-run safety).
   - **Can never over-refund.** The delta is computed against Stripe's own refund
     total and the target is clamped to the amount actually captured.
   - Omit `amount` ⇒ refund in full; `amount = 0` ⇒ even exchange (refunds nothing,
     still marks the return processed).

2. **Stripe is the source of truth for money — the Notion markers are not.** The
   already-refunded total is read from `refunds.list` on the payment intent, so a
   refund the atelier issued **by hand in the Dashboard** counts against the target
   exactly like one the app issued. The ceiling is the intent's `amount_received`,
   not the session total, which can include an uncaptured promo. Consequently the
   `Refunded Amount` / `Return Processed` writes are **atelier visibility only** and
   **best-effort** (`recordShopOrderRefund` resolves `false` instead of throwing):
   the money has already moved by then, a failed write can't cause a double refund
   on the next run, and the flow works before those two properties are added —
   writing a property Notion doesn't have would 400 the whole PATCH.

3. **Degrades, never double-charges.** A shop order with no recorded session (paid
   offline / legacy) and a `$0`/fully-promo session are **skipped and surfaced as
   "refund manually"**, not failures. A Stripe throw is caught, logged at `error`,
   and returned as `status: "error"` with nothing refunded and no marker written —
   the dashboard says so plainly rather than claiming success, and a re-run is safe
   because the target is recomputed from Stripe every time. The customer refund
   email (`returnRefundEmail`, **orders** sender) sends only when money actually
   moved, and is best-effort like every other customer mail.

Setup (**no new env vars** — reuses `STRIPE_SECRET_KEY` + Resend): add **`Refunded
Amount`** (number) and **`Return Processed`** (checkbox) to the **Shop Orders**
database (optional — the refund works without them; they're just the visible
record). The refund is run from the studio dashboard's **Refund a return** tool
(`POST /api/studio/tools/return-refund`), which takes the order number and an
optional amount. Code: `services/return-refund.service.ts`,
`services/studio-tools.service.ts`, `lib/stripe/refunds.ts` (the shared Stripe
refund primitives), and `recordShopOrderRefund` in
`lib/notion/shop-orders.repository.ts`.

## Development workflow

### Prerequisites

- **pnpm is required** (the `preinstall` hook fails the install for npm/yarn).
- Node with the versions implied by `@types/node` ^26.
- Copy `.env.example` → `.env` and fill in `NOTION_API_KEY` +
  `NOTION_ORDERS_DATABASE_ID`.

### Install, run, build

```bash
pnpm install
pnpm dev            # api-server (:3000) + web-app (Vite) in parallel
pnpm build          # typecheck everything, then build all packages
pnpm build:vercel   # what Vercel runs: build api-server (esbuild) + frontend (vite)
pnpm typecheck      # tsc --build across project references + per-package checks
pnpm hooks:install  # install the pre-push + post-merge git hooks
```

The frontend proxies `/api` to the backend. The api-server `dev` script builds
with esbuild and runs the bundled output, reading env from the repo-root `.env`
via `DOTENV_CONFIG_PATH`.

TypeScript uses **project references** (`tsconfig.json` → `lib/*`,
`tsconfig.base.json` for shared options). `customConditions: ["workspace"]` lets
packages resolve each other from **source** during typecheck. `strict` null checks
on, `module: esnext`, `moduleResolution: bundler`, `noEmitOnError`, ESM everywhere
(`"type": "module"`).

### Tests

```bash
pnpm test           # all unit + integration tests (Vitest, no network)
pnpm test:coverage  # same, with v8 coverage (report-only, no thresholds)
pnpm test:e2e       # Playwright e2e (tests/e2e/*.spec.ts)
pnpm test:smoke     # Playwright against the real deployed site
```

**Layout convention.** Every package with Vitest tests keeps them in `test/` at the
package root — **never co-located in `src/`**, so they stay out of the _build_
graph — with `test/support/` holding the setup file plus package-local helpers.

**`.test.ts` vs `.spec.ts` vs `.smoke.ts` is load-bearing.** The extension tracks
the runner: Vitest files are `*.test.ts(x)`, Playwright e2e are `*.spec.ts`, smoke
are `*.smoke.ts`. Vitest's `include` glob then can never match an e2e spec, and
Playwright's default `testMatch` (which _does_ match `.test.ts`) can never pick up
a Vitest suite. **Don't "unify" these.**

**Shared fixtures — `lib/test-fixtures`.** `@workspace/test-fixtures` holds the
domain fixtures used by all three suites (`createOrderInput()`, `orderRecord()`,
`contactInput()`, `STAGES`, `GENERIC_ERROR`), typed against the generated
`@workspace/api-zod` contract so a fixture can't silently drift. Two rules, both
in that package's header comment:

1. **A fixture is only ever a _stub input_** — a request body, a mocked repo
   return, a stubbed hook result, a mocked HTTP response. **Never the _expected
   output_ of the mapper that consumes it,** or a bug in the fixture cancels a bug
   in the mapper. Where a test both stubs and asserts, the stub uses the fixture
   and the expectation stays written out by hand.
2. **Notion-wire-shaped fakes stay local** to
   `artifacts/api-server/test/support/fake-notion.ts` (`orderPage()`,
   `databaseSchemaWithStages()`). Those are raw Notion page JSON — a different
   layer from the DTOs above — and keeping them apart is what lets
   `schema.test.ts` take its input from one place and write its expectation in
   another.

**Tests are typechecked.** Each package has a `tsconfig.test.json` (and `tests/` a
`tsconfig.json`) covering the test dir without adding it to the build/emit graph;
`pnpm typecheck` runs them. `tests/tsconfig.json` also carries a `paths` mapping
for `@workspace/test-fixtures` — Playwright won't transpile TypeScript inside
`node_modules` and ignores Vite's `customConditions`, so mapping the package to
source is what makes the import resolve from an e2e spec.

**Backend (Vitest).** `artifacts/api-server/test/` — `unit/` (Notion schema
mapping, block builders, repositories driving the **injected** `NotionClient` with
a fake, service logic) and `integration/` (supertest route tests over the real
Express stack with the Notion repository mocked). No server, no network, no
Notion. `vitest run test/unit` is the fast loop. A vitest-config plugin maps the
source's `.js` import specifiers to the on-disk `.ts` files, so tests run with no
build step.

**Frontend (Vitest + Testing Library, jsdom).** `artifacts/web-app/test/` — the
status-timeline logic and render states, the shop's render states and category
filter, and the order-form validation + submit-payload mapping (asserting empty
optional fields are omitted). Each file mocks the generated react-query hook it
needs (`vi.mock("@workspace/api-client-react")`) and drives the page through its
states via `test/support/mock-hook.ts`.

Both Vitest configs set `clearMocks: true`, so tests don't hand-roll a
`beforeEach(() => vi.clearAllMocks())`. Note `pnpm test` filters on
`./artifacts/**` rather than using `-r`: the `@workspace/tests` package's `test`
script is `playwright test`, and `-r` would drag Playwright into the unit-test run
(which CI executes _before_ it installs a browser).

**End-to-end (Playwright).** Self-contained by default: Playwright starts the
frontend dev server itself (`webServer` in `playwright.config.ts`) and every spec
intercepts `/api/*` in the browser (`tests/e2e/support/mock-api.ts`), so no
api-server or Notion is required and runs are deterministic. Set
`PLAYWRIGHT_BASE_URL` to point at an already-running app instead. `order-form.spec.ts`
carries an **opt-in** live-Notion smoke test guarded by `E2E_LIVE_NOTION=1` —
**the only path that writes to the real Notion database.**

**Production smoke tests.** A separate, deliberately **non-mocking** suite in
`tests/smoke/*.smoke.ts` with its own config (`playwright.smoke.config.ts`) drives
the **real deployed site** (`PLAYWRIGHT_BASE_URL`, default
`https://a3iceanddance.com`) to catch production breakage the mocked run can't see
— a bad deploy, a Notion/Google outage, an unshared database. **Two rules must
hold:**

1. It **never** intercepts `/api/*`, and does **not** import `e2e/support/test.ts`
   (whose fixture fails any unmocked call).
2. Every spec is **read-only** — health, shop inventory, the appointment catalog,
   an order lookup for a nonexistent number (the real Notion 404 path), and
   client-side form validation — but **never** creates an order/checkout/booking/
   contact message or sends an email, so it's safe to run against production
   forever.

It runs **weekly** via `.github/workflows/smoke.yml` (`schedule` cron +
`workflow_dispatch`), emails a pass/fail report to the atelier afterwards
(`tests/scripts/email-smoke-report.mjs`, through the app's Resend mailer — needs
the `RESEND_API_KEY` + `RESEND_FROM_EMAIL` repo secrets, recipient
`SMOKE_REPORT_TO` defaulting to the atelier inbox; it self-gates and never fails
the job if Resend is unset), and on a scheduled failure opens or updates a single
GitHub issue.

**CI.** `.github/workflows/ci.yml` runs on every pull request and push to `main`:
install → `pnpm format:check` → `pnpm typecheck` → `pnpm build:vercel` →
`pnpm test:coverage`, then `pnpm test:e2e` in a separate job (Playwright installs
its own Chromium; the mocked specs need no backend). The Playwright
config prefers `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, then a NixOS system
Chromium, then Playwright's managed browser. Other workflows: `codeql.yml`,
`dependabot-lockfile.yml`, `migrate.yml` and `backfill.yml` (both manual
`workflow_dispatch`).

## Conventions & gotchas

- **Surface customer-facing copy for review.** When adding or changing any text a
  customer will see — email subjects/bodies (`lib/resend/emails.ts`), on-site
  strings, confirmation pages — **show the exact copy in your reply** so the
  atelier can approve the wording before it ships. Don't bury new customer-visible
  wording in a diff.
- **ESM only.** Server-side relative imports use explicit `.js` extensions (e.g.
  `import router from "./routes/index.js"`) even though the source is `.ts` —
  required so `@vercel/node`/Node ESM can resolve the compiled output. **Don't drop
  the extensions.** Frontend imports use the `@/` alias resolving to
  `artifacts/web-app/src`.
- **Shared dependency versions** live in the `catalog:` section of
  `pnpm-workspace.yaml`. Reference them as `"react": "catalog:"` rather than
  pinning per package.
- **`minimumReleaseAge: 1440`** — pnpm won't install package versions younger than
  24h (supply-chain hardening). Expect this when adding a brand-new release.
- **Frontend stack:** React 19, Vite 7, Tailwind **v4** (via `@tailwindcss/vite`,
  no `tailwind.config` — config lives in `src/index.css`), wouter for routing,
  TanStack Query for data, shadcn/ui ("new-york" style) in `src/components/ui`,
  react-hook-form + zod for forms. The design is an intentionally minimal
  editorial/serif aesthetic — match it.
- **Navigation & page shell.** Routes are declared with wouter in `src/App.tsx`;
  add a `<Route>` for each new page before the `NotFound` fallback. The header is a
  single global `components/navbar.tsx` rendered once in `App.tsx` — its
  `NAV_LINKS` array is the **one place** to add/rename nav links (it drives both
  the desktop bar and the mobile `Sheet` menu, and `data-testid`s are auto-derived
  from each label). Pages wrap content in `components/page-shell.tsx`, which
  supplies the background, navbar clearance, and optional centering; follow
  `pages/home.tsx` as the scaffold.
- **Prettier** is the formatter (root devDependency). CI runs `format:check`.
- **Order reference-image upload goes to Notion, not object storage.** The order
  form's optional reference/inspiration images ride on **Notion's File Upload
  API**, so there is _no new service or env var_ — it reuses `NOTION_API_KEY`, and
  the images land as inline image blocks on the order's own Notion page. The
  browser downscales each image on a canvas (`web-app/src/lib/reference-images.ts`),
  then POSTs the bytes **one at a time** to `POST /api/orders/reference-images`
  (`components/reference-image-upload.tsx`); the server
  (`routes/order-images.ts` → `lib/notion/file-uploads.repository.ts`) relays each
  to Notion (create → send) and returns a `file_upload` id; the form collects the
  ids and sends them as `referenceImageIds`, which `orders.blocks.ts` attaches as
  image blocks.

  Two load-bearing points: (1) the upload endpoint is a **raw-bytes route
  deliberately outside the OpenAPI contract** — hand-mounted in `app.ts` with
  `express.raw()` ahead of the JSON parser, and called by the frontend with a plain
  `fetch`, not the generated client; only the `referenceImageIds` array is in the
  contract. (2) Client-side downscaling plus a **4 MB cap** keep each request under
  Vercel's ~4.5 MB serverless body limit — **the one-image-per-request design is
  what avoids multipart parsing and stays under that limit.** Notion single-part
  uploads are ≤ 20 MB and must be attached within an hour (the order-create call
  does that).

- **Notion is the system of record; Postgres is a thin integrity layer.** Orders,
  inventory, and invoices live in Notion — there is no ORM. The one relational
  store is the optional Supabase Postgres layer (`lib/db/`, the porsager `postgres`
  driver, raw SQL via the narrow `DbClient` seam), which degrades to no-op when
  unconfigured.
- **Dependencies are pruned — keep them that way.** When you add a shadcn
  component, add only the one you use; don't bulk-import the set. **A few deps look
  unused but are load-bearing — don't "clean" them up:** `pino-pretty` (a _string_
  transport target in `logger.ts`), `thread-stream` (version pin for
  `esbuild-plugin-pino`), `@testing-library/dom` (required peer;
  `autoInstallPeers: false`), `tw-animate-css` / `@tailwindcss/typography` (pulled
  in by `src/index.css`, not by JS), and root `prettier` (orval's codegen calls it).
- **Reclaiming disk.** `pnpm clean` removes regenerable build output;
  `pnpm clean:deep` also prunes stale Playwright browser builds (the shared cache
  never evicts old ones and runs ~540M).

## Environment variables

`.env.example` is the local template. On Vercel these are project env vars; the
Supabase and Stripe values are mode/environment-scoped — map **Production** to
live credentials and **Preview/Development** to test ones.

**A Notion integration must be shared with every database below, or queries 404.**

### Required

| Var                                                         | Purpose                                                                                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTION_API_KEY`                                            | Notion integration token                                                                                                                                                                                             |
| `NOTION_ORDERS_DATABASE_ID`                                 | "Order Tracking Pipeline" (custom orders)                                                                                                                                                                            |
| `NOTION_CONTACT_DATABASE_ID`                                | "Website Contact Messages" — all six request writers                                                                                                                                                                 |
| `NOTION_INVENTORY_DATABASE_ID`                              | The shop's "inventory" database                                                                                                                                                                                      |
| `NOTION_PRODUCT_CATEGORIES_DATABASE_ID`                     | "Product Categories" — `/products` fails without it, there is no fallback                                                                                                                                            |
| `NOTION_SHOP_ORDERS_DATABASE_ID`                            | "Shop Orders" — needs an `Order Number` rich_text property for shop-order tracking                                                                                                                                   |
| `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`                    | "📅 Production Schedule" (milestones)                                                                                                                                                                                |
| `NOTION_INVOICES_DATABASE_ID`                               | "invoices & payments"                                                                                                                                                                                                |
| `NOTION_INVOICE_LINE_ITEMS_DATABASE_ID`                     | "Invoice Line Items"                                                                                                                                                                                                 |
| `NOTION_COSTING_DATABASE_ID`                                | "costing (custom orders)" — read by the line-item generator                                                                                                                                                          |
| `NOTION_MATERIAL_USAGE_DATABASE_ID`                         | "material usage database" — same                                                                                                                                                                                     |
| `NOTION_REVIEWS_DATABASE_ID`                                | "Reviews" — the review endpoint errors if unset                                                                                                                                                                      |
| `CRON_SECRET`                                               | Bearer token for the cron endpoints; doubles as the `?secret=` query token for the Notion buttons and the stage-change webhook. Unset ⇒ those endpoints 401                                                          |
| `STRIPE_SECRET_KEY`                                         | Checkout, refunds, promotion codes                                                                                                                                                                                   |
| `STRIPE_WEBHOOK_SECRET`                                     | Signing secret of the Stripe webhook endpoint                                                                                                                                                                        |
| `PUBLIC_BASE_URL`                                           | Site origin Stripe redirects back to; also the Supabase Auth redirect origin and the base for every emailed link                                                                                                     |
| `SESSION_SECRET`                                            | Signs the appointment manage-link token. Unset ⇒ those links are omitted                                                                                                                                             |
| `STUDIO_STAFF_EMAILS`                                       | Comma-separated staff emails allowed into `/studio`. **Env-only, never a Studio Setting**, and it **fails closed**: unset ⇒ nobody is staff and the dashboard is inert                                               |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`                         | Backend JWT verification for the account portal                                                                                                                                                                      |
| `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY` | Frontend browser sign-in                                                                                                                                                                                             |
| `GOOGLE_SERVICE_ACCOUNT_KEY`                                | Full service-account JSON, with domain-wide delegation for the Calendar scope                                                                                                                                        |
| `APPOINTMENT_SHEET_ID`                                      | The working-hours Google Sheet, shared with the service-account email                                                                                                                                                |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                       | The verified sender, e.g. `A.A Atelier <orders@a3iceanddance.com>`. The sending domain must be verified in Resend (SPF/DKIM) or mail won't deliver. A missing or failing mailer is non-fatal — sends are best-effort |

Unset Supabase vars ⇒ the portal is inert (sign-in unavailable,
`/account/overview` 401s).

### Optional

| Var                                | Default                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTION_CLIENT_CRM_DATABASE_ID`    | —                             | "Client CRM". When set, every customer touchpoint best-effort upserts a client record (deduped by email) and links back via a `Client` relation. New clients are `Active` for buyers/order customers and `Lead` for inquiries and back-in-stock requests; an existing client's status is left untouched. Unset ⇒ CRM linking is skipped. Shop Orders and Website Contact Messages each need a `Client` relation |
| `NOTION_SETTINGS_DATABASE_ID`      | —                             | "Studio Settings" live-config database. Unset ⇒ env-only                                                                                                                                                                                                                                                                                                                                                        |
| `NOTION_RELATION_LINKS`            | off                           | `1`/`true`/`yes` enables the Phase-2 relation writes. The relation properties must exist first                                                                                                                                                                                                                                                                                                                  |
| `APPOINTMENT_SHEET_RANGE`          | `A2:F`                        | Working-hours sheet range                                                                                                                                                                                                                                                                                                                                                                                       |
| `APPOINTMENT_TIMEZONE`             | `America/Chicago`             | IANA zone for working hours/slots                                                                                                                                                                                                                                                                                                                                                                               |
| `APPOINTMENT_MIN_LEAD_HOURS`       | `24`                          | Booking policy                                                                                                                                                                                                                                                                                                                                                                                                  |
| `APPOINTMENT_MAX_ADVANCE_DAYS`     | `45`                          | Booking policy                                                                                                                                                                                                                                                                                                                                                                                                  |
| `APPOINTMENT_SLOT_STEP_MINUTES`    | `15`                          | Booking policy                                                                                                                                                                                                                                                                                                                                                                                                  |
| `MEASUREMENT_LOCK_FROM_STAGE`      | `Cutting/Pinning`             | The live Stage option at/after which measurements freeze. Names a specific option value — set this if the atelier renames that stage                                                                                                                                                                                                                                                                            |
| `FITTING_REMINDER_STAGES`          | `Fitting`                     | Comma-separated Stage names that trigger a fitting reminder                                                                                                                                                                                                                                                                                                                                                     |
| `FITTING_REMINDER_LEAD_DAYS`       | `10`                          | Days ahead of a fitting milestone to email                                                                                                                                                                                                                                                                                                                                                                      |
| `PAYMENT_REMINDER_LEAD_DAYS`       | `7`                           | Days ahead of an invoice due date to email (the same cutoff catches overdue stages)                                                                                                                                                                                                                                                                                                                             |
| `RUSH_SURCHARGE_RATE`              | `0.15`                        | Fraction of the itemized subtotal for the rush `Surcharge` line. `0` disables it                                                                                                                                                                                                                                                                                                                                |
| `VITE_RUSH_WINDOW_DAYS`            | `21`                          | **Build-time.** A needed-by date within this many days marks a rush order                                                                                                                                                                                                                                                                                                                                       |
| `VITE_RUSH_SURCHARGE_NOTE`         | `"a 15% rush surcharge"`      | **Build-time.** Disclosure copy on the order form. Keep in step with `RUSH_SURCHARGE_RATE`                                                                                                                                                                                                                                                                                                                      |
| `REFERRAL_CREDIT_AMOUNT`           | `40`                          | Dollars credited to the referrer on a referred first paid order                                                                                                                                                                                                                                                                                                                                                 |
| `REFERRAL_WELCOME_PERCENT`         | `10`                          | The new skater's welcome discount                                                                                                                                                                                                                                                                                                                                                                               |
| `RETURNING_DISCOUNT_PERCENT`       | `10`                          | Standing repeat-customer discount                                                                                                                                                                                                                                                                                                                                                                               |
| `REWARD_CODE_EXPIRES_DAYS`         | `90`                          | How long a one-time reward code stays redeemable                                                                                                                                                                                                                                                                                                                                                                |
| `STUDIO_REQUIRE_GOOGLE`            | `true`                        | Require the studio session to have been established through Google (read from the token's `amr`). Opt-_out_ via `false`/`0`/`no`/`off`; fails closed on an unreadable `amr`                                                                                                                                                                                                                                     |
| `COLOR_PALETTE`                    | built-in primary palette      | The intake color picker's chips, as `Name #hex, Name #hex, …`. A Studio Settings key, so it's normally set in Notion                                                                                                                                                                                                                                                                                            |
| `SPAM_MIN_FILL_MS`                 | `2000`                        | Minimum plausible human fill time for the anonymous forms. `0` disables the timing check (the honeypot still applies). **Not** a Studio-Settings key                                                                                                                                                                                                                                                            |
| `STRIPE_SHIPPING_RATE_IDS`         | —                             | Comma-separated `shr_…` ids offered at shop checkout. Unset ⇒ no shipping charged. **Mode-scoped**; the rate's currency must be USD or Stripe silently drops it. Reprice by editing the rate in the Dashboard (no redeploy); redeploy only when the ids change                                                                                                                                                  |
| `STRIPE_BNPL_METHODS`              | —                             | Comma-separated `klarna` / `affirm` / `afterpay_clearpay`. Each must also be enabled in the Dashboard and is mode-scoped. Setting it pins payment methods to card + these; unset ⇒ dynamic methods                                                                                                                                                                                                              |
| `POSTGRES_URL`                     | —                             | Pooled runtime connection for the integrity layer. Unset ⇒ the layer no-ops                                                                                                                                                                                                                                                                                                                                     |
| `POSTGRES_URL_NON_POOLING`         | —                             | Direct connection, migrations only                                                                                                                                                                                                                                                                                                                                                                              |
| `RESEND_CONTACT_FROM_EMAIL`        | `RESEND_FROM_EMAIL`           | Contact-category sender, e.g. `hello@`                                                                                                                                                                                                                                                                                                                                                                          |
| `RESEND_APPOINTMENTS_FROM_EMAIL`   | `RESEND_FROM_EMAIL`           | Appointments-category sender                                                                                                                                                                                                                                                                                                                                                                                    |
| `RESEND_AUDIENCE_ID`               | —                             | Resend **Marketing** Audience for newsletter opt-ins. Unset ⇒ the sync is skipped, the opt-in is still captured in Notion                                                                                                                                                                                                                                                                                       |
| `ATELIER_INBOX_EMAIL`              | —                             | Internal notification inbox. Unset ⇒ no atelier notifications                                                                                                                                                                                                                                                                                                                                                   |
| `ATELIER_CONTACT_INBOX_EMAIL`      | `ATELIER_INBOX_EMAIL`         | Contact-category inbox                                                                                                                                                                                                                                                                                                                                                                                          |
| `ATELIER_APPOINTMENTS_INBOX_EMAIL` | `ATELIER_INBOX_EMAIL`         | Appointments-category inbox                                                                                                                                                                                                                                                                                                                                                                                     |
| `ALERT_INBOX_EMAIL`                | `alexandra@a3iceanddance.com` | Production error alerts                                                                                                                                                                                                                                                                                                                                                                                         |
| `LOG_LEVEL`                        | —                             | pino level                                                                                                                                                                                                                                                                                                                                                                                                      |

The `SETTING_KEYS` subset (rush rate, measurement lock, the four `APPOINTMENT_*`,
the four inboxes, the four reward amounts, and `COLOR_PALETTE`) can be overridden from the Studio
Settings Notion database — see [Studio Settings](#studio-settings-atelier-editable-config-in-notion).

## Git & deployment

- Default branch: **`main`**; `development` is the integration branch. Feature work
  happens on branches and reaches them via pull requests.
- **Do not open a pull request unless explicitly asked.**
- Vercel deploys using `vercel.json`: `installCommand: pnpm install`,
  `buildCommand: pnpm run build:vercel`, output `artifacts/web-app/dist/public`. It
  also carries the `www` → apex redirect (see
  `.agents/memory/domain-redirect-loop.md`) and the nightly milestone cron.

## Quick reference — where things live

| I want to…                                | Go to                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change an API request/response shape      | `lib/api-spec/openapi.yaml` → run codegen                                                                                                                                                                                                                                                    |
| Change order use-case logic               | `api-server/src/services/orders.service.ts`                                                                                                                                                                                                                                                  |
| Change Notion I/O                         | `api-server/src/lib/notion/*`                                                                                                                                                                                                                                                                |
| Change a customer email / template        | `api-server/src/lib/resend/*` (`emails.ts` copy, `send.ts` transport, `config.ts` senders/inboxes)                                                                                                                                                                                           |
| Add/modify an API route                   | `api-server/src/routes/*`                                                                                                                                                                                                                                                                    |
| Add request validation / error mapping    | `api-server/src/middlewares/*`                                                                                                                                                                                                                                                               |
| Change the order-tracking UI              | `web-app/src/pages/track.tsx` + `components/custom-order-result.tsx` + `components/shop-order-result.tsx`                                                                                                                                                                                    |
| Change the order intake form              | `web-app/src/pages/order-form.tsx`                                                                                                                                                                                                                                                           |
| Change the rush surcharge                 | `web-app/src/lib/rush.ts` + `pages/order-form.tsx`; `orders.blocks.ts` + `orders.schema.ts`; `services/rush.ts` + `services/invoice-generator.service.ts`; `web-app/src/lib/invoice-format.ts`                                                                                               |
| Change referral & returning rewards       | `services/rewards.service.ts` + `lib/stripe/promotions.ts` + `lib/notion/clients.repository.ts`; wired from `submitOrder`, `recordPaidOrder`, `recordPayment`; `services/account.service.ts` + `pages/account.tsx` + `pages/order-form.tsx`                                                  |
| Add/read an atelier-editable live setting | `lib/settings/store.ts` (`SETTING_KEYS`) + `lib/notion/settings.{schema,repository}.ts`; consume as `settingValue(KEY) ?? process.env[KEY] ?? default` (see `services/rush.ts`)                                                                                                              |
| Change the measurement-change request     | `web-app/src/components/measurement-change-dialog.tsx`; `services/measurement-change.service.ts` + `services/measurement-lock.ts` + `routes/orders.ts` + `lib/notion/measurement-change.{blocks,repository}.ts`                                                                              |
| Change post-delivery review capture       | `web-app/src/components/review-dialog.tsx`; `services/review.service.ts` + `services/delivery.ts` + `lib/notion/reviews.{blocks,repository}.ts`                                                                                                                                              |
| Change order cancellation & refunds       | `web-app/src/components/cancellation-request-dialog.tsx`; `services/cancellation.service.ts` (request) + `services/order-cancellation.service.ts` + `routes/order-cancellation.ts` (refund)                                                                                                  |
| Change the shop                           | `web-app/src/pages/shop.tsx` + `services/products.service.ts` + `lib/notion/products.*` + `lib/notion/product-categories.*`                                                                                                                                                                  |
| Change the back-in-stock dialog           | `web-app/src/components/notify-dialog.tsx` + `services/notify.service.ts` + `lib/notion/notify.*`                                                                                                                                                                                            |
| Change shop checkout / payments           | `web-app/src/lib/cart.tsx` + `components/cart-drawer.tsx` + `components/add-to-cart.tsx`; `services/checkout.service.ts` + `routes/checkout.ts` + `routes/stripe-webhook.ts` + `lib/stripe/*` + `lib/notion/shop-orders.*`                                                                   |
| Change shop-order tracking                | `web-app/src/components/shop-order-result.tsx`; `services/shop-orders.service.ts` + `routes/shop-orders.ts` + `lib/notion/shop-orders.{blocks,repository}.ts`                                                                                                                                |
| Change the return / exchange request      | `web-app/src/components/return-exchange-dialog.tsx`; `services/return-request.service.ts` + `routes/shop-orders.ts` + `lib/notion/return-request.{blocks,repository}.ts`; policy copy in `pages/shipping-returns.tsx`                                                                        |
| Change custom-order payments              | `web-app/src/components/custom-order-result.tsx` (`DepositsSection`) + `pages/invoice.tsx`; `services/invoice.service.ts` + `routes/orders.ts` + `lib/notion/invoice.{schema,repository}.ts` + `routes/stripe-webhook.ts`                                                                    |
| Change invoice line-item generation       | `services/invoice-generator.service.ts` + `routes/invoice-generator.ts` + `lib/notion/costing.{schema,repository}.ts` + `lib/notion/invoice-line-items.blocks.ts`                                                                                                                            |
| Change an invoice or receipt PDF          | `web-app/src/lib/pdf/` (`document.ts` layout primitives, `invoice-pdf.ts`, `receipt-pdf.ts`, `studio.ts`) + `components/download-pdf-button.tsx`                                                                                                                                             |
| Change production-schedule milestones     | `services/schedule.service.ts` + `routes/cron.ts` + `lib/notion/production-schedule.{blocks,repository}.ts`; cron in `vercel.json`                                                                                                                                                           |
| Change order status-change emails         | `orderStageChangeEmail` in `lib/resend/emails.ts` + `services/order-notification.service.ts` + `routes/order-notification.ts` + `findOrderForStageNotification` in `lib/notion/orders.repository.ts`                                                                                         |
| Change fitting reminders                  | `services/schedule.service.ts` (`sendDueFittingReminders`) + `services/fitting-reminder.ts` + `lib/notion/production-schedule.repository.ts` + `fittingReminderEmail`                                                                                                                        |
| Change payment & deposit reminders        | `services/schedule.service.ts` (`sendDuePaymentReminders`) + `services/payment-reminder.ts` + `lib/notion/invoice.repository.ts` + `PAYMENT_STAGE_REMINDER_FIELDS` in `invoice.schema.ts` + `paymentReminderEmail`                                                                           |
| Change appointment booking (UI)           | `web-app/src/pages/appointments.tsx`                                                                                                                                                                                                                                                         |
| Change appointment reschedule / cancel    | `web-app/src/pages/appointment-manage.tsx` + `lib/appointment-format.ts`; `services/appointment-manage.service.ts` + `lib/google/calendar.repository.ts`; token purpose in `lib/auth/tokens.ts`                                                                                              |
| Change appointment types / routing rules  | `lib/appointments/catalog.ts`                                                                                                                                                                                                                                                                |
| Change staff working hours / calendars    | The working-hours Google Sheet; read in `lib/google/sheets.repository.ts`, parsed by `lib/appointments/staff.ts`                                                                                                                                                                             |
| Change appointment slot logic / policy    | `lib/appointments/availability.ts` + `time.ts` + `settings.ts`; `services/appointments.service.ts` + `lib/google/*`                                                                                                                                                                          |
| Change the customer account portal        | `web-app/src/pages/account*.tsx` + `components/appointment-manage-panel.tsx` + `lib/supabase.ts` + `lib/auth-context.tsx`; `services/account.service.ts` + `routes/account.ts` + `middlewares/auth.ts` + `lib/supabase/client.ts`. Auth email copy: `.agents/memory/supabase-auth-emails.md` |
| Change the Postgres layer / payment dedup | `lib/db/client.ts` + `lib/db/processed-payments.repository.ts` + `lib/db/order-index.repository.ts`; consumed by `services/checkout.service.ts` and `services/account.service.ts`. Schema in `supabase/migrations/*.sql`                                                                     |
| Change the newsletter opt-in              | `web-app/src/components/newsletter-signup.tsx` + the checkbox in `pages/order-form.tsx`; `services/newsletter.service.ts` + `lib/notion/newsletter.{blocks,repository}.ts` + `newsletterWelcomeEmail`                                                                                        |
| Change the mailing-list / Resend audience | `lib/resend/audience.ts` + `audienceId()` in `lib/resend/config.ts`; campaigns are Resend **Broadcasts** from the dashboard                                                                                                                                                                  |
| Change invisible anti-spam                | `middlewares/spam-filter.ts` + `submissionRateLimiter` in `middlewares/rate-limit.ts`; frontend `web-app/src/lib/anti-spam.tsx`                                                                                                                                                              |
| Change the footer / legal pages           | `web-app/src/components/footer.tsx` + `pages/{privacy,terms,shipping-returns}.tsx` + `components/legal-page.tsx`; studio contact details in `lib/contact-info.ts`                                                                                                                            |
| Add a page / route                        | new `web-app/src/pages/*.tsx` + `<Route>` in `src/App.tsx`                                                                                                                                                                                                                                   |
| Add or rename a nav link                  | `NAV_LINKS` in `web-app/src/components/navbar.tsx`                                                                                                                                                                                                                                           |
| Add a shared UI component                 | `web-app/src/components/ui/`                                                                                                                                                                                                                                                                 |
| Add/change a shared test fixture          | `lib/test-fixtures/src/index.ts` (read its guardrail first)                                                                                                                                                                                                                                  |
| Understand a past decision / gotcha       | `.agents/memory/`                                                                                                                                                                                                                                                                            |
| Adjust the Vercel serverless entrypoint   | `api/index.ts` + `vercel.json`                                                                                                                                                                                                                                                               |
