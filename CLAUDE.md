# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**AA-Atelier** is the order-management web app for a custom figure skating/dance
costume business, wrapped in a small marketing site (landing page, Services,
About, Shop, Contact, plus legal pages). The two core customer flows are **order
status lookup** (enter an order number, see a timeline of the garment's progress)
and **new order intake** (contact details, measurements, dress notes).

There is **no traditional database for orders**. Orders live in **Notion**, which
the team manages through the Notion UI; the API server talks to the Notion REST
API. The app is deployed on **Vercel** (migrated off Replit — see
`.agents/memory/vercel-migration.md`).

## Repository layout

A **pnpm workspace monorepo**. Package globs live in `pnpm-workspace.yaml`:
`artifacts/*`, `lib/*`, `tests`. Every workspace package is named
`@workspace/<name>`. (`scripts/` is plain bash tooling, deliberately _not_ a
workspace package.)

```
artifacts/
  web-app/           Frontend SPA (Vite + React 19 + Tailwind v4 + shadcn/ui)
    src/App.tsx      wouter routes + global <Navbar /> and <Footer />
    src/pages/       one component per route (home, track, order-form, invoice,
                     services, about, shop, shop-success, contact, appointments,
                     appointment-manage, account, account-login, account-callback,
                     account-reset, privacy, terms, shipping-returns, not-found)
    src/components/  navbar.tsx (global nav), page-shell.tsx (page wrapper),
                     footer.tsx, legal-page.tsx, ui/ (shadcn primitives — pruned
                     to only the ones used; re-add with `npx shadcn add <name>`)
  api-server/        Backend (Express 5) — talks to Notion, bundled by esbuild
    src/routes/      thin HTTP handlers (validate → service → respond)
    src/services/    HTTP-agnostic use-cases
    src/middlewares/ zod validation, auth, rate limits, spam filter, error handler
    src/lib/notion/  Notion adapter: client + per-domain schema/blocks/repository
    src/lib/google/  Google Calendar + Sheets I/O (appointments)
    src/lib/stripe/  Stripe client, shipping rates, payment methods, promotions
    src/lib/resend/  Email transport, copy, category config, marketing audience
    src/lib/supabase/ Supabase client (verifies the account portal's JWT)
    src/lib/db/      Postgres integrity layer (DbClient seam + repositories)
    src/scripts/     Out-of-band scripts: migrate.ts, backfill-order-index.ts,
                     backfill-legacy-fields.ts, export-product-seo.ts
api/
  index.ts           Vercel serverless entrypoint — re-exports the built Express app
lib/
  api-spec/          OpenAPI spec (openapi.yaml) + orval codegen config — SOURCE OF TRUTH
  api-zod/           GENERATED zod schemas from the spec (server-side validation)
  api-client-react/  GENERATED react-query hooks + typed fetch client (frontend)
  test-fixtures/     Shared domain fixtures for all three test suites
supabase/migrations/ Postgres schema (SQL applied by `db:migrate`)
scripts/             Bash tooling: cleanup.sh (`pnpm clean`), install-hooks.sh
                     (`pnpm hooks:install`), pre-push + post-merge git hooks
tests/               Playwright: e2e/ (mocked) + smoke/ (live production)
.agents/memory/      Durable notes on past decisions & gotchas — READ THESE
vercel.json          Vercel build + routing config
```

## Architecture & data flow

```
Browser (web-app SPA)
  │  fetch /api/*
  ▼
Express app (artifacts/api-server)  ──►  Notion REST API (orders database)
                                    ├──►  Resend REST API (customer emails)
                                    ├──►  Stripe (checkout, refunds, promo codes)
                                    ├──►  Google Calendar + Sheets (appointments)
                                    ├──►  Supabase Auth (verify account-portal JWT)
                                    └──►  Postgres (optional integrity layer)
  │
  ├─ GET  /api/health              → { status: "ok" }
  ├─ GET  /api/account/overview    → the signed-in customer's custom orders +
  │                                  shop orders (with measurements) + upcoming
  │                                  appointments + referral, keyed by the email
  │                                  on the Supabase access token. Appointments
  │                                  come from Google Calendar and carry a signed
  │                                  manage token (best-effort — degrade to none
  │                                  on a calendar outage). Bearer-JWT gated (401).
  │                                  Sign-in runs on Supabase Auth in the browser;
  │                                  there is NO server login/logout/verify route
  ├─ GET  /api/studio/access       → "am I studio staff?" — the probe behind the
  │                                  navbar's staff-only Dashboard link, so the
  │                                  dashboard has a way in without the URL being
  │                                  published. Runs the SAME requireStaff gate as
  │                                  the figures below (401 / 404 / 403 / 200 {
  │                                  staff: true }) and reads nothing — reaching
  │                                  the handler IS the answer
  ├─ GET  /api/studio/analytics    → the INTERNAL studio dashboard's figures:
  │                                  custom + shop orders by stage, production
  │                                  load against due dates, revenue by month,
  │                                  deposits vs. balances, and best-selling
  │                                  shop pieces. Aggregated live from Notion
  │                                  (bounded full-database scans, 60s cached).
  │                                  Same Bearer JWT as the portal PLUS a staff
  │                                  allowlist: 401 not signed in, 404 signed in
  │                                  but not staff (indistinguishable from a URL
  │                                  that doesn't exist, by design), 403 staff
  │                                  but not signed in with Google
  ├─ GET  /api/orders/:orderNumber → order status + stage list
  ├─ POST /api/orders              → creates a Notion page, returns order number,
  │                                  sends an order-confirmation email, best-effort
  │                                  upserts a Client CRM record by email. Optional
  │                                  referenceImageIds (from the upload endpoint
  │                                  below) are attached as image blocks
  ├─ POST /api/orders/reference-images
  │                                → relays one raw customer-uploaded reference
  │                                  image to Notion's File Upload API and returns
  │                                  its file_upload id. Raw bytes, NOT part of the
  │                                  OpenAPI contract
  ├─ POST /api/orders/:n/payments/:stage
  │                                → Stripe Checkout session for one payment stage
  │                                  of custom order :n (first deposit, second
  │                                  deposit, balance), priced server-side from the
  │                                  order's Notion invoice; the webhook marks paid
  ├─ POST /api/orders/:n/measurement-change-requests
  │                                → files a measurement-change request in the
  │                                  "Website Contact Messages" database, tagged
  │                                  Request type = "Measurement update". Gated:
  │                                  values-or-appointment, email must match the
  │                                  order, rejected once the garment is in
  │                                  production (MEASUREMENT_LOCK_FROM_STAGE).
  │                                  Never edits the order — the atelier applies
  │                                  the change by hand
  ├─ POST /api/orders/:n/reviews   → files a post-delivery review (rating +
  │                                  testimonial + optional credit name, publish
  │                                  consent, photos) into the Notion "Reviews"
  │                                  database. Gated: order at its final stage +
  │                                  email must match. Photos reuse the reference-
  │                                  image upload. Status defaults to "New" for
  │                                  the atelier to curate
  ├─ POST /api/orders/:n/cancellation-requests
  │                                → files a cancellation request in the contact
  │                                  database, tagged Request type =
  │                                  "Cancellation". Gated: email must match, and
  │                                  rejected once delivered (that's a return).
  │                                  Never refunds — the atelier uses the button
  │                                  below
  ├─ POST /api/contact             → saves a contact message to the Notion
  │                                  "Website Contact Messages" database + sends
  │                                  an acknowledgement email
  ├─ GET  /api/products            → shop inventory + the live category list,
  │                                  from the Notion "inventory" database
  ├─ GET  /api/colors              → the studio's intake color palette for the
  │                                  order form's color picker (id + name + hex per
  │                                  chip). Read from the atelier-editable
  │                                  `COLOR_PALETTE` Studio Settings value, falling
  │                                  back to a built-in primary palette, so it's
  │                                  always non-empty. No dedicated Notion database
  ├─ GET  /api/services            → the intake service catalog (bespoke commissions,
  │                                  alterations, rhinestoning, repairs) and, per
  │                                  service, what the order form asks for: body
  │                                  measurements, the colour palette, and the
  │                                  label/prompt for its free-text brief (and
  │                                  whether it's required). A code catalog, served
  │                                  rather than duplicated so the form and the
  │                                  `POST /orders` gate can't disagree — the
  │                                  counterpart of `/appointments/options`
  ├─ GET  /api/reviews             → the curated testimonials the marketing pages
  │                                  show, from the Notion "Reviews" database.
  │                                  Anonymous + read-only: only rows the atelier
  │                                  published AND the customer consented to,
  │                                  and never the email / order number. Unset
  │                                  database ⇒ an empty list, not an error
  ├─ GET  /api/shop-orders/:orderNumber
  │                                → a shop order's current fulfillment Status +
  │                                  the live status list (tracking timeline)
  ├─ POST /api/shop-orders/:n/cancellation-requests
  │                                → shop-order cancellation request into the same
  │                                  contact database. Gated on email match only
  ├─ POST /api/shop-orders/:n/return-requests
  │                                → return/exchange request (kind + reason +
  │                                  item(s) + optional exchange-for + note),
  │                                  tagged Request type = "Return / exchange".
  │                                  Gated on email match (403); legacy orders with
  │                                  no stored email are accepted but flagged
  │                                  unverified. Never refunds or edits the order
  ├─ POST /api/notify              → back-in-stock request (email + item +
  │                                  optional size), tagged "Back in stock"
  ├─ POST /api/newsletter          → marketing newsletter opt-in (email + optional
  │                                  source), tagged "Newsletter", + a best-effort
  │                                  welcome email from the contact sender. No
  │                                  atelier notification (a list needs no triage)
  ├─ POST /api/checkout            → prices the requested in-stock items from live
  │                                  Notion inventory and creates a Stripe Checkout
  │                                  session; returns the hosted-checkout URL
  ├─ GET  /api/checkout/session/:id→ a session's status + itemized receipt
  │                                  (items, shipping, tax, total)
  ├─ GET  /api/appointments/options→ bookable appointment types (duration, allowed
  │                                  staff + locations, gates) + booking timezone
  ├─ GET  /api/appointments/availability
  │                                → open slots for a type/location/(staff) over a
  │                                  date window, from working hours minus Google
  │                                  Calendar free/busy
  ├─ POST /api/appointments        → books an open slot (re-checked server-side),
  │                                  writes a Google Calendar event inviting the
  │                                  customer (+ Meet for virtual), emails a
  │                                  confirmation with a signed manage link
  ├─ GET  /api/appointments/manage → current details of a booking, identified by
  │                                  the signed token (read live from Calendar)
  ├─ POST /api/appointments/reschedule
  │                                → moves the booking to a new open slot — same
  │                                  staff/type/location, PATCHes the event
  │                                  (re-notifying), emails a confirmation
  ├─ POST /api/appointments/cancel → deletes the event (frees the slot + notifies),
  │                                  emails a confirmation. Idempotent
  ├─ POST /api/webhooks/stripe     → Stripe webhook (raw body, signed). On
  │                                  checkout.session.completed records the paid
  │                                  order in Notion "Shop Orders", or marks a
  │                                  custom-order payment stage paid on its
  │                                  invoice. NOT part of the OpenAPI contract
  ├─ POST /api/webhooks/notion-stage-change
  │                                → order status-change email. A Notion database
  │                                  automation ("when Stage changes, send webhook")
  │                                  POSTs its default payload (the page id in
  │                                  data.id) or an authored { orderNumber }; the
  │                                  server reads the order back from Notion (never
  │                                  trusting the payload's stage) and sends the
  │                                  status-update email with a pipeline graphic
  │                                  (best-effort, from orders@) — but only on
  │                                  FORWARD movement, gated by a `Last Notified
  │                                  Stage` marker so a backward edit / re-fire
  │                                  doesn't email. Auth is a Bearer CRON_SECRET
  │                                  header (or a `?secret=` query token). NOT part
  │                                  of the OpenAPI contract.
  ├─ GET  /api/cron/generate-milestones
  │                                → Vercel Cron reconciliation (CRON_SECRET-
  │                                  guarded, Bearer header, JSON). Finds orders
  │                                  with a "Due Date" but no milestones and writes
  │                                  one per-stage milestone row to the Notion
  │                                  "Production Schedule" database. Also emails a
  │                                  best-effort fitting reminder for any "Fitting"
  │                                  milestone due within the lead window (see
  │                                  "Automated fitting reminders") and a
  │                                  best-effort payment reminder for any invoice
  │                                  deposit/balance coming due or overdue (see
  │                                  "Payment & deposit due reminders"), a
  │                                  back-in-stock alert sweep, and a best-effort
  │                                  day-before reminder for every booked
  │                                  appointment coming up (see "Day-before
  │                                  appointment reminders").
  │                                  NOT part of the OpenAPI contract.
  ├─ GET  /api/studio/availability
  │                                → the atelier's standing working hours (the
  │                                  positive grid booking is computed from),
  │                                  plus the staff they may be assigned to.
  │                                  POST / PUT / DELETE the same path add,
  │                                  replace and remove one block of hours. Same
  │                                  staff gate as the figures above; this
  │                                  replaced the Google Sheet the schedule used
  │                                  to live in
  ├─ GET  /api/studio/reviews      → the review moderation queue: every review
  │                                  awaiting a decision (with its rating,
  │                                  testimonial, author, and the photos read
  │                                  from its Notion page body) plus the recently
  │                                  decided ones. PUT
  │                                  /api/studio/reviews/:id/status records one
  │                                  decision — `published` / `rejected` /
  │                                  `pending`. Same staff gate as the figures
  │                                  above; publishing without the customer's
  │                                  consent is refused (409)
  ├─ GET  /api/studio/requests     → the customer-request queue: the open rows of
  │                                  the shared contact inbox (inquiries, back-in-
  │                                  stock asks, measurement changes, cancellations,
  │                                  returns), oldest first, plus the recently
  │                                  closed ones. Each row carries the ORDER NUMBER
  │                                  it concerns and the studio tool that actions
  │                                  it, so a refund no longer starts with re-typing
  │                                  a number read out of Notion. PUT
  │                                  /api/studio/requests/:id/state moves one row
  │                                  through the inbox — `new` / `replied` /
  │                                  `closed`, all reversible. Newsletter opt-ins
  │                                  are excluded — they have their own panel
  │                                  below. Same staff gate as the figures above
  ├─ GET  /api/studio/newsletter   → the marketing opt-ins, and — read LIVE from
  │                                  Resend, never stored — whether each one
  │                                  actually reached the audience broadcasts go
  │                                  out to. The capture-time sync is best-effort
  │                                  and self-gates off when no audience is set,
  │                                  so this is where an opt-in that never synced
  │                                  becomes visible. POST
  │                                  /api/studio/newsletter/:id/subscribe adds one
  │                                  to the audience and then files its Notion row
  │                                  away; refused (409) with no audience
  │                                  configured or no address. Dismissing without
  │                                  adding is the request-state operation above
  └─ POST /api/studio/tools/:tool  → the atelier's five internal actions, run from
                                     the signed-in studio dashboard: milestone
                                     reconciliation (`milestones`, the same sweep
                                     the cron runs, on demand), invoice
                                     itemization from the costing
                                     (`invoice-lines`), an order status-change
                                     email (`status-email`, with a `force`
                                     resend), the cancellation refund
                                     (`cancellation-refund`) and the return /
                                     exchange refund (`return-refund`, with an
                                     optional `amount` TARGET total). Staff-gated
                                     (`requireStaff`) — see "Internal tools on the
                                     studio dashboard". Each returns a composed
                                     `{ status, title, message, details }` the
                                     dashboard renders. IS part of the OpenAPI
                                     contract, unlike the links it replaced.
```

- **Locally:** the Vite dev server proxies `/api` to the Express server on
  `localhost:3000` (`artifacts/web-app/vite.config.ts`).
- **On Vercel:** `vercel.json` rewrites `/api/:path*` → `/api/index`, the
  serverless function at `api/index.ts`. That file imports the **pre-bundled**
  Express app from `artifacts/api-server/dist/app.mjs` (built by esbuild during
  `build:vercel`) — not the TS source, so `@vercel/node` doesn't type-check the
  whole workspace graph. Don't "fix" this by importing the source.

### Customer email

The customer-notification POST endpoints (`/api/orders`, `/api/contact`,
`/api/notify`, `/api/newsletter`, `/api/appointments`,
`/api/appointments/reschedule`, `/api/appointments/cancel`,
`/api/orders/:n/measurement-change-requests`, `/api/orders/:n/reviews`,
`/api/orders/:n/cancellation-requests`, `/api/shop-orders/:n/cancellation-requests`,
`/api/shop-orders/:n/return-requests`) each send a customer email via **Resend**
as a **best-effort** side effect after the Notion write: a failed send is
logged-and-swallowed and never changes the response status
(`artifacts/api-server/src/lib/resend/`).

Order **status-change** emails are the one notification the app can't fire from a
request — stage changes happen inside Notion and there is no Notion→app trigger.
They ride a Notion **database automation** calling
`POST /api/webhooks/notion-stage-change` (see "Order status-change emails"), with
the same Resend adapter and the same best-effort contract.

Each of those also sends an **internal atelier notification** to
`ATELIER_INBOX_EMAIL` (with **Reply-To** set to the customer), but only when that
env var is set; unset ⇒ the notification is skipped and only the customer email
goes out. Customer-facing and atelier-facing builders live side by side in
`lib/resend/emails.ts`. `/api/newsletter` is the exception: it sends the customer
welcome but deliberately **no** atelier notification (a mailing-list opt-in needs
no triage).

Emails are grouped into three **categories** (`lib/resend/config.ts`): **orders**
(order + back-in-stock mail), **contact** (contact-form + newsletter mail), and
**appointments** (booking mail). Each resolves a **sender** and a **notification
inbox** from env, with per-category overrides falling back to the base vars when
unset: sender `RESEND_CONTACT_FROM_EMAIL` / `RESEND_APPOINTMENTS_FROM_EMAIL` →
`RESEND_FROM_EMAIL`; inbox `ATELIER_CONTACT_INBOX_EMAIL` /
`ATELIER_APPOINTMENTS_INBOX_EMAIL` → `ATELIER_INBOX_EMAIL`. Services resolve the
pair via `fromAddress(category)` / `atelierInbox(category)` and spread the `from`
onto the message; the client uses a per-message `from` over its base. So order
mail can send from `orders@` and contact mail from `hello@`.

**Production error alerting.** On top of logging, the app emails an alert to
`ALERT_INBOX_EMAIL` (default `alexandra@a3iceanddance.com`) on error-level
conditions that would otherwise be invisible: an unhandled 500 (the central
`middlewares/error.ts` handler), a failed Stripe-webhook record, a failed
milestone cron, or a customer email Resend rejects (`lib/resend/send.ts`). This is
`services/alert.service.ts` (`reportError` / `reportEmailFailure`). Chosen over a
Vercel Log Drain because Log Drains need a Pro plan (the project is on Hobby) and
an in-process **awaited** send flushes reliably on serverless. Load-bearing rules:
the alert sends via the **strict** `sendEmail` and logs its own failures at `warn`,
never re-entering `reportError` (the loop guard); it self-gates when
`RESEND_API_KEY` / `RESEND_FROM_EMAIL` are unset (inert in dev/test, never blocks a
response); and a per-instance 5-minute de-dupe bounds repeats (it can't throttle
across serverless instances). Deliberately **not** wired to the CRM-upsert
(`warn`-level, order unaffected) or shipping-rate (documented degraded-but-OK,
high-frequency) catches, to keep alerts high-signal.

### The API is contract-first — this is the most important convention

`lib/api-spec/openapi.yaml` is the **single source of truth** for the HTTP API.
Two packages are **generated from it** by [orval](https://orval.dev) and must
never be hand-edited:

- `lib/api-zod` — zod schemas the **server** uses to validate/parse requests and
  responses (`CreateOrderBody`, `GetOrderStatusResponse`, …).
- `lib/api-client-react` — **react-query hooks** (`useGetOrderStatus`, …) and a
  typed `customFetch` client, consumed by the frontend.

Files under `src/generated/` carry a "Do not edit manually" header. To change the
API:

1. Edit `lib/api-spec/openapi.yaml`.
2. Run codegen: `pnpm --filter @workspace/api-spec run codegen` (runs orval, then
   re-typechecks the libs).
3. Update the server route handlers and frontend as needed.

`lib/api-client-react/src/custom-fetch.ts` is the **mutator** (hand-written, not
generated) — the fetch/error-handling layer all generated hooks route through. It
is safe to edit.

Both frontend flows go through the generated client: the unified tracking page
(`pages/track.tsx`) uses `useGetOrderStatus` and `useGetShopOrderStatus`, and the
intake form (`pages/order-form.tsx`) uses `useCreateOrder`. The form's local zod
schema is checked against the generated `NewOrderRequest` where it hands data to
the mutation, so it can't silently drift from the contract.

## Working with Notion (read `.agents/memory/` first)

The Notion integration lives in `artifacts/api-server/src/lib/notion/`
(`client.ts` for the REST client; each domain has a `*.schema.ts` for property-name
constants + extraction helpers, a `*.blocks.ts` for the page-body/property builder,
and a `*.repository.ts` for reads/writes). Three rules:

1. **Property types must match the live schema, not the property name.** "Order
   Number" is a Notion `rich_text` property, **not** `number` — values have leading
   zeros (`"000002"`), so filters must use `rich_text: { equals }`. Before writing
   any Notion filter, inspect the actual `type` of the property on a sample page.
   See `notion-status-filters.md`.

2. **Never hardcode a Notion option list.** The atelier edits select/status options
   directly in Notion and expects changes to appear without a redeploy.
   `fetchLiveOrderStages()` reads the order **Stage** options live from
   `GET /v1/databases/{id}` with a 60s in-memory TTL cache, falling back to the
   cached list on error (`notion/orders.repository.ts`). Don't reintroduce a
   hardcoded constant for it. (The per-stage description text in
   `lib/stage-descriptions.ts` is cosmetic only.)

   The **shop's category list is a dedicated "Product Categories" database**. Each
   inventory row points at a category via a `Category` **relation**;
   `listCategoryRecords()` (`notion/product-categories.repository.ts`, same 60s
   cache + fallback) reads the category name, `Show size guide` flag,
   `Size Guide Type`, and `Sort` order, and `products.service` resolves each
   product's category + `sized` flag + `sizeGuide` by joining the relation. A
   category rename propagates automatically; a new category defaults unsized.
   `NOTION_PRODUCT_CATEGORIES_DATABASE_ID` must be set — there is no fallback.

   **Which size chart a category shows is Notion-driven, not name-matched.** The
   shop has two charts (`web-app/src/components/size-chart-dialog.tsx`): the
   ready-to-wear body-measurement chart (Jalie bands) and the skate-soaker
   blade-length chart. A category's `Size Guide Type` **select** picks between them
   via the same `Category` relation, so renaming the "Skate Soakers" category never
   breaks routing. A soaker category is treated as sized regardless of its
   `Show size guide` checkbox. On the API this is `Product.sizeGuide`
   (`garment` | `soaker`, omitted ⇒ garment); the frontend passes it to
   `SizeChartDialog`'s `variant` prop.

   The deliberate exceptions are _targeted business rules_ naming specific option
   values: `STATUS_IN_STOCK` ("In Stock" is the only sellable status),
   `MEASUREMENT_LOCK_FROM_STAGE` (`services/measurement-lock.ts`, default
   `Cutting/Pinning`, env-overridable; `measurementsLocked()` is the gate, consumed
   by `services/measurement-change.service.ts`), and `SIZE_GUIDE_TYPE_SOAKER` (the
   `"Skate soaker"` value routing a category to the blade-length chart, in
   `notion/product-categories.schema.ts`). These name values, not the list — rename
   those options in Notion and you must update them here too.

3. **The contact database has six writers.** "Website Contact Messages" holds
   contact-form messages (`contact.blocks.ts`), back-in-stock requests
   (`notify.blocks.ts`), measurement-change requests
   (`measurement-change.blocks.ts`), newsletter opt-ins (`newsletter.blocks.ts`),
   cancellation requests (`cancellation.blocks.ts`), and shop-order return/exchange
   requests (`return-request.blocks.ts`), separated by the **Request type** select
   (`Inquiry` / `Back in stock` / `Measurement update` / `Newsletter` /
   `Cancellation` / `Return / exchange`). A restock request carries **Item** and
   **Size** as real properties, a measurement-change request carries the order
   number + requested measurements, and a return/exchange request carries the shop
   order number + kind + reason (reusing the shared **Item** property), so the
   atelier can filter the inbox by request type rather than reading it out of free
   text. A newsletter opt-in needs no property of its own — its `source` (footer /
   order form) is folded into the subject.

   The property names these writers share are exported from `contact.blocks.ts` and
   imported by the other five — and now by `requests.schema.ts`, which reads the
   same rows back for the studio dashboard's request queue (see "Customer requests
   on the studio dashboard"). Keep it that way so they can't drift (the return
   writer also reuses `NOTIFY_ITEM_PROPERTY` from `notify.blocks.ts`). All six also
   best-effort **link to the Client CRM** (the shared `Client` relation,
   `CONTACT_CLIENT_PROPERTY`) via the same `upsertClientByEmail` the order flow
   uses: an inquiry / back-in-stock request / newsletter opt-in creates a `Lead`; a
   measurement change / cancellation / return reuses the order's existing (`Active`)
   client. See `.agents/memory/notion-p2-duplicates.md`.

### Newsletter opt-in and the mailing list

`POST /api/newsletter` (contract-first) records explicit marketing consent in the
contact database and sends a best-effort **welcome** email from the **contact**
sender (hello@), keeping it off transactional orders@. Two capture surfaces feed
it: a footer field (`components/newsletter-signup.tsx`, rendered by `footer.tsx`)
and an intake checkbox on the order form (`pages/order-form.tsx` fires a separate
best-effort `useSubscribeNewsletter` call, so the order contract is untouched).
Code: `services/newsletter.service.ts`, `routes/newsletter.ts`,
`lib/notion/newsletter.{blocks,repository}.ts`, `newsletterWelcomeEmail` in
`lib/resend/emails.ts`. It needs **no new database** — it reuses the contact
database, the Resend contact sender, and the optional Client CRM.

**The mailing list is managed in Resend, not Notion — Notion is the record, not the
list manager.** A list needs one-click unsubscribe (a Gmail/Yahoo bulk-sender
requirement), a way to send a campaign, and reputation isolation from transactional
mail — none of which Notion can do. On opt-in the subscriber is **also** best-effort
synced into a **Resend Marketing Audience** (`upsertAudienceContactBestEffort` in
`lib/resend/audience.ts`), which becomes the sending list and the **subscription
authority** (it owns subscribed/unsubscribed). Campaigns are sent as Resend
**Broadcasts from the dashboard** — there is deliberately **no** in-app campaign
sender or scheduled-send cron. Resend attaches the one-click unsubscribe +
`List-Unsubscribe` header to every Broadcast, which is what makes the "unsubscribe
anytime" copy on `order-form.tsx` and the **Marketing emails** section of
`pages/privacy.tsx` true.

Load-bearing: `lib/resend/audience.ts` is the **only** place the app uses Resend's
Contacts API (everything else in `lib/resend/` is transactional `send`); it
**self-gates** on `RESEND_AUDIENCE_ID` (unset ⇒ the sync is skipped and the opt-in
is still captured in Notion) and is **best-effort** (a Resend hiccup never fails the
opt-in). The upsert re-subscribes a previously-unsubscribed email that re-opts-in
(create with `unsubscribed:false`, else PATCH by email). One-time setup: create an
Audience in Resend → **Audiences**, set `RESEND_AUDIENCE_ID`, send via Resend →
**Broadcasts** (free ≤1,000 contacts). The studio dashboard's **newsletter panel**
reconciles the two — it lists the opt-ins Notion holds and asks Resend which of
them actually reached the audience, which is the only place a silently-failed
best-effort sync becomes visible (see "The newsletter panel").

**Auth:** the server reads `NOTION_API_KEY` and `NOTION_ORDERS_DATABASE_ID` from
environment variables (via `createNotionClient` in `notion/client.ts`, read at first
use rather than module load).

## Studio Settings (atelier-editable config in Notion)

Runtime **business tunables** can be retuned live from an optional **"Studio
Settings"** Notion key/value database, so the atelier changes them in Notion instead
of editing env vars + redeploying — the same live-read philosophy as
stages/categories/working-hours.

1. **Only non-secret tunables live here.** Secrets (`NOTION_API_KEY`, `STRIPE_*`,
   `RESEND_API_KEY`, `SESSION_SECRET`, `CRON_SECRET`, `GOOGLE_SERVICE_ACCOUNT_KEY`,
   `SUPABASE_ANON_KEY`, `POSTGRES_URL`) and bootstrap wiring (every
   `NOTION_*_DATABASE_ID`, `SUPABASE_URL`, `PUBLIC_BASE_URL`, …) stay in Vercel — a
   Notion DB is not a secrets store, and you can't read Notion settings without the
   API key + the settings DB's own id. The keys that ARE read from settings are
   enumerated in `SETTING_DEFINITIONS` (`lib/settings/catalog.ts`): `RUSH_SURCHARGE_RATE`,
   `MEASUREMENT_LOCK_FROM_STAGE`, the five `APPOINTMENT_*` policy vars, the reward
   amounts, `COLOR_PALETTE` (the intake color picker's palette), and the
   notification **inboxes** (`ATELIER_INBOX_EMAIL`, `ATELIER_CONTACT_INBOX_EMAIL`,
   `ATELIER_APPOINTMENTS_INBOX_EMAIL`, `ALERT_INBOX_EMAIL`). Email **senders**
   (`RESEND_*_FROM_EMAIL`) deliberately stay env-only — they're coupled to Resend
   domain verification, so a wrong value would silently break delivery.

2. **Resolution order is Notion → env → default.** Each getter reads
   `settingValue(KEY) ?? process.env[KEY] ?? default`, so an unset row or an
   unconfigured DB behaves **exactly** as env-only. The Notion `Setting` (title)
   matches the env var name 1:1 so the mapping can't drift; a `Value` and a human
   `Description` complete the row. A blank `Value` reads as unset.

3. **Sync getters, primed once per request.** The getters are synchronous; Notion
   I/O is async. `app.ts` mounts a middleware that `await primeSettings()` at the
   start of every request, refreshing the in-memory snapshot the sync getters read;
   the read itself is the usual **60s TTL cache + fallback**
   (`lib/notion/settings.repository.ts`, self-gating to an empty map when
   `NOTION_SETTINGS_DATABASE_ID` is unset or a fetch fails, so a settings hiccup
   never errors a request). Until primed (tests, first request) the snapshot is
   empty and everything falls back to env. Test seams: `__setSettingsSnapshot` /
   `__resetSettings` (store) and `__resetSettingsCache` (repository).

4. **Each key is a typed catalog entry, and that's what the dashboard renders.**
   `lib/settings/catalog.ts` holds one `SettingDefinition` per key — its label,
   group, `kind`, the description, the built-in default as text, and **two**
   validators. The split between them is load-bearing: **`accepts` mirrors the
   runtime getter** ("would the app honour this value?") and decides whether a
   stored value is in force or is being ignored, so it must never be stricter
   than the getter or the dashboard would report a value as thrown away while the
   app was using it. **`validate` guards a write** and is deliberately allowed to
   be stricter — the runtime takes any non-negative rush rate, but `15` (meaning
   15%) would price a 1500% surcharge, so the editor refuses it. Writes may be
   fussier than reads; reads must honour whatever is already stored. The catalog
   **restates** each default rather than owning it, so
   `test/unit/settings.catalog.test.ts` drives every real getter with an empty
   snapshot and asserts it lands on the catalog's default — that test is what
   stops the two drifting, not a convention.

See "Studio settings, edited on the dashboard" below for the editor built on it.

One-time setup (all optional — unset ⇒ env-only): create the "Studio Settings"
database (a `Setting` title, a `Value` text, a `Description` text), share the
integration with it, set `NOTION_SETTINGS_DATABASE_ID`, and fill in a `Value` only
for the settings to override. Code: `lib/notion/settings.{schema,repository}.ts`,
`lib/settings/{store,catalog}.ts`, `getSettingsNotionClient` in `notion/client.ts`,
the prime middleware in `app.ts`, and the consuming getters (`services/rush.ts`,
`services/measurement-lock.ts`, `services/rewards.service.ts`,
`lib/appointments/settings.ts`, `lib/resend/config.ts`, `services/alert.service.ts`).

## Studio settings, edited on the dashboard

The settings above have been live-editable in Notion for a while — as a free-text
key/value table, which is a surface that **cannot tell you anything**. Both halves
of a row fail silently when they're wrong: a mistyped **key**
(`RUSH_SURCHARGE_RAT`) is a row nothing ever reads, and a mistyped **value**
(`15%` where a fraction was wanted) is parsed, rejected, and replaced by the
built-in default. In Notion both look exactly like a setting in force. `/studio` →
**Studio settings** is the surface that ends that: `GET /api/studio/settings`
resolves every known key and says where its value came from, and
`PUT /api/studio/settings/{key}` validates before it writes. Code:
`services/studio-settings.service.ts`, the two handlers in `routes/studio.ts`,
`fetchSettingRows` / `saveSetting` / `settingsConfigured` in
`lib/notion/settings.repository.ts`, `extractSettingRows` in
`settings.schema.ts`, and `web-app/src/components/studio-settings.tsx`.

1. **Resolution is mirrored exactly, including the part that surprises people.**
   Every getter reads `settingValue(KEY) ?? process.env[KEY]` and _then_ parses,
   so a value present in Notion but unusable falls back to the **default** — it
   does **not** fall through to the environment, because the environment was never
   consulted. `source` reports that honestly (`default`, with the discarded value
   on `ignoredValue`); reporting `environment` would be wrong in the one case
   somebody opens this page to understand.

2. **The read is deliberately neither the cached map nor degrade-safe.** It reads
   **rows**, not the key→value map: a mistyped key simply isn't in that map, and a
   duplicate row loses to whichever came last — both states the editor exists to
   make visible. It is **uncached**, because the atelier looks at it immediately
   after saving and a 60s-stale answer reads as the save having failed. And it
   **throws** where `fetchStudioSettings` returns an empty map: every settings
   consumer has an env fallback behind it, but an editor showing an empty list
   would just be lying.

3. **Unknown rows are reported with the key they were probably meant to be.** A
   row whose key isn't a setting is listed with a bounded (≤2 edit) near-miss
   suggestion, matched case- and punctuation-insensitively so `Rush Surcharge
Rate` finds `RUSH_SURCHARGE_RATE`. This panel is the only place in the app
   where such a row is visible at all.

4. **A blank value is a CLEAR, not a rejection**, and there is deliberately no
   delete: a blank `Value` reads as unset everywhere, so clearing is how a setting
   is handed back to its env var / built-in default, and keeping the row keeps the
   key documented. The write updates the row that already holds the key or creates
   one, seeding `Description` from the catalog — with **one bounded retry without
   it** (Notion rejects the _whole_ create when a page names a property the
   database lacks, and `Description` is the one property the setup calls optional,
   so a database without that column could otherwise never save a setting at all).
   A successful write **drops the cached map**, so the next request's
   `primeSettings` sees the change rather than the save appearing not to work.

5. **The field is seeded from the Notion value, never the effective one.** An
   environment value shown in an editable box would be copied into Notion the
   moment anyone pressed Save, silently moving where that setting lives.

6. **An unconfigured database is said plainly, not rendered as an empty editor.**
   `configured: false` ⇒ the values shown are still real (the environment's and
   the built-ins') but nothing is editable, and a write answers **409** rather
   than offering a Save with nowhere to write — the same "a state only a human can
   clear" shape as the materials panel's unreachable database.

Same `requireStaff` gate as the rest of the studio surface (401 / 404 / 403), and
contract-first like the rest of the dashboard. **No new env var and no atelier
setup** — it reads and writes the same Studio Settings database, the same `Setting`
/ `Value` / `Description` properties, and the same env vars as before. To add a
setting, add its key to `SETTING_DEFINITIONS` **and** its getter together: a key
missing from the catalog still resolves at runtime, but the atelier can't see or
edit it.

## Working with Stripe (shop checkout)

The shop sells ready-to-ship items through **Stripe Checkout (hosted)**. The
client-side cart (`web-app/src/lib/cart.tsx`, persisted to localStorage) POSTs
`{ variantId, size?, quantity }[]` to `/api/checkout`; the server prices them from
live Notion inventory, creates a Checkout session, and returns its URL; the browser
redirects; Stripe calls `/api/webhooks/stripe` on completion, which records the
paid order in Notion. Code: `services/checkout.service.ts`, `lib/stripe/*`,
`routes/checkout.ts`, `routes/stripe-webhook.ts`, `lib/notion/shop-orders.*`.
Load-bearing points:

1. **Never trust client-sent money.** The cart sends only ids/sizes/quantities.
   `checkout.service` recomputes every price and availability from `listVariants()`
   (live Notion), converts dollars → integer cents (`Math.round(price * 100)`), and
   rejects sold-out / unpriced / unknown items with a `BadRequestError` (→ 400). An
   "inquire for price" item (no `Listed Price`) is not purchasable.

2. **The webhook needs the RAW body.** Stripe verifies the signature against the
   exact bytes, so `/api/webhooks/stripe` is mounted in `app.ts` with
   `express.raw()` **before** the global `express.json()`, and directly on the app
   (not the `/api` router). It is deliberately **not** in `openapi.yaml` — a
   Stripe→server contract, not part of the browser API.

3. **Recording is idempotent.** Stripe delivers at-least-once and retries on any
   non-2xx. When the **Postgres layer** is configured, shop-order dedup is an atomic
   `processed_payments` **claim**: `recordPaidOrder` claims the session id
   (`insert … on conflict do nothing`), writes the Notion order, then confirms; a
   failure releases the claim so a redelivery reprocesses cleanly, and a still-
   `processing` claim throws so Stripe retries later instead of racing a duplicate.
   When Postgres is **unset** it falls back to the Notion read-before-write dedup
   (`findOrderBySessionId` before insert). Either way that Notion guard is retained
   as a reclaim-only backstop (`createShopOrder` isn't itself idempotent).
   Custom-order payments don't use `processed_payments` — `recordPayment` is
   idempotent via the Notion invoice write alone.

4. **Stock decrements by WRITING ROWS, not by writing a number.** A paid order
   writes one **"order lines"** row per purchased item (`Item` relation → the
   inventory row, plus `Qty`, `Unit Price` and `Size`), and the atelier's
   existing rollups do the arithmetic: inventory's **`Units Sold (auto)`** sums
   each line's `Counts Toward Sold` formula (its `Qty`, unless the parent order
   is `Voided`) through that relation, and **`Quantity Available`** subtracts it.
   That indirection is the whole design — `Quantity Available` is a Notion
   **formula** and can't be written, so the line row is the only thing there is
   to write. See "Automatic shop inventory decrement" below.

5. **Shipping rates live in Stripe, not code.** `checkout.service` reads
   `STRIPE_SHIPPING_RATE_IDS` (comma-separated `shr_…` ids the atelier creates and
   prices in the Dashboard) and attaches them as the session's `shipping_options`;
   unset ⇒ no shipping is charged. The order's `Total` (Stripe `amount_total`)
   includes shipping + tax, and `buildShopOrderPageBlocks` adds "Shipping" and "Tax"
   lines to the Notion page body so the itemized bullets reconcile. Each id is
   **validated at session-create time** (`resolveShippingOptions`): retrieved from
   Stripe and kept only if it exists, is active, and is priced in USD. An id that
   fails — deleted/archived, or from the wrong Stripe mode — is **dropped and logged
   at `error`** rather than 500-ing the checkout; if every id is invalid, checkout
   proceeds with no shipping charged. Watch the runtime logs for the actionable
   "Skipping shipping rate" message.

6. **Tax is Stripe Tax, on the shop cart only.** `checkout.service` sets
   `automatic_tax: { enabled: true }` and `tax_behavior: "exclusive"` (listed prices
   are pre-tax), so tax is computed from the collected address — configure the origin
   - a default tax category in the Dashboard or it computes $0. **Deposits are
     intentionally untaxed** (tax is assessed on the final balance), so
     `invoice.service` sets `automatic_tax` only on the `balance` stage.

7. **Receipts are Stripe's job; the success page mirrors them.** The emailed receipt
   is a Dashboard setting (Settings → Emails → "Successful payments"), not code.
   `getCheckoutSession` retrieves the session with `expand: ["line_items"]` and
   returns an itemized view (line items + subtotal / shipping / tax / total, in
   dollars); `pages/shop-success.tsx` renders it as an on-site receipt. Works for
   both shop-cart orders and deposits.

8. **Each shop order gets a human-readable order number.** `createCheckoutSession`
   mints an `SHP-…` number (`generateShopOrderNumber` in `shop-orders.blocks.ts`)
   and stores it in `metadata.orderNumber`, so it reaches the webhook with no extra
   Stripe round-trip: `buildShopOrderProperties` writes it to the Shop Orders
   `Order Number` (rich_text) property, and `getCheckoutSession` returns it for
   `shop-success.tsx`. The customer tracks the order at `pages/track.tsx`
   (`GET /shop-orders/:orderNumber` → `services/shop-orders.service.ts` →
   `findShopOrderByNumber` / `fetchLiveShopOrderStatuses`), which reports the live
   Notion `Status` workflow as a timeline (read live, never hardcoded). The number
   also appears in the shop confirmation email and the atelier notification. The
   lookup only serves orders placed after this shipped.

   Once the order ships the atelier can add **carrier tracking** — three optional,
   additive properties the app only reads: `Tracking Number` (rich_text), `Carrier`
   (rich_text, a display label), and `Tracking URL` (url).
   `findShopOrderByNumber` reads them via `readTracking`, gated on the number (a
   carrier/url with no number is dropped), into `ShopOrderRecord.tracking` → the
   contract's `ShopOrderStatus.tracking`. `shop-order-result.tsx` renders a
   "Tracking" panel below the timeline, suppressed on a cancelled order. No new env
   var and nothing to write.

9. **Matching add-ons are a self-relation on the inventory, resolved client-side.** A
   product can offer companion items (a skate soaker → its matching blade towel) via
   a **`Matching Add-ons`** relation pointing at other inventory rows. The add-on is
   an ordinary in-stock, priced, one-size variant that also appears as its own shop
   card. `products.schema.ts` maps the relation to `addOnIds: string[]`
   (`extractRelationIds`), the service passes it through (omitted when empty), and
   `ProductVariant.addOnIds` carries just the ids — the frontend resolves them
   against the already-loaded product list (`resolveAddOns` / `indexVariants` in
   `pages/shop.tsx`, keeping only in-stock priced add-ons). `add-to-cart.tsx` renders
   an opt-in checkbox per resolved add-on; a ticked one becomes its **own** cart line
   (quantity 1, independent of the main item's quantity), so `checkout.service`
   prices and stock-checks it with **no** checkout changes. Because they're distinct
   lines, removing the soaker doesn't remove the cloth (accepted for v1). Add-ons
   follow the _selected_ variant, so a color-specific relation shows the right match.

10. **Installment financing (BNPL) is an opt-in env list, priced by Stripe.** The
    optional `STRIPE_BNPL_METHODS` (from `klarna`, `affirm`, `afterpay_clearpay`)
    offers buy-now-pay-later — Stripe pays the studio in full up front and carries
    the installment risk, so nothing extra reconciles on our side.
    `bnplPaymentMethodTypes()` (`lib/stripe/payment-methods.ts`) validates the list
    against the supported set (unknown ids dropped + logged at `error`) and returns
    `["card", ...methods]`. **Applied to the shop cart and the custom-order final
    balance only** — both collect an address that BNPL needs; deposits stay card-only
    (`taxed ? bnplPaymentMethodTypes() : undefined` in `invoice.service`).
    Load-bearing: setting the var **pins** `payment_method_types` to card + these
    methods, overriding Stripe's dynamic payment methods on those sessions (Link and
    other Dashboard methods won't appear); **unset ⇒ `payment_method_types` is
    omitted ⇒ dynamic methods** (degrade-safe). Card is always prepended and an
    all-invalid list degrades to omitted, so a typo can't produce a card-less
    checkout. Each method must **also** be enabled in the Stripe Dashboard, is
    **mode-scoped** like the shipping rates, and Stripe hides an ineligible method
    itself, so no amount-gating lives here.

One-time setup: create the "Shop Orders" Notion database (properties in
`shop-orders.blocks.ts`, including the `Order Number` rich_text property) and share
the integration with it. Local testing uses Stripe test-mode keys +
`stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

### Automatic shop inventory decrement (the "order lines" rows)

A paid shop order writes one Notion **"order lines"** row per purchased item, and
that is the shop's stock decrement. The machinery it feeds already existed and had
never fired: checkout recorded the items only as free-text bullets on the order
page, so the lines database stayed empty and stock drifted from the day the shop
opened. Code: `services/order-lines.service.ts`,
`lib/notion/order-lines.{blocks,repository}.ts`, `getOrderLinesNotionClient`, and
the `recordShopOrderLines` call at the tail of `processPaidShopOrder`
(`services/checkout.service.ts`). Load-bearing decisions:

1. **The row IS the decrement — there is no number to write.** Inventory's
   `Quantity Available` is a **formula** over a **`Units Sold (auto)`** rollup,
   which sums each line's **`Counts Toward Sold`** formula (its `Qty`, unless the
   parent order is `Voided`) through the line's **`Item`** relation. So the app
   writes a row and the atelier's rollups do the arithmetic — no writable count
   property, and no second store to keep in step. A line **without** an `Item`
   relation contributes nothing, which is why a Stripe line we can't resolve to an
   inventory row is **skipped and warned** rather than written as litter.

2. **Best-effort, always — the paid order outranks its bookkeeping.** The lines
   are written after the order's own Notion page, on the Stripe webhook path. A
   throw there would 500 the webhook, Stripe would redeliver, and the redelivery
   would early-return at the dedupe guard — losing the lines anyway and risking a
   duplicate order. So every failure is caught **per line** (one bad row doesn't
   cost the rest of the order its stock movement) and logged at **`error`**,
   because a missed line drifts stock invisibly. Same reason the reclaim path
   (order page already exists) writes no lines: like the confirmation email and
   the rewards, they're skipped, not retried.

3. **Quantity, price and size come from Stripe, not the cart.** The webhook
   re-reads the session (`expand: ["line_items.data.price.product"]`), so what's
   recorded is what was actually paid for. `checkout.service` stamps the
   **`size`** onto each ad-hoc product's metadata alongside the `variantId` it
   already carried — the size is in the display name too, but parsing it back out
   of a string would be guesswork. `Unit Price` is the **listed** unit price, not
   the discounted one: the order's `Items Subtotal` rollup is meant to be compared
   against its `Total` to show shipping, fees and discounts.
   `resolvePurchasedInventoryIds` (the `Inventory Items` relation) is now **derived
   from the same** `purchasedLinesFromSession`, so the relation and the line rows
   can't disagree about which inventory rows an order touched.

4. **Cancelling an order puts its units back, via `Voided`.**
   `setShopOrderCancelled` ticks the **`Voided`** checkbox in the same PATCH as
   `Cancelled` — `Voided` is what `Counts Toward Sold` reads, so it's what makes
   the rollup fall back. The two are separate properties on purpose: `Cancelled`
   is the customer-facing state the tracking page renders, `Voided` is the
   bookkeeping fact the rollups travel (and the atelier ticks it by hand for an
   order the app never took money for). A **return/exchange** refund deliberately
   does **not** void — whether a returned piece goes back on the shelf is the
   atelier's call, since it may come back unsellable.

5. **Still no reservation logic, by design.** Stock moves at **payment**, so an
   abandoned checkout consumes nothing, but nothing is held between session
   creation and payment either — two simultaneous checkouts can still oversell the
   last piece. The quantity cap in `toLineItem` (against live `Quantity Available`)
   remains the only guard. Reserving would need a store of its own; the roadmap
   card explicitly scoped it out.

6. **Optional, and unset means exactly the old behavior.**
   `orderLinesConfigured()` gates the whole pass on
   `NOTION_ORDER_LINES_DATABASE_ID`, so a workspace that hasn't shared the database
   with the integration records paid orders as before and just doesn't decrement —
   never a failed order over bookkeeping.

The atelier's one-time setup: share the Notion integration with the **"order
lines"** database and set **`NOTION_ORDER_LINES_DATABASE_ID`**. Nothing to add in
Notion — `Line`, `Item`, `Order`, `Qty`, `Unit Price`, `Size` and the two formulas
already exist, as do inventory's `Units Sold (auto)` / `Quantity Available` and the
shop order's `Voided`. Note that lines exist only from this deploy onward, so
reconcile the drift once by adjusting each item's **`Sold (opening)`** — the app
never writes that property and never reads these rollups back except as
`Quantity Available`.

### Custom-order payments (the invoice is the source of truth for all three stages)

Custom orders are quoted offline and paid online in **three staged payments**: a
**first deposit** (after the sketch is finalized), a **second deposit** (at the
first fitting), and the **final balance** (after delivery = itemized materials +
labor − both deposits). All three are owned by the order's **invoice** in the
atelier's Notion finance system — the app **reads** it, it does not recreate or
recompute the costing. The order row carries only the `Invoices` relation (limit 1);
it holds **no** deposit fields.

- **`invoices & payments`** (`NOTION_INVOICES_DATABASE_ID`): one invoice per order
  (`Order` relation), with `Final Balance` (sums the linked `Line Total`s — it has
  been both a rollup and a formula; the app reads either), `Line Items` relation,
  `Invoice Ready`, and the payment fields: `First/Second Deposit Amount` (number),
  `First/Second Deposit Paid` (checkbox), `First/Second Deposit Session Id`
  (rich_text), `First/Second Deposit Due` (date), `Balance Paid` (checkbox),
  `Balance Payment Session Id` (rich_text), `Payment Deadline` (date). Three
  atelier-facing formulas sit on top and are **not** read by the app: `Paid to Date`,
  `Remaining to Collect`, and `Payment Status`. Property names live in
  `lib/notion/invoice.schema.ts`.
- **`Invoice Line Items`** (`NOTION_INVOICE_LINE_ITEMS_DATABASE_ID`): each line has a
  `Line Type` (Garment / Material / Labor / Adjustment / Surcharge) and a
  `Line Total` (formula). Each material is its own `Material` row. **Deposits are not
  line items** — they live on the invoice head, so there is deliberately no "Deposit"
  option here.

One endpoint serves all three: `POST /orders/:n/payments/:stage`,
`stage ∈ {first_deposit, second_deposit, balance}` (`routes/orders.ts` →
`createPaymentCheckout` in `services/invoice.service.ts`).

1. **Every amount is priced server-side from the invoice.** A deposit's amount is its
   `First/Second Deposit Amount`; the balance is `Σ(Line Totals) − Σ(deposits marked
paid)`, floored at 0 (`buildInvoiceView`). `Line Type = Deposit` rows are
   **excluded** from the subtotal. That option no longer exists in Notion, so the
   filter is a **guard**, kept because re-adding it would otherwise bill a customer
   for their own deposit (Notion's `Final Balance` has no such filter, so a Deposit
   line would inflate the atelier's view while the app stayed correct). A stage with
   no amount set, an already-paid stage, or (for the balance) an unready invoice all 400.

2. **Deposits are payable before the invoice is itemized.** `getOrderStatus` surfaces
   `deposits[]` (from the invoice head) as soon as the atelier sets a deposit amount,
   independent of `Invoice Ready`. The itemized `invoice` object (and the balance
   charge) is gated on `Invoice Ready`. Rendered by
   `components/custom-order-result.tsx` (deposit cards + "View Invoice") and
   `pages/invoice.tsx` (`/invoice/:orderNumber`).

3. **Tax on the balance only.** The balance checkout sets `automatic_tax`,
   `tax_behavior: "exclusive"`, and `billing_address_collection: "required"` (no
   shipping step). Deposits stay untaxed.

4. **Write-back is invoice-only + idempotent.** The one webhook routes
   `metadata.kind = "custom_payment"` to `recordPayment` →
   `markInvoicePaid(invoice, stage, sessionId)`, which ticks that stage's paid
   checkbox + session-id text on the invoice (never the costing formulas). Everything
   else is a shop-cart order. The paid checkbox is the "already paid" guard, and the
   shop-success page skips clearing the cart for `custom_payment`.

One-time setup: add the deposit + balance payment fields above to **invoices &
payments** (the order keeps only the `Invoices` relation); share the integration with
**invoices & payments** and **Invoice Line Items**; set the two env vars.

### Generating invoice line items from the costing

Itemizing an invoice by hand is where a **double charge** used to creep in: the
`costing (custom orders)` item is a _whole-garment aggregate_ (its `Suggested
Price` folds in materials + labor + margin), and an `Invoice Line Item` linked to
that costing item prices at the aggregate — so a costing-item line **plus**
separate material/labor lines counts the same money twice (the `Unit Price`
formula resolves the costing item ahead of the material usage line, so even a
"Material" line linked to both silently bills the whole garment). The generator
removes the foot-gun by owning the itemization: the studio dashboard's
**Itemize an invoice** tool (`POST /api/studio/tools/invoice-lines` with
`{ orderNumber }`, staff-gated) reads the order's costing and writes the lines
itself —

1. **one Material line per non-packaging material usage line**, priced at that line's
   `Line Material Cost` (at cost);
2. **one Labor line** at the summed costing `Labor Cost`;
3. **one reconciling `Adjustment` line "Design & finishing"** = Σ(costing
   `Suggested Price`) − (materials + labor), folding the margin in so the itemized
   total lands **exactly** on the costing's margin-loaded price;
4. for a rush order, **one `Surcharge` line** (see "Rush order surcharge").

Load-bearing: every generated line prices via **`Manual Unit Price`** at quantity
1 and **never links the `Costing Item`** (that link only matters when the manual
price is blank; avoiding it makes the aggregate-vs-components double charge
structurally impossible). It also sets the invoice title (`Invoice ID`) to the
order's `ORD-` number (display-only — lookup is by the order's `Invoices`
relation, never the title). **Idempotent**: it skips an invoice that already has
line items (a repeat run only reconciles the title, and reports that it did
nothing); to regenerate after changing the costing, delete the existing lines and
run it again. **Packaging** usage lines (`Usage Type = "Packaging"`,
`USAGE_TYPE_PACKAGING`) are internal cost and never itemized. Code:
`services/invoice-generator.service.ts`, `services/studio-tools.service.ts`,
`lib/notion/costing.{schema,repository}.ts`,
`lib/notion/invoice-line-items.blocks.ts`, and the `createInvoiceLineItem` /
`setInvoiceTitle` writers in `lib/notion/invoice.repository.ts`.

The atelier must, one time: share the Notion integration with **costing (custom
orders)** and the **material usage database**; and set `NOTION_COSTING_DATABASE_ID`

- `NOTION_MATERIAL_USAGE_DATABASE_ID`. There is no Notion trigger to add — the
  generator is run from `/studio`, which is what retired the formula-property link
  this used to need. The `Suggested Price` costing formula is the
  source of truth for the invoice total; its Notion _description_ text is stale
  ("Break-even price + labor cost") but the **formula is correct**: it marks up the
  break-even cost by the profit margin and grosses up for selling fees —
  `round(base × (1 + margin) / (1 − sellingFees), 2)` with **no `Channel` branch**.
  The fee is **data-driven**: `Pricing Settings` has a **Custom / Direct** row (fees
  0%) and a **Production / Marketplace** row (6.5%), and each costing item relates to
  the right one, so one formula prices every channel (Custom ÷1, Production ÷0.935).
  This is the "one costing engine" standardized model (Phase-2 card ①) — don't "fix"
  the formula to match the stale description, and don't add a `Channel` branch (it
  would duplicate the Pricing Settings relation). See `.agents/memory/invoice-building.md`.

### Order cancellation & refunds

A customer can request cancellation of a custom (`ORD-`) or shop (`SHP-`) order, and
the atelier processes the refund in one click — the same split as every "a customer
asks, the atelier actions" flow: a **gated customer request** + an **atelier button**.

1. **Customer request (contract-first).** `POST /orders/:n/cancellation-requests` and
   `POST /shop-orders/:n/cancellation-requests` file a `Request type = "Cancellation"`
   row into the **contact** database (`cancellation.blocks.ts`), verified against the
   email on the order. The custom endpoint rejects a **delivered** order (409 — that's
   a return); the shop endpoint gates on email only. Best-effort customer confirmation
   - atelier notification + CRM link. This **never** refunds or edits the order. Code:
     `services/cancellation.service.ts`, `routes/orders.ts` + `routes/shop-orders.ts`,
     `lib/notion/cancellation.{blocks,repository}.ts`.

2. **Atelier refund action, from the studio dashboard.**
   `POST /api/studio/tools/cancellation-refund` with `{ orderNumber }` (staff-
   gated — see "Internal tools on the studio dashboard"). It detects custom vs
   shop by the number prefix, refunds each paid Stripe payment, and sets a
   `Cancelled` checkbox on the order. Custom orders refund each paid deposit + the
   balance, read off the invoice (`invoice.schema` reads `balanceSessionId` back —
   a read-only add, no new Notion field); shop orders refund the single stored
   checkout session. Code: `services/order-cancellation.service.ts`,
   `services/studio-tools.service.ts`. (This was a `?secret=` link opened from a
   Notion formula property, `GET /api/orders/process-cancellation[/run]`, until the
   dashboard took it over; the refund logic is unchanged.)

3. **Refunds are idempotent + degrade, never double-charge.** Stripe does **not**
   dedupe `refunds.create` (unlike charges), so `refundCheckoutSession`
   `refunds.list({ payment_intent })` first and skips if any refund already exists
   (including one the atelier issued by hand), and passes an `idempotencyKey` for
   concurrent-press safety. A `$0`/full-promo session (null `payment_intent`) and a
   paid stage with no recorded session id (paid offline) are **skipped** and
   surfaced as "manual refund needed", not failures. A per-session throw (e.g. a
   test-mode session id under a live key) is caught, logged at `error`, recorded in
   the summary, and the run continues. The `Cancelled` marker is set **only after
   every attempted refund succeeded**, so a partial failure leaves the order
   uncancelled and a re-run retries safely (the refund pass is idempotent). The
   customer refund-confirmation email sends **only when something new happened**
   (a refund issued, or the order newly cancelled) — a no-op re-run is silent.

4. **State stays in sync.** `cancelled` is surfaced on both status responses
   (`OrderStatus` / `ShopOrderStatus`) from the `Cancelled` checkbox, so the tracking
   page shows a cancelled banner and hides the deposit / invoice / review / measurement
   - cancellation affordances (`custom-order-result.tsx` / `shop-order-result.tsx`).
     The request dialog is the shared `components/cancellation-request-dialog.tsx`.

The atelier's one-time setup (no new env vars — reuses `STRIPE_SECRET_KEY`, Resend,
the contact DB): add a **`Cancelled` checkbox** to the **Order Tracking Pipeline**
and **Shop Orders** databases. Nothing else — the refund is run from the studio
dashboard's **Cancel & refund an order** tool, which is what retired the
formula-property link both databases used to carry. The `Cancellation`
`Request type` option auto-creates on first write.

## Return & exchange refunds (the atelier-facing half)

A customer files a return/exchange request from shop-order tracking (see
`POST /shop-orders/:n/return-requests` above — Approach A, the request never
refunds anything); the atelier reviews it and processes the refund in one click.
It's the same "customer requests, atelier actions a CRON_SECRET button" split as
order cancellation, and it reuses that flow's `Cancelled`-marker shape — but the
refund **arithmetic** is deliberately different. Load-bearing points:

1. **`?amount=` is a TARGET TOTAL, not an increment.** `?amount=X` means "the
   total refunded on this order should be $X", and the service issues
   `max(0, X − what Stripe says is already refunded)`. This is the whole design,
   because a return can't use the cancellation flow's "any refund exists ⇒ skip"
   guard: a restocking fee is a deliberate **partial** refund, an even exchange
   refunds **nothing**, and the atelier may **top a partial up to full** later.
   Under the cancellation guard the first partial would permanently block the
   top-up; under a naive "refund this increment" model a re-pressed Notion link
   would refund twice. The declarative target gives all of it at once:
   - **Idempotent for the life of the order.** A re-press refunds $0 because the
     target is already met. A Stripe `idempotencyKey` can't do this job alone —
     those expire after 24h and the atelier may click the same link a week later
     (the key is still passed, keyed on the target, for concurrent-press safety).
   - **Can never over-refund.** The delta is computed against Stripe's own refund
     total and the target is clamped to the amount actually captured.
   - Omit `amount` ⇒ refund in full; `amount=0` ⇒ even exchange (refunds nothing,
     still marks the return processed).

2. **Stripe is the source of truth for money — the Notion markers are not.** The
   already-refunded total is read from `refunds.list` on the payment intent, so a
   refund the atelier issued **by hand in the Dashboard** counts against the
   target exactly like one the app issued. The ceiling is the intent's
   `amount_received` (not the session total, which can include an uncaptured
   promo). Consequently the `Refunded Amount` / `Return Processed` writes are
   **atelier visibility only** and **best-effort** (`recordShopOrderRefund`
   resolves `false` instead of throwing): the money has already moved by then, a
   failed write can't cause a double refund on the next run, and the flow works
   before those two properties are added to the database — writing a property
   Notion doesn't have would 400 the whole PATCH.

3. **Degrades, never double-charges.** A shop order with no recorded session
   (paid offline / legacy) and a `$0`/fully-promo session are **skipped** and
   surfaced as "refund manually", not failures. A Stripe throw is caught, logged
   at `error`, and returned as `status: "error"` with nothing refunded and no
   marker written — the dashboard says so plainly rather than claiming success,
   and a re-run is safe because the target is recomputed from Stripe every time.
   The customer refund email (`returnRefundEmail`, **orders** sender) sends only
   when money actually moved, and is best-effort like every other customer mail.

The atelier's one-time setup (**no new env vars** — reuses `STRIPE_SECRET_KEY` +
Resend): add **`Refunded Amount`** (number) and **`Return Processed`** (checkbox)
to the **Shop Orders** database (optional — the refund works without them, they're
just the visible record). The refund is run from the studio dashboard's
**Refund a return** tool (`POST /api/studio/tools/return-refund`), which takes the
order number and an optional amount — so a partial refund is a form field rather
than the `&amount=180` a formula link had to have hand-edited onto its URL. Code:
`services/return-refund.service.ts`, `services/studio-tools.service.ts`,
`lib/stripe/refunds.ts` (the shared Stripe refund primitives), and
`recordShopOrderRefund` in `lib/notion/shop-orders.repository.ts`.

## Production schedule (auto-generated stage milestones)

The atelier plans work in the **"📅 Production Schedule"** Notion database
(`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`), which has Timeline and Calendar views
keyed on `Target Completion Date`. The app **auto-generates one dated milestone row
per remaining stage** for any custom order with a firm due date.

1. **Trigger is a reconciliation cron (plus an on-demand run), not a Notion
   push.** There is no Notion→app trigger (see the deposits/status notes), so the
   atelier sets a `Due Date` on the order in the Order Tracking Pipeline and the
   reconciliation later scans for orders that have a due date but whose
   `Milestones Generated` checkbox is unset, and generates their milestones. It
   runs two ways, both calling `reconcileMilestones` (generation + reminder
   passes; milestone completion state is a live Notion formula now, see point 4):
   a **Vercel Cron** job nightly (`GET /api/cron/generate-milestones`, Bearer
   `CRON_SECRET`, JSON; in `vercel.json` `crons`) and on demand from the **studio
   dashboard** (`POST /api/studio/tools/milestones`, staff-gated), for catching up
   sooner than the next night. The cron endpoint is CRON_SECRET-guarded and, like
   the Stripe webhook, **deliberately outside the OpenAPI contract** (mounted in
   `app.ts`, not the `/api` router); the dashboard tool is contract-first. (The
   `…/generate-milestones/run?secret=` Notion button the dashboard replaced is
   gone — see "Internal tools on the studio dashboard".)
   Code: `routes/cron.ts` → `services/schedule.service.ts` →
   `lib/notion/orders.repository.ts`
   (`findOrdersNeedingMilestones` / `markMilestonesGenerated`) +
   `lib/notion/production-schedule.{blocks,repository}.ts`.

   `reconcileMilestones` runs three passes: generation, then the fitting-reminder pass,
   then the payment-reminder pass (both below). Milestone **completion state is not a
   pass** — it's a live Notion formula (point 4).

2. **Scheduling is an even split over the live stage list — don't hardcode stages.**
   `computeMilestoneSchedule` spreads the stages from the order's current stage forward
   evenly across `[today, dueDate]` (the final stage lands on the due date; a past-due
   date clamps all to the due date). The stage list comes live from
   `fetchLiveOrderStages`, so the schedule adapts when the atelier edits stages. The
   milestone's `Production Stage` is written to a **select** property, which Notion
   auto-creates options for, so no stage constant is baked in either.

3. **Idempotent.** The `Milestones Generated` checkbox plus an existing-milestones
   lookup (`orderHasMilestones`, by the `Order` relation) stop a re-run from
   duplicating rows; the checkbox is only flipped after every row for an order is
   written, and one order's failure is logged-and-skipped (retried next run) rather
   than aborting the batch. To **reschedule** after changing a due date, uncheck
   `Milestones Generated` and delete the stale rows; the next run regenerates.

4. **Completion state is a live Notion formula, not a sync pass.** A milestone's
   completion state is the **`Milestone Status`** _formula_ on the Production Schedule
   database, derived live from the order's `Stage`: an **`Order Stage Index`** rollup
   reads the order's stage (through a `Stage Index Sys` index formula on Custom Orders,
   status→0–10), and `Milestone Status` compares this row's `Production Stage` index to
   it — past → `Completed`, current → `In Progress` (`Completed` at the last/Delivered
   stage), ahead → `Not Started`, unknown → blank. So the calendar reflects real
   progress with nothing to sync, and `buildMilestoneProperties` does not seed a status.

   Trade-off: the two formulas **hardcode the 11-stage pipeline order** (generation
   still reads the live `fetchLiveOrderStages` list; the formulas degrade to blank for
   an unknown stage), so renaming/reordering Stage options means updating them. The
   fitting-reminder query reads `Milestone Status` **client-side** — it filters the
   query only on the `Production Stage` select + `Reminder Sent` checkbox, then
   evaluates the conditions from each row's computed value — because a `formula: {…}`
   **filter** on this rollup-derived formula 400s via the API ("Unable to filter based
   on a formula of unknown type"), even though reading the value back per row works.
   Details + the one-time formula setup live in
   `.agents/memory/phase2-workspace-cards.md`.

The atelier must, one time: add `Due Date` (date) + `Milestones Generated`
(checkbox) to the Order Tracking Pipeline; add `Production Stage` (select) +
`Order` (relation → Order Tracking Pipeline) to the Production Schedule; share the
Notion integration with the Production Schedule database; set
`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID` + `CRON_SECRET`. Nothing needs adding in
Notion to run it on demand — that's the **Reconcile production milestones** tool
on `/studio`. Property names live in `orders.schema.ts` (orders) and
`production-schedule.blocks.ts` (schedule).

## Automated fitting reminders

When a custom order's **"Fitting"** milestone is approaching, the app emails the
customer a best-effort nudge to book (or confirm) their fitting, deep-linking into the
booking flow (`/appointments?type=fitting`). No new endpoint, no new cron, no frontend
change (the booking page already preselects a type from `?type=`).

1. **It rides the nightly reconciliation.** `sendDueFittingReminders` runs after
   generation. It finds Production Schedule milestones whose `Production Stage` is a
   configured fitting stage, aren't `Completed`, haven't been reminded, and are
   **either** due on/before `today + FITTING_REMINDER_LEAD_DAYS` **or** already at the
   fitting stage (`Milestone Status = In Progress`). The In-Progress clause catches an
   order running **ahead of schedule**: it reaches Fitting before the target date, so a
   date-only filter would never fire before the stage advanced to `Completed` and the
   reminder would be missed. Code: `services/schedule.service.ts` →
   `services/fitting-reminder.ts` + `lib/notion/production-schedule.repository.ts`
   (`findMilestonesNeedingFittingReminder` / `markFittingReminderSent`) +
   `fittingReminderEmail` in `lib/resend/emails.ts`.

2. **"Fitting" is a targeted business rule.** `fittingReminderStages()` reads
   `FITTING_REMINDER_STAGES` (comma-separated live Stage option names; default
   `Fitting`) and `fittingReminderLeadDays()` reads `FITTING_REMINDER_LEAD_DAYS`
   (default `10`) — the same deliberate exception as `STATUS_IN_STOCK` /
   `MEASUREMENT_LOCK_FROM_STAGE`. Rename the Fitting stage in Notion and set the
   override (or list a first/second fitting). The email's booking link uses
   `PUBLIC_BASE_URL` and is omitted when unset.

3. **Idempotent via a per-milestone `Reminder Sent` checkbox.** A due milestone is
   emailed once, then marked, so the nightly cron never re-sends. An absent/unchecked
   box reads as `false`. A milestone is marked reminded **even when the order carries no
   email** (a legacy order can't be reached — marking it stops a nightly re-check); if
   the order lookup itself throws, the row is left unmarked so the next run retries.

4. **Customer email only + best-effort.** It sends from the **appointments** sender and
   a Resend failure is logged-and-swallowed, never failing the cron. There is
   deliberately **no** internal atelier notification — the atelier already sees the
   schedule. The milestone rows don't carry the customer email, so each order is
   resolved from its `Order` relation via `findOrderForStageNotificationByPageId`.

No new env vars are required. One-time setup: add a **`Reminder Sent`** (checkbox)
property to the Production Schedule database (the app writes it; leave it unchecked).

## Payment & deposit due reminders

When a custom order's **deposit or final balance is coming due — or is overdue** — the
app emails the customer a best-effort nudge, using the due dates already on the
invoice. Like the fitting reminder: no new endpoint, no new cron, no frontend change
(the CTA deep-links to the tracking page, where the pay buttons live).

1. **It rides the nightly reconciliation.** `sendDuePaymentReminders` runs after
   generation + fitting reminders. It queries **"invoices & payments"** for invoices
   with an unpaid stage whose due date is **on or before
   `today + PAYMENT_REMINDER_LEAD_DAYS`** (which naturally covers already-overdue
   stages) and whose per-stage `Reminded` marker isn't set, then emails one reminder
   **per due stage**. Because invoice rows don't carry the customer email, each order is
   resolved from the invoice's **`Order` relation** via
   `findOrderForStageNotificationByPageId` — the **only** place the app navigates
   invoice → order (everywhere else it reads an invoice _from_ an order's `Invoices`
   relation). Code: `services/schedule.service.ts` → `services/payment-reminder.ts` +
   `lib/notion/invoice.repository.ts`
   (`findInvoicesNeedingPaymentReminder` / `markPaymentStageReminded`) +
   `extractPaymentReminderInvoice` in `lib/notion/invoice.schema.ts` +
   `paymentReminderEmail` in `lib/resend/emails.ts`.

2. **Every amount is read from the invoice, never invented.** A deposit's amount is its
   `First/Second Deposit Amount`; the balance is `Final Balance` − the deposits already
   marked paid (mirroring `buildInvoiceView`'s `balanceDue`, without fetching line
   items), floored at 0 and **omitted from the email** when `Final Balance` isn't set
   yet. The three stages' field mapping (due date, paid checkbox, `Reminded` marker,
   label) is the single `PAYMENT_STAGE_REMINDER_FIELDS` table; the balance's due date
   reuses the existing `Payment Deadline`.

3. **Idempotent via a per-stage `Reminded` checkbox.** `First Deposit Reminded` /
   `Second Deposit Reminded` / `Balance Reminded` is flipped after the email. An
   absent/unchecked box reads as false. The order is resolved **once per invoice**, then
   each due stage is emailed + marked; a stage is marked reminded **even when the order
   carries no email**. If the order lookup throws, the invoice's stages are left
   unmarked so the next run retries. **One reminder per stage** — the first time it's
   within the window or overdue; a repeated-overdue nudge would need a second marker per
   stage. If the reminder query 400s because the setup properties aren't added yet, the
   pass **degrades to a no-op with a warn**, so the nightly cron doesn't alert until the
   atelier configures it.

4. **Customer email only + best-effort.** It sends from the **orders** sender; a Resend
   failure is logged-and-swallowed. Deliberately **no** internal atelier notification —
   the atelier already sees the invoice's `Payment Status`. The pay link uses
   `PUBLIC_BASE_URL` (`/track?orderNumber=…`) and is omitted when unset.

No new env vars are required; the one optional knob is `PAYMENT_REMINDER_LEAD_DAYS`
(default `7`), read in `services/payment-reminder.ts`. One-time setup on **"invoices &
payments"**: add **`First Deposit Due`** / **`Second Deposit Due`** (date) — the balance
reuses **`Payment Deadline`** — and the three `Reminded` checkboxes (the app writes
them; leave unchecked). Until those exist the pass is a no-op.

## Day-before appointment reminders

The day before a booked appointment, the customer gets a best-effort email with
the time, the place, the Meet link if it's virtual, and — the point of it — the
**reschedule / cancel link**, so someone who can't make it moves the slot instead
of not turning up. No new endpoint, no new cron, no frontend change, and nothing
to configure in Notion or Google. Code: `lib/appointments/reminders.ts` (the pure
policy), `services/appointment-reminder.service.ts` (the sweep),
`sendDueAppointmentReminders` in `services/schedule.service.ts`,
`listAppointmentsInRange` / `markAppointmentReminded` in
`lib/google/calendar.repository.ts`, and `appointmentReminderEmail` in
`lib/resend/emails.ts`.

This is a second reminder on top of Google's own calendar notification, and it
earns that: Google's carries none of the manage link, the Meet link, or the
confirmation code, and goes only to whoever accepted the invite.

1. **A sweep over a window, because there is no appointments database.** A booking
   exists only as an event on a staff calendar, so there's nothing to hang a
   per-booking timer on. `listAppointmentsInRange` does one `events.list` per staff
   calendar over the window and filters **client-side** to events carrying the
   `aptEmail` stamp — Google ANDs repeated `privateExtendedProperty` params, so
   "any appointment of ours" can't be asked for server-side the way
   `listUpcomingAppointmentsByEmail` asks for one customer's.

2. **The window is a calendar day, not a duration.** `reminderWindow` runs from
   `now` to the **end of the local day `APPOINTMENT_REMINDER_LEAD_DAYS` ahead**
   (default 1). A "24 hours out" test would miss exactly the bookings this exists
   for: the nightly run fires around 3am studio time, so a 10am appointment
   tomorrow is ~31 hours away when the sweep sees it. Starting at `now` rather than
   at midnight also means a missed run degrades to a **late** reminder, not none.
   `whenPhrase` renders "today" / "tomorrow" / "on Monday, August 24", so the copy
   reads correctly whatever lead the atelier sets.

3. **The idempotency marker is a TIME on the event, not a flag.** After sending,
   `aptRemindedEmail` is stamped on the event with **the start instant that was
   reminded about** (`sendUpdates=none` — bookkeeping must not fire a second
   calendar notification). Two behaviors fall out of that shape rather than needing
   rules of their own: a customer who **reschedules** after being reminded is
   reminded again (the marker no longer matches the new `start`), and the feature
   needs no table and no Notion property. A boolean would have silently suppressed
   every rescheduled booking's reminder.

4. **Send, then mark — the reverse of the back-in-stock sweep, deliberately.**
   There a lost marker means re-emailing forever, so it claims first. Here the
   window closes when the appointment passes, so a failed marker risks at most one
   duplicate, while marking first would risk losing the reminder outright. A marker
   failure is a `warn`, not a throw, and one unreadable booking never strands the
   rest of the night's.

5. **It rides the nightly reconciliation.** `sendDueAppointmentReminders` is the
   fourth notification pass in `reconcileMilestones`, alongside fitting, payment and
   restock — that cron already fires at the hour a day-before reminder wants, and
   the studio dashboard's **Reconcile production milestones** tool is the on-demand
   path for free. A cancelled event, one with no recognizable appointment type (a
   calendar entry the atelier typed by hand), or one with no email is skipped, and
   an install with no Google key / no `POSTGRES_URL` reports **unconfigured**
   quietly rather than alerting the inbox nightly about a feature nobody turned on.

6. **Customer email only + best-effort**, from the **appointments** sender.
   Deliberately no atelier notification — the studio's calendar is already the day
   sheet. The manage link needs `SESSION_SECRET` + `PUBLIC_BASE_URL`; unset ⇒ it's
   omitted and the copy falls back to "reply to us", exactly like the confirmation
   email.

**Groundwork for SMS** (the roadmap's own later card, since the reminder is the
natural first text): the customer's **phone is now stamped on the event**
(`aptPhone`, written by `createCalendarEvent` — nothing reads it, but it's the one
piece that can't be retro-fitted onto bookings already taken, the same argument
that made `aptEmail` load-bearing later), the **marker is per-channel** from the
start (`aptRemindedEmail` / `aptRemindedSms`, so a new channel doesn't inherit the
email's history and find every booking already "reminded"), and the window, the due
test and the wording are transport-agnostic. What SMS still needs is a vendor and —
the real work — an **opt-in**: consent to be texted isn't the same permission as a
transactional email, `preferredContact` is a "how should we reach you" rather than
consent, and that belongs on the Client CRM next to the newsletter consent, not
bolted onto this sweep. See `.agents/memory/appointment-reminders.md`.

Known limits: an appointment the atelier types straight into Google is never
reminded about (the sweep only recognizes bookings this app made), and there is one
reminder per booking per start time — an additional "and again an hour before" would
need a second marker, which the per-channel key scheme extends to cleanly.

## Post-delivery reviews (capture, then publish)

Once a custom order reaches its **final (delivered) stage**, the tracking page
invites the customer to leave a review — a star rating, a short testimonial, an
optional credit name + publish consent, and photos of the finished piece. This
is the "delight is highest at delivery" moment, and the raw material for future
testimonials and the portfolio. `POST /api/orders/:n/reviews` (contract-first,
in the OpenAPI spec + generated client, unlike the raw upload/cron routes). Code:
`services/review.service.ts`, `routes/orders.ts`, `services/delivery.ts`,
`lib/notion/reviews.{blocks,repository}.ts`, and on the frontend
`components/review-dialog.tsx` (rendered by `components/custom-order-result.tsx`
only for delivered orders). Load-bearing decisions:
The **read** half — the testimonials the site shows — is `GET /api/reviews`, at the
bottom of this section.

1. **"Delivered" is positional, not a flag — don't hardcode a stage.** There is no
   "delivered" field on an order; `orderDelivered` (`services/delivery.ts`) treats the
   **last** stage in the live `fetchLiveOrderStages` list as delivered, exactly as
   `schedule.service.ts` does. The frontend recomputes the same test to decide whether
   to show the review affordance, so the two can't disagree. It **fails closed** (no
   review) when the stage is unknown or the list is empty — a review is a one-way action
   we'd rather withhold on a stale read. This is the mirror of `measurement-lock.ts`,
   which fails **open**; the difference is deliberate.

2. **Two gates, the same identity model as measurement-change.** The order must be
   delivered (else `ConflictError` → 409) and the supplied email must match the one on
   the order (`ForbiddenError` → 403); a legacy order with no stored email is accepted
   but flagged **`Email Verified = false`** for the atelier to vet before featuring it.
   The lookup reuses `findOrderVerification`.

3. **Reviews get their own database + the atelier curates.** Unlike the six contact-inbox
   writers, reviews land in a dedicated **"Reviews"** database
   (`NOTION_REVIEWS_DATABASE_ID`, required — the repository throws if unset). Each row
   carries `Rating` (number), `Review` (rich_text), `Customer Name`, `Order Number`,
   `Email`, `Consent to Publish` (checkbox), `Email Verified` (checkbox), a `Status`
   **select** defaulting to **"New"** (the atelier moves it to "Published" to feature
   it), and an optional best-effort `Client` relation to the CRM. Property names live in
   `reviews.blocks.ts`.

4. **Photos reuse the reference-image upload — no new service.** The browser uploads
   each photo through the same `POST /api/orders/reference-images` raw-bytes endpoint
   the order form uses (via the shared `ReferenceImageUpload` component +
   `lib/reference-images.ts`), collects the returned `file_upload` ids, and sends them
   as the review body's `photoIds`; `reviews.blocks.ts` attaches them as image blocks.

5. **Best-effort email + CRM.** A customer thank-you (and an atelier notification when
   `ATELIER_INBOX_EMAIL` is set) go out via Resend under the **orders** category; the
   Client CRM upsert links the review to the customer. A failure never fails the
   request — the Notion row is the source of truth.

The atelier must, one time: create the "Reviews" database with the properties
above, share the Notion integration with it, set `NOTION_REVIEWS_DATABASE_ID`,
and (optionally) add a `Client` relation to Client CRM. To feature a review, set its `Status` to
**"Published"** — the site picks it up within a minute (60s cache), or a few
minutes behind the edge cache.

### Showing the curated reviews (GET /reviews)

`GET /api/reviews` (contract-first) serves the testimonials rendered on the **home** and
**about** pages by `components/testimonials.tsx`. Code:
`getPublishedReviews` in `services/review.service.ts`, `routes/reviews.ts`,
`lib/notion/reviews.schema.ts` (the read-side mapping) + `listPublishedReviews` in
`lib/notion/reviews.repository.ts`.

1. **Two gates decide what is public, and both must pass.** A row is served only when
   its `Status` **select** is `REVIEW_STATUS_PUBLISHED` (`"Published"`, in
   `reviews.schema.ts`) **and** its `Consent to Publish` checkbox is ticked. Curation
   alone is not enough — the consent is the customer's, and the atelier moving a row
   along its triage flow can't stand in for it. Both gates are pushed into the Notion
   **filter** _and_ re-checked in the pure extractor, so neither layer alone can leak a
   review. Everything fails **closed**: an unset select or an absent property reads as
   "not public". `"Published"` is a **targeted business rule** naming one live Notion
   option value (like `STATUS_IN_STOCK` / `SIZE_GUIDE_TYPE_SOAKER`) — rename that option
   in Notion and it must change here too, or every testimonial silently vanishes.
   `Email Verified` is deliberately **not** a third gate: the atelier setting
   `Status = Published` _is_ the vetting step it was added for, so gating on it as well
   would hide a review the atelier had knowingly published.

2. **The response is a narrow projection.** `PublishedReview` carries only `id`,
   `rating`, `comment`, an optional `customerName`, and an optional `publishedAt` (the
   page's Notion `created_time`). The author's **email, order number, and
   `Email Verified` flag never leave the server** — they aren't in the contract and
   aren't mapped. A blank credit name is omitted rather than defaulted, and the frontend
   then renders the quote unattributed instead of inventing a byline.

3. **Degrade-safe in both directions, unlike the write.** `createReview` throws when
   `NOTION_REVIEWS_DATABASE_ID` is unset; `listPublishedReviews` returns `[]` instead —
   a marketing page must not 500 over a missing database id. The read is cached 60s with
   the usual **fall back to the cached list on error** (same as inventory/categories),
   and the route sets an edge `Cache-Control` (`s-maxage=300`) like `/products`, set only
   after the read resolves so an error is never cached. On the frontend the strip renders
   **nothing at all** while loading, on error, or with nothing published — no empty state
   and no skeleton, so the section is simply absent rather than advertising a hole.

4. **Review photos are not served here.** They live as image **blocks** on each review's
   Notion page, so reading them would mean a per-review blocks fetch. The testimonial
   strip is text + rating only; the photographs are the portfolio gallery's job.

5. **Curating happens on the studio dashboard, with the Notion views as a second
   surface.** See "Moderating reviews on the studio dashboard" below for the queue;
   the Reviews database also keeps its **Curate** board (grouped by `Status`) plus
   three filtered tables — **Live on the site**, **Awaiting curation**, and
   **Published but not showing** — and an **`On the Website`** formula that renders
   the two gates per row. Both surfaces write the same `Status` select, so neither is
   authoritative over the other. See "Curating which reviews show" below and
   `.agents/memory/reviews-curation-views.md`.

### Curating which reviews show (Notion views)

Selecting a testimonial is normally a **dashboard action** now (see the section
below), but the same `Status` select can be flipped in Notion — the atelier drags a
card from **New** to **Published** on the **Curate** board; the site picks it up
within a minute (60s repository cache), or a few minutes behind the edge cache. The
views below still earn their place: they are the only surface that shows the whole
history, and "Published but not showing" is still the only place a consent-blocked
row is visible.

| View                           | What it answers                                  |
| ------------------------------ | ------------------------------------------------ |
| **Curate** (board by `Status`) | The selection surface — drag New → Published     |
| **Live on the site**           | Exactly what `GET /api/reviews` serves right now |
| **Awaiting curation**          | The inbox: everything still at `Status = New`    |
| **Published but not showing**  | Published, but the customer never consented      |
| **All reviews**                | Everything, `On the Website` first               |

Three things about this are load-bearing:

- **"Published but not showing" surfaces an otherwise silent state.** Because the app
  requires **both** gates, a review the atelier published whose `Consent to Publish`
  is unticked appears nowhere and raises nothing — no error, no log, no empty state.
  That view is the only place it is visible. Don't delete it as redundant.
- **The `On the Website` formula mirrors the code; it is not the source.** It reads
  `Status` + `Consent to Publish` and renders "✅ Live on the site" / "⛔ No consent —
  hidden" / "◽ Awaiting curation" / "◽ Not published". The app **never reads it**.
  Rename the `"Published"` option and you must update `REVIEW_STATUS_PUBLISHED` **and**
  the formula, or the column starts lying.
- **The view sort does not affect the site.** Views sort by `Rating` for the atelier's
  benefit; the site's order is always newest-first, fixed in `listPublishedReviews`.
  Ordering and count are deliberately not atelier-editable — both would need a new
  property and a read path, not a view.

`Status` also has an **`Archived`** option that predates the app. It isn't
`"Published"`, so archiving is how a testimonial is retired from the site — and the
moderation queue reads it as a decision already taken (`REVIEW_SET_ASIDE_STATUSES`
in `reviews.schema.ts`), so the archive doesn't reappear as a backlog.

The workspace briefly had a **second** "Reviews" database — a stale `⭐ Reviews` under
`website`, an abandoned earlier design (a `Published` checkbox rather than a `Status`
select) that nothing in the app read. It was **deleted in August 2026** once confirmed
empty. If one named "Reviews" ever reappears outside **orders**, it is not the app's:
`NOTION_REVIEWS_DATABASE_ID` is the only source of truth. See
`.agents/memory/reviews-curation-views.md`.

### Moderating reviews on the studio dashboard

A review lands with `Status = New` and, until this, could only be promoted by
opening Notion — so the app **wrote** reviews and never read them back. The
dashboard's **Reviews** panel is that read path and the decision in one place:
`GET /api/studio/reviews` for the queue, `PUT /api/studio/reviews/:id/status`
for one decision. Both are contract-first and behind the same `requireStaff`
gate as the rest of the studio surface. Code:
`services/studio-reviews.service.ts`, the two handlers in `routes/studio.ts`,
the moderation half of `lib/notion/reviews.{schema,repository}.ts`, and
`web-app/src/components/studio-reviews.tsx` (rendered by `pages/studio.tsx`).

1. **The three states are DERIVED from `Status`, not enumerated from it.**
   `published` is `"Published"`; `rejected` is `"Rejected"` (what the app writes)
   **or** the pre-existing `"Archived"` (`REVIEW_SET_ASIDE_STATUSES`, so the
   archive isn't reopened as a backlog); **everything else — `"New"`, a blank
   select, or a value the atelier invented — is `pending`**. That direction is
   load-bearing: an unrecognized status asks for a decision rather than standing
   in for one, so a Notion rename produces a queue that reappears, never a
   testimonial published without curation. The queue read is therefore
   **unfiltered** — a filter would have to enumerate what counts as pending, and
   an invented status would then never surface at all.

2. **Publishing without the customer's consent is refused, not written.** The
   site requires **both** gates (see above), so writing `Published` on a row with
   `Consent to Publish` unticked is a decision that looks taken and does nothing.
   The service reads the review first and throws a `ConflictError` → **409**; the
   panel replaces the Publish button with the reason, so the refusal is visible
   before the press. Setting such a review aside is still allowed.

3. **Every decision is undoable, and `pending` writes the capture default.**
   `pending` / `published` / `rejected` map to `"New"` / `"Published"` /
   `"Rejected"` (`MODERATION_STATUS_VALUES`), so sending a review back to the
   queue leaves the row exactly as a freshly submitted one. A `PUT` because the
   whole state is sent and re-sending it changes nothing.

4. **Photos are read from the page body, for the pending rows only.** A review's
   photographs are image **blocks**, not a property, so each one costs a separate
   Notion request (`listReviewPhotos`). A decision is made on the pending rows,
   so only those are fetched — capped at `MODERATION_PHOTO_LIMIT` (20) with a
   concurrency of 3 — and a failure degrades that review to its words rather than
   failing the queue. The URLs are **Notion-signed and short-lived** (about an
   hour), which is why they are fetched per page load and never stored.

5. **The read is one Notion page and says when it was cut short.** 100 rows,
   newest first, no pagination; `truncated` rides the response and the panel says
   the list is partial rather than looking complete. The decided list is capped
   at `DECIDED_REVIEW_LIMIT` (12) and carries no photos — it is a record, not a
   second queue. The pending list is ordered **oldest first**: the review that
   has waited longest is the one that owes an answer.

6. **A decision busts the published cache.** `setReviewStatus` clears the
   `listPublishedReviews` cache, so a newly published testimonial isn't a minute
   behind on the site (the edge cache still applies).

No new env vars and no atelier setup: it reads and writes the same Reviews
database and the same `Status` select the Notion views use. The `"Rejected"`
option auto-creates on first write. Deliberately **not** built: any customer
email on a moderation decision — publishing a testimonial the customer already
consented to needs no notification.

## Rush order surcharge

A custom order whose **needed-by date is sooner than the studio's standard lead time**
is a **rush order** and carries a surcharge. The intake form detects this off the
existing "Needed By" date, discloses the surcharge, requires the customer to
**acknowledge** it before the order can be placed, and records a rush flag.

1. **The fee is priced server-side, as one more invoice line written to Notion.** When
   the atelier presses the invoice-line-item generator for a rush order, it appends a
   **"Surcharge"** line (`Line Type = "Surcharge"`) priced at `RUSH_SURCHARGE_RATE`
   (default **15%**) of the itemized garment subtotal (materials + labor + the
   reconciling adjustment, i.e. the costing's Suggested Price). Pricing the fee
   server-side but **writing it to Notion** is what keeps the "the invoice is the source
   of truth for money" rule intact — the app never invents a total that diverges from
   Notion's `Final Balance`. The line flows into the balance like any other
   (`buildInvoiceView` sums all non-`Deposit` lines) and renders under its own
   "Surcharge" heading (`lib/invoice-format.ts` — ordered last, after Adjustments). The
   generator never links a costing item on it, and it's covered by the same idempotency
   guard. Code: `services/rush.ts` + `services/invoice-generator.service.ts`.

2. **Rush is derived from the date + an explicit acknowledgement.** `isRushNeededBy`
   (`web-app/src/lib/rush.ts`) is true when the needed-by date falls within
   `RUSH_WINDOW_DAYS` of today. The form then shows the surcharge notice and a required
   acknowledgement checkbox (a `superRefine` blocks submit until it's ticked) and sends
   `rush: true`. Both the date and the disclosure live on the intake's **last** step, so
   the surcharge is the last thing the customer reads before placing the order rather
   than a mid-form interruption. A standard-timeline date sends no `rush` field.
   `NewOrderRequest.rush` is part of the OpenAPI contract.

3. **Recorded as a flag, two ways.** `buildOrderProperties` sets a **`Rush Order`
   checkbox** (filterable in Notion) and `buildOrderPageBlocks` adds a "Rush Order: Yes"
   body note, both only when `rush` is true (`ORDER_RUSH_PROPERTY` in
   `orders.schema.ts`). The app reads neither back — they're an atelier signal, like the
   Due Date.

Three knobs, all with defaults — keep the frontend disclosure and the server rate in
step. Frontend (build-time Vite env): `VITE_RUSH_WINDOW_DAYS` (default `21`) and
`VITE_RUSH_SURCHARGE_NOTE` (default `"a 15% rush surcharge"`), read in
`web-app/src/lib/rush.ts`. Server: `RUSH_SURCHARGE_RATE` (default `0.15`, read at call
time; `0` disables the surcharge line). No atelier setup beyond the **`Rush Order`
checkbox** on Custom Orders — the generator writes the `Surcharge` `Line Type` option,
which Notion auto-creates on first write.

## Color selector (intake)

The custom-order intake form (`pages/order-form.tsx`) lets the customer **pick the
colors they're picturing** from the studio palette (a flat multi-select) and
**describe how they'd like them used** — deliberately a _starting point for the
consultation_, not a fabric spec. Exact fabric + finish (and any bodice-vs-skirt
split) are settled with the atelier later, so intake stays light. This is a
deliberately small, primary-color palette — an earlier, clunkier version pulled a
whole Notion "Fabrics" database of typed swatches (fabric-type groups, bodice/skirt
placement, group-by toggle, swatch images); that stack was removed. Load-bearing
decisions:

1. **The palette is one Studio Settings value, not a database.** Because it's a
   small, rarely-changed list, it lives as a single atelier-editable **`COLOR_PALETTE`**
   Studio Settings row rather than its own Notion database — the same **Notion → env →
   default** resolution as `rushSurchargeRate()`. `intakeColorPalette()`
   (`services/colors.ts`) reads `settingValue("COLOR_PALETTE") ?? process.env
.COLOR_PALETTE`, parsed by `parseColorPalette` from a human-editable
   `Name #hex, Name #hex, …` string, and falls back to a **built-in primary palette**
   (`DEFAULT_PRIMARY_PALETTE` — Red, Orange, Yellow, …) so the picker always works with
   zero setup. Malformed entries (bad/missing hex) are skipped and duplicate slugs
   dropped, so a mis-typed value degrades gracefully. `GET /api/colors`
   (`routes/colors.ts`) serves it (a cheap read off the primed settings snapshot, with a
   short edge cache). Contract-first: `/colors` + `Color`/`ColorList` in `openapi.yaml`,
   so `useGetColors` is generated. `Color` is just `{ id, name, hex }` (id = slug of the
   name).

2. **Always non-empty + degrade-safe.** The palette is never empty (the default
   backs it), so the picker always renders. If the `/colors` fetch itself errors, the
   chips just don't render and the customer still describes what they want in the
   free-text usage note — the order form still submits.

3. **Flat multi-select, controlled.** `ColorPicker` (`components/color-picker.tsx`)
   is a controlled, form-agnostic grid of `<button>` pill chips (the shadcn set has no
   checkbox/toggle), each a hex-fill dot + the color name. Clicking toggles the color
   name in/out of the selection. The form drives it via `setValue("colors", …)` and
   pairs it with a registered `colorUsage` textarea. The order body carries a flat
   `colors: string[]` (picked names) + `colorUsage` (string), both optional
   (contract-first on `NewOrderRequest`). Custom prints / fabric photos fold into the
   existing **Reference Images** upload, alongside it on the design step (no separate
   uploader).

4. **Recorded on the order (write-only).** `orders.blocks.ts` writes the picks as a
   **`Colors` multi_select** (the picked names — filterable in Notion) + a **`Color
Usage` rich_text**, and mirrors both as readable **page-body blocks** in the
   Costume Details section. The app **never reads these back** — they're an atelier
   signal. Property-name constants (`ORDER_COLORS_PROPERTY`,
   `ORDER_COLOR_USAGE_PROPERTY`) live in `orders.schema.ts`.

The color picker opens the second page of the three-step intake flow (step 1 = "Your
details", step 2 = "Your design" — colors + costume details, step 3 = "Timeline" +
submit); see `order-form.tsx` (`STEPS` / `STEP_FIELDS`, the step gating). The
atelier's one-time setup is **nothing** — the built-in primary palette works out of
the box. To customize, add a **`COLOR_PALETTE`** row to the "Studio Settings"
database with a `Value` like `Emerald #0B6E4F, Rose Gold #C5878C, Navy #1F2A44` (or
set the `COLOR_PALETTE` env var); and add a **`Colors` (multi_select)** + **`Color Usage`
(rich_text)** property to the **Order Tracking Pipeline** database for the write-back.
Code: `openapi.yaml` (`/colors` + `Color`/`ColorList` + `colors`/`colorUsage` on
`NewOrderRequest`), `services/colors.ts` + `routes/colors.ts`, `orders.{schema,blocks}.ts`
(write-back), and `web-app/src/components/color-picker.tsx` + `pages/order-form.tsx`.

## An order form per service

The Services page advertises four services — **bespoke commissions**, **fittings &
alterations**, **rhinestoning & embellishment**, **repairs & restoration** — and for a
long time all four funnelled into one intake that asked every customer for five body
measurements and a colour palette. The service is now picked on the intake's **first
step** and decides what the rest of the form asks for, exactly as the appointment
catalog varies what a booking requires by type. Code:
`api-server/src/lib/service-catalog.ts` (the catalog), `routes/services.ts`
(`GET /services`), `enforceServiceGate` in `services/orders.service.ts` (the gate), and
on the frontend `web-app/src/lib/order-services.ts` + `pages/order-form.tsx` +
the per-card links on `pages/services.tsx`. Load-bearing decisions:

1. **The catalog is a targeted business rule in code, and it is SERVED rather than
   duplicated.** Like `lib/appointments/catalog.ts` (and `STATUS_IN_STOCK` /
   `MEASUREMENT_LOCK_FROM_STAGE`), it is code, not a live Notion read — each entry's
   flags drive slot-like decisions coupled to the form and the server. But both sides
   need it: the form decides which sections to render, and `POST /orders` decides what
   to require. So `GET /services` (contract-first, `useGetServices`) serves the one
   definition, the way `GET /appointments/options` surfaces each booking type's
   `requiresOrder` / `requiresProjectDetails`. A repair the form stops asking
   measurements for is a repair the server stops requiring them from, because there is
   only one place that says so. The ids (`bespoke`, `alterations`, `rhinestoning`,
   `repairs`) are what deep links and stored orders carry, so renaming one is breaking;
   renaming a `name` is not.

2. **Two flags are gates, mirroring `enforceBookingGate`.** `measurements` decides
   whether the five body measurements are asked for at all — **only a bespoke
   commission sets it**, because an alteration, a stoning job, or a repair is measured
   on the piece itself, in person. `detailsRequired` makes the order's existing
   free-text `description` **required** for the three services worked on a garment the
   customer already owns, where that text _is_ the brief; a commission's design notes
   stay optional (the design is settled at consultation). It deliberately **reuses
   `description`** rather than adding a field: same Notion property, same email row,
   nothing to keep in step — only the label, prompt, and requiredness vary, and those
   come from the catalog entry (`detailsLabel` / `detailsHelp`).

3. **An absent or unknown `service` resolves to the bespoke commission.**
   `NewOrderRequest.service` is **optional** in the contract, and `resolveOrderService`
   falls back to the first catalog entry — so a client that predates the catalog, or a
   deep link naming a service since retired, keeps the widest form and the exact gate
   it always had rather than silently losing one. The frontend fallback is the same
   shape (`SERVICE_FALLBACK` in `lib/order-services.ts`): while `GET /services` is in
   flight, or if it errors, the picker is hidden, nothing is required of it, and the
   form is the full commission intake it was before services existed. Degrading to the
   _widest_ form is the safe direction — a customer is never blocked behind a choice
   the page can't offer, and never has a gate quietly dropped.

4. **The catalog also owns the atelier- and customer-facing wording — server-side
   only.** `orderLabel` names the piece in the Notion page title (`Ada – Repair`, and
   still `Ada – Custom Costume` for a commission) and `emailIntro` is the confirmation
   email's opening line, because "the journey from measurements to finished garment"
   is nonsense for a repair. Neither is on the contract: `getServiceOptions()` strips
   them, so the form is served only what it renders.

5. **The order records which service it is.** `buildOrderProperties` writes a
   **`Service` select** (`ORDER_SERVICE_PROPERTY`) plus a page-body line, so the
   atelier can filter the pipeline by the kind of work — and, crucially, tell an order
   with no measurements apart from an incomplete one. Write-only: the app never reads
   it back, because the **catalog**, not the order, is the authority on what a service
   needs. Missing property ⇒ dropped by `createPageDroppingUnknownProperties` with a
   pointed warn, like every other additive intake property. The emails carry a
   `Service` row and **omit the measurements row entirely** for a service that never
   asked, rather than printing blanks or promising a fitting nobody arranged.

6. **Each Services-page card starts its own intake.** `/order?service=<id>` preselects
   the service once the catalog loads, mirroring `/appointments?type=<id>`; an
   unrecognized id lands the customer on the picker rather than on a silently wrong
   form. This is what closes the roadmap card's actual complaint — three of the four
   advertised services had no intake that fitted them.

**Atelier setup (optional, additive):** add a **`Service`** (select) property to the
**Order Tracking Pipeline** database. Notion auto-creates the options on first write;
until the property exists the field is dropped and the value still appears in the page
body. Nothing else — no env var, and the catalog is a deploy-time change.

## What the intake records (order form -> Notion + email parity)

Everything the three-step intake asks for reaches all three destinations: the
**Notion order page** (typed properties + readable body blocks), the **customer's
confirmation email**, and the **atelier's notification email**. The form has grown
field by field (colors, the rush acknowledgement, the referral code, the
measure-at-a-fitting option) and each addition used to have to be remembered in
four places. Three things keep them in step:

1. **One shared field list backs both emails.** `orderDetailFields`
   (`lib/resend/emails.ts`) maps a `CreateOrderInput` to the label/value rows for
   the piece itself — the service, measurements, colors, colour usage, the brief,
   reference-image count, needed-by, rush, referral code — and **both** `orderConfirmationEmail`
   and `orderNotificationEmail` render it. The notification prepends the contact
   rows; the confirmation wraps it in "Here's what we have on file" and invites a
   reply to correct it. A field added to the intake is added once, here. Every row
   but the measurements is omitted when blank, so neither email renders an empty
   label.

2. **Measurements are one of two states, never blanks — or absent entirely.** For a
   service that asks for them, the intake offers either the five values or "take them
   at an appointment" (`submitOrder` rejects a body with neither), so
   `measurementsLine` renders the appointment note rather than the five `undefined`s
   the notification email used to print for those orders. For a service that doesn't
   (alterations, rhinestoning, repairs — see "An order form per service"), the row is
   omitted from both emails and the section from the Notion page body.

3. **A property the atelier hasn't added yet degrades; it doesn't fail intake.**
   Notion rejects a page create that names a property the database lacks — the
   **whole** page, not the field — so each additive property here was a live
   footgun. `createPageDroppingUnknownProperties`
   (`lib/notion/orders.repository.ts`) parses that 400, drops the offending
   property, and retries (bounded, and only for a property we actually sent, so an
   unrelated 400 still throws). The order is recorded without that one field, the
   page body still carries the value as text, and a `warn` names the property to
   add. This is the same "degrade with a pointed warn" contract as the
   payment-reminder pass.

**Atelier setup (optional, additive).** The write-back properties on **Order
Tracking Pipeline**, beyond the ones the earlier sections list (`Due Date`,
`Rush Order`, the five measurement numbers + `Measurement Unit`, `Colors`,
`Color Usage`, `Service`): **`Preferred Contact`** (select — `email` / `phone` / `text`),
**`Measurement Appointment`** (checkbox — the orders still waiting to be measured,
so they can be a view), and **`Referral Code`** (rich_text — what the customer
typed, kept even when it resolved to nothing; the reward engine's own state lives
on the Client CRM). Missing ⇒ that field is dropped per point 3 and still appears
in the page body. Property names live in `orders.schema.ts`.

## Referral & returning-skater rewards

Every customer gets a shareable **referral code**; when a skater they refer places
their first order, the referrer earns a **credit** and the new skater got a **welcome
discount** — and any repeat customer earns a **standing discount**. All three are
delivered as **Stripe promotion codes** redeemed in the checkout promo box
(`allow_promotion_codes: true` is on every Checkout path). Reward state lives on the
**email-keyed Client CRM** row — **no new database**. Code:
`services/rewards.service.ts` (the engine), `lib/stripe/promotions.ts`
(`createDiscountCode`), and the reward reads/writes in
`lib/notion/clients.repository.ts`.

1. **Two mechanics, one engine, driven from the paid-order moment.** There is no
   Notion→app trigger, but every moment that matters runs in-app: an order is _placed_
   via `POST /orders` (`submitOrder`) and _paid_ via the Stripe webhook
   (`recordPaidOrder` / `recordPayment`). `submitOrder` calls `captureReferralOnOrder`
   (stamp the referrer link + email the new skater their welcome code); the two webhook
   recorders call `runPaidOrderRewards(email, orderNumber)` at their tails, issuing the
   **referrer credit** (only once the referred order is paid — anti-abuse) and the
   **returning-skater standing discount**.

2. **Everything is best-effort + CRM/Stripe-optional.** A reward failure must never fail
   an order or 500 the webhook (a throw into the webhook makes Stripe retry, and the
   retry early-returns at the dedupe guard, so the reward would be lost) — every entry
   point is `try/catch` + `logger.warn`. When `NOTION_CLIENT_CRM_DATABASE_ID` is unset
   (or Stripe isn't configured) every reward path no-ops.

3. **Idempotency is layered.** A CRM checkbox is the fast guard — `Referral Rewarded`
   (credit once per referred customer) and `Returning Reward Issued` (standing code
   once) — backed by Stripe's globally-unique promo `code` + a per-reward
   `idempotencyKey` (`createDiscountCode` treats `resource_already_exists` as success).
   The returning trigger keys off **`First Paid Order`** (a rich*text holding the
   customer's first paid order \_number*), not a boolean: a webhook retry or a later
   payment stage of the _same_ order carries the same number and can't fire the reward —
   only a genuinely different second order does.

4. **Two-sided referral, self/abuse-guarded.** `captureReferralOnOrder` resolves the
   code to a referrer (`findClientByReferralCode`), rejects a self-referral and an
   unknown code, skips an already-captured customer, then stamps `Referred By Email` and
   issues the welcome code. The **referrer's** credit is a fixed `$` amount (with a
   `minimum_amount` restriction so a large single-use credit isn't burned on a tiny
   order); the welcome + returning codes are **percentages** (no currency mismatch with
   the USD checkouts). The referral **capture** surface is custom-order-only
   (`NewOrderRequest.referralCode`); the returning discount and the referrer's own
   redemption work on any checkout.

5. **Surfaced in the account portal.** `getAccountOverview` calls `ensureReferralCode`
   (best-effort), which generates a deterministic short code on first view and returns
   `AccountOverview.referral` (`{ code, creditAmount, returningCode? }`);
   `pages/account.tsx` renders a "Refer a friend" card with copy-to-clipboard. Absent
   when the CRM is off.

6. **Amounts are Studio-Settings tunables** (Notion → env → default):
   `REFERRAL_CREDIT_AMOUNT` (40), `REFERRAL_WELCOME_PERCENT` (10),
   `RETURNING_DISCOUNT_PERCENT` (10), `REWARD_CODE_EXPIRES_DAYS` (90).

One-time setup: **seven properties on the Client CRM** database (no new database, no new
env var, no Stripe Dashboard setup — codes are created programmatically):
`Referral Code`, `Referred By Email`, `Referral Rewarded` (checkbox),
`First Paid Order`, `Returning Reward Issued` (checkbox), `Referral Credit Code`,
`Returning Discount Code`.

## Order status-change emails (Notion automation → webhook)

When a custom order advances to a new production stage, the customer gets an email
with a **pipeline graphic** — a simplified inline-HTML version of the on-site tracking
timeline. The stage change happens **inside Notion** and there's no Notion→app trigger,
so this is driven by a **Notion database automation** rather than a request or a cron.

1. **Trigger is a Notion automation, not a poll.** The atelier adds a database
   automation on the Order Tracking Pipeline — _when `Stage` changes_ → _send webhook_
   to `POST /api/webhooks/notion-stage-change`. **No hand-authored body is needed**:
   Notion's default payload carries the triggering page under `data.id`, and the route
   resolves the order off that page id (newer Notion often exposes only headers + a
   fixed payload, no editable body). An authored body `{ "orderNumber": … }` (or
   `?order=`) is still accepted and preferred when present. The POST is mounted with
   `express.raw` (before the JSON parser, like the Stripe webhook) and JSON-parses the
   buffer itself, so the body is read regardless of Content-Type — Notion's webhook
   action sets the Content-Type and won't let you override it.

   Auth reuses `CRON_SECRET`, two ways: an **`Authorization: Bearer <CRON_SECRET>`
   header** (preferred — the automation supports custom headers, keeping the token out
   of URLs and logs) **or** a `?secret=<CRON_SECRET>` query token (the fallback the
   browser `/run` link uses). Both this and `…/run` are **outside the OpenAPI
   contract**, mounted directly in `app.ts`.

2. **Re-fetch, don't trust the payload.** The webhook carries only an identifier; the
   server reads the order back from Notion — `findOrderForStageNotification` (by number)
   or `findOrderForStageNotificationByPageId` (by `data.id`), both like
   `findOrderByNumber` but including the customer `Email` — and renders the email from
   the live `Stage` + live stage list. The send is **best-effort** from the **orders**
   sender: a Resend failure is logged-and-swallowed and never turns the webhook into an
   error. A missing email or unset stage is a graceful skip.

3. **Forward-only, via a `Last Notified Stage` marker.** The email sends only when the
   order has moved **forward** past the stage the customer was last emailed about. The
   Notion payload doesn't carry the _previous_ stage (and an automation condition can't
   compare status ordering), so the server keeps a `Last Notified Stage` **rich_text**
   property on the order: read the marker, send only when the current stage is strictly
   ahead of it in the live pipeline, then advance the marker. A **backward** edit (a
   correction/rework) or a **re-fire** of the same stage is skipped, so double-fires are
   deduped for free. The marker is a **high-water mark** (it only ever advances), so
   re-traversing already-notified stages after a rework doesn't re-email. An empty marker
   counts as forward, so the first genuine change emails. The gate is the pure
   `isForwardStageChange` (`order-notification.service.ts`); the marker write is
   best-effort (a write hiccup at worst risks one duplicate on a later double-fire, never
   a wrong-direction email).

4. **On-demand send, test trigger, and fallback to the automation — all one tool.**
   The studio dashboard's **Send a status update** (`POST
/api/studio/tools/status-email` with `{ orderNumber, force? }`) runs the same send
   by hand. Three jobs in one place: it's how the atelier **tests in production**
   (run it against one test order of their own and no customer is touched, because
   no automation is firing for real orders until it's wired up); it's the manual
   "notify now" — tick **resend anyway** (`force: true`) to send even when the order
   hasn't moved forward, and a forced resend never rewinds the high-water marker;
   and because it's forward-only like everything else (running it again at the same
   stage does nothing), it's a reliable **alternative to the automation entirely**
   when that can't be used — e.g. a Notion plan without webhook actions. The
   automation itself never forces.

   This replaced a `Send Status Update` **formula property** on the Order Tracking
   Pipeline that built a `…/notion-stage-change/run?secret=<CRON_SECRET>&order=` URL
   per row. That property (and the `…/run` route) is gone; delete it in Notion —
   see "Internal tools on the studio dashboard".

No new env vars (it reuses `CRON_SECRET`, `RESEND_FROM_EMAIL` via
`fromAddress("orders")`, and `PUBLIC_BASE_URL` for the tracking link, omitted when
unset). One-time setup: the Notion automation above **plus** a **`Last Notified Stage`**
(rich_text) property on the Order Tracking Pipeline (the app writes it; leave it empty).
The per-stage description text in the email mirrors
`web-app/src/lib/stage-descriptions.ts` (cosmetic, with a graceful fallback for unknown
stages). Code: `orderStageChangeEmail` in `lib/resend/emails.ts`,
`findOrderForStageNotification` / `findOrderForStageNotificationByPageId` +
`updateLastNotifiedStage` in `lib/notion/orders.repository.ts`,
`services/order-notification.service.ts`, `routes/order-notification.ts`.

## Materials restock alerts (dashboard panel + a weekly digest)

The atelier's **"materials inventory"** Notion database has carried a reorder
point (`Minimum Stock`), a `Stock on Hand` formula and a `Restock Alert` formula
per material since long before the app existed — and the app had never read that
database, so the alerts only existed for whoever thought to open it mid-project.
This surfaces them in two places: the studio dashboard's **Materials** panel
(`GET /api/studio/materials`) and a **weekly digest email** to the atelier. Code:
`lib/notion/materials.{schema,repository}.ts`, `getMaterialsNotionClient`,
`services/materials.service.ts` (the pure `classifyMaterials` + the cached
use-case), `services/materials-digest.service.ts`, the `/studio/materials` route,
and `web-app/src/components/studio-materials.tsx`. Load-bearing decisions:

1. **`Restock Alerts On/Off` is a SUPPRESSION checkbox, despite its name.** Its
   Notion description is explicit — "Check this to suppress restock alerts for
   fabrics or materials that do not need restocking" — and the data agrees (8 of
   the 9 rows carrying a reorder point are unticked). The constant is
   `MATERIAL_ALERTS_SUPPRESSED_PROPERTY`, named for what it does rather than what
   it is called, because reading it the other way inverts the whole panel.

2. **The trip is re-derived in code, not read off the `Restock Alert` formula.**
   Two reasons, and the first is a repo-wide gotcha: a `formula: {…}` **filter**
   on a formula derived from rollups 400s through the Notion API ("Unable to
   filter based on a formula of unknown type") — the same wall
   `Milestone Status` hit (`.agents/memory/phase2-workspace-cards.md`). The
   second is that the formula's rendered value is display wording the atelier can
   restyle, so matching on it would be a string compare against a promise nobody
   made. Deriving `stockOnHand <= minimumStock` also yields the **`shortfall`**
   the panel and the digest rank by. The cost is a duplicated rule: **change what
   counts as low in the Notion formula and it must change in
   `materials.service.ts` too** — a targeted business rule, like
   `STATUS_IN_STOCK`.

3. **Unknown stock is never an alert; absent is not zero.** `Stock on Hand` is a
   formula over two rollups and is genuinely absent on a material with no intake
   lines. "We have none" and "we have never counted" are different claims, and
   only one is a reason to reorder — so such a row is reported as `untracked`
   with `reason: "stock-unknown"` rather than shouted about.

4. **The untracked list is the point, not a footnote.** Only **9 of 50**
   materials currently carry a `Minimum Stock`, so a strict alert list would look
   reassuringly empty while saying nothing about the other 41. Those are listed
   separately (collapsed, alphabetical) with the stock they do have, which is
   what the atelier needs to pick a threshold. A **muted** material is in neither
   list and only **counted**, so the numbers still add up.

5. **The digest reports STATE, which is what makes it idempotent.** It rides the
   nightly reconciliation (`sendDueMaterialsDigest`, a sixth pass) and fires only
   on `MATERIALS_DIGEST_WEEKDAY`, read in the studio timezone so "Monday" means
   the atelier's Monday. Because it lists what is _currently_ low rather than
   announcing a material _becoming_ low, running it twice says the same true
   thing — so unlike the back-in-stock sweep it needs **no sent-marker store and
   no Postgres table**. It sends **nothing** when nothing is low (a weekly "all
   good" trains you to ignore the sender) and self-gates on the atelier inbox.
   Accepted limit: the weekday check is the whole guard, so a double-fire of the
   cron on digest day would send two copies — an internal email, and cheaper than
   a marker store for a message that is safe to repeat.

6. **Read-only, degrade-safe, and cached like every other live Notion read.**
   The app never writes materials stock. `listMaterials` is a bounded
   `scanDatabase` (nothing to filter on — the panel wants the whole book) with the
   usual 60s TTL + fall-back-to-stale-on-error, so a Notion blip degrades to
   slightly stale numbers rather than an empty shopping list. An unset
   `NOTION_MATERIALS_DATABASE_ID` returns `configured: false` with empty lists and
   the panel **says so** — never an empty list that reads as "all good". A Notion
   **404** (the id is set but the integration was never shared with the database,
   or the id is wrong) degrades the same way, flagged `unreachable: true` with the
   sharing fix in the panel: it is the same kind of state as an unset id — one only
   a human can clear — so 500-ing the panel and alerting the inbox on every
   dashboard load was the wrong shape. Any **other** status still throws (an outage
   clears itself and is worth the one alert). The 404 is told apart by
   `NotionRequestError` (`lib/notion/errors.ts`), which `scanDatabase` now throws
   with the database's label, its id, and Notion's own `code`/`message` — "Notion
   query failed with status 404" alone named neither the database nor the fix.

The atelier's one-time setup: share the Notion integration with **materials
inventory** and set **`NOTION_MATERIALS_DATABASE_ID`**. Nothing to add in Notion —
`Item Name`, `Category`, `Minimum Stock`, `Stock on Hand`, `Restock Alerts On/Off`,
`Material Link` and `Price per Unit` all already exist. To make the panel useful,
set a `Minimum Stock` on the materials worth watching.

## Back-in-stock alerts (nightly sweep + a studio tool)

`POST /api/notify` captures a "tell me when this returns" request and acknowledges it,
but for a long time nothing closed the loop. It now does: when a piece is back in stock,
everyone waiting on it is emailed. The notable thing about the design is what it does
**not** need — **no Notion automation, no webhook, and no property added to any Notion
database.** A restock is an edit inside Notion with nothing to hang a trigger off, so
rather than asking the atelier to wire one, this runs on the two triggers the app
already owns.

1. **Two triggers, one sweep.** `notifyRestock` (`services/restock-notification.service.ts`)
   is called by the **nightly reconciliation cron** (`sendDueRestockAlerts` in
   `services/schedule.service.ts`, alongside the fitting- and payment-reminder passes)
   and by the studio dashboard's **"Send back-in-stock alerts"** tool
   (`POST /api/studio/tools/restock-alert`, `requireStaff`), for going out the same day
   a piece is restocked rather than waiting for the night. It is a **sweep**, not a
   per-row handler: it reads live inventory, takes every piece currently available, and
   answers the requests waiting on them. The tool's optional `item` only **narrows which
   pieces are considered** — blank sweeps everything, which is exactly what the cron does.

2. **Availability is read, never asserted.** No caller ever says "this is in stock"; the
   sweep reads inventory and decides. It reads it **fresh** — `listVariants(client,
{ fresh: true })` bypasses the shop's 60s cache read (still refreshing it), because a
   cached read could report a piece sold out for up to a minute after the atelier
   restocked it, which on a manual run reads as the feature being broken. A piece that
   isn't published (`Show on website`) has no shop page to send anyone to, so it never
   appears in the sweep at all.

3. **Matching is by the inventory row's own name, and per-size.** A request stores
   `Item` = the variant's `Item Name` (the shop passes `variant.name` into the notify
   dialog), so `findPendingBackInStockRequests` reads every `Request type = "Back in
stock"` row (through the bounded `scanDatabase`) and the sweep groups them by that
   text. Consequence: **renaming an inventory item orphans requests filed under the old
   name.** The per-request gate is the pure `restockSatisfiesRequest`
   (`services/restock.ts`): a request with no size is answered by the piece returning; a
   request naming a size is answered only when **that band** is back (`Sizes Available`);
   a row that tracks no bands can only be answered whole. It **fails closed** — a band
   that has since been dropped doesn't count — because a wrong "it's back!" sends a
   customer to a sold-out page, while a missed one leaves the request in the queue.

4. **"Already told" is an app-owned fact in Postgres, not a Notion checkbox.** The
   `restock_alerts` table (`supabase/migrations/0003_restock_alerts.sql`,
   `lib/db/restock-alerts.repository.ts`) holds one row per answered request, keyed on
   the request's Notion **page id** — so someone who asked about two sizes is answered
   about each. `claimRestockAlert` is `insert … on conflict do nothing`, the same atomic
   claim `processed_payments` uses, so the nightly sweep and a dashboard press can
   overlap without double-emailing. Unlike a payment there is **no confirm/release
   cycle**: the worst case of a claim that never leads to a send is one lost alert, and
   that is the safe direction. Consequently a claim **error** is treated as "not
   claimed" and the send is skipped — an unrecorded alert would repeat on the next run.
   Keeping this out of Notion is what removes the last setup step, and it can't be
   un-ticked by hand into a second email. A request the restock doesn't answer is
   deliberately **never claimed**, so it stays in the queue.

5. **`POSTGRES_URL` is the one hard requirement, and it fails loudly.** Everywhere else
   the Postgres layer degrades to the pre-Postgres behavior; here there is no such
   fallback, because without somewhere to record who has been told a nightly sweep would
   email the same people every night. Unset ⇒ the sweep no-ops with a `warn`, and the
   studio tool reports **`attention`** (not `noop`) with what to fix — nothing will ever
   send until it is.

6. **Customer email only + best-effort.** It sends from the **orders** sender
   (`fromAddress("orders")`, the same category as the request acknowledgement) and a
   Resend failure is logged-and-swallowed. Deliberately **no** internal atelier
   notification — the run reports what it did to whoever started it (the cron's JSON, or
   the dashboard's result panel, which breaks the count down per piece). The email's shop
   button uses `PUBLIC_BASE_URL` + `shopCardId()` (exported from `products.service.ts` so
   the link can't drift from the id `/shop/:productId` actually addresses) and is omitted
   when unset.

**No new env vars, and nothing to configure in Notion.** The one setup step is running
the database migrations (`pnpm --filter @workspace/api-server db:migrate`, or the
`migrate.yml` workflow) so `restock_alerts` exists — the same out-of-band step the rest
of the Postgres layer already needs. Known limit: because there is no marker in Notion,
the sweep reconsiders every back-in-stock request ever filed, so a request from long ago
is answered if its piece returns; delete stale rows in the contact inbox if that isn't
wanted.

Code: `services/restock-notification.service.ts`, `services/restock.ts`,
`sendDueRestockAlerts` in `services/schedule.service.ts`, `backInStockAlertEmail` in
`lib/resend/emails.ts`, `findPendingBackInStockRequests` in
`lib/notion/notify.repository.ts`, `claimRestockAlert` in
`lib/db/restock-alerts.repository.ts`, and the `restock-alert` runner in
`services/studio-tools.service.ts` + its card in `web-app/src/components/studio-tools.tsx`.

## Appointment scheduling (real-time slot booking)

Customers book appointments (consultations, fittings, design reviews, general) with a
staff member from `pages/appointments.tsx` — a four-step flow (purpose → format → time →
details) through the generated client. Scheduling runs on **Google Calendar** (not
Notion): free/busy is the conflict source and each booking is a calendar event. Code:
`lib/appointments/*` (pure logic + config), `lib/google/*` (Calendar + Sheets I/O),
`services/appointments.service.ts`, `routes/appointments.ts`.

1. **The type catalog is a targeted business rule in code.** `lib/appointments/catalog.ts`
   names the four types, their durations, and their routing rules (consultations are
   Alayna only; fittings, design reviews, and general appointments can be booked with
   either Alexandra or Alayna; fittings are in-person only). Duration drives the slot
   math and staff/locations drive UI + validation, so these are coupled to code. Retune a
   duration or rename a staff member here; the staff names must match the `Staff` column
   in the working-hours sheet.

   **Booking gates split by who a type is for.** Each type carries one of two optional
   flags. Order-scoped types (**fittings, design reviews**) set `requiresOrder` —
   `bookAppointment` requires an `orderNumber` and verifies it with
   `findOrderVerification` (the same email-matched check the measurement-change/review
   flows use): missing number → 400, unknown order → 404, mismatched email → 403, legacy
   order with no stored email → accepted. New-customer types (**consultations,
   general**) set `requiresProjectDetails` — a new customer has no order number, so the
   request must carry non-empty `projectDetails` (blank → 400), a light screen on the
   funnel. Both fields are optional on `NewAppointmentRequest` and required only by the
   flagged type; the frontend renders the matching field and enforces the same rule
   client-side, and `getAppointmentOptions` surfaces the flags so the UI knows which to
   show. Both values are recorded on the calendar event + the atelier notification.
   Enforced in `enforceBookingGate`. To change which types are gated, flip the flags in
   the catalog — no other code changes.

2. **Working hours are edited on the dashboard; conflicts are Google free/busy.**
   `computeSlots` (`lib/appointments/availability.ts`, pure + heavily unit-tested)
   needs a _positive_ grid of open hours, which Google free/busy can't give (it
   only says when someone is _busy_). That grid comes from the **"Staff
   Availability" Notion database** the atelier edits on `/studio` (no redeploy) —
   see "Staff availability, edited on the dashboard" below.
   `lib/appointments/schedule.ts` is the seam everything reads it through (the
   repository owns the fetch + its 60s cache + fallback; `buildSchedule` in
   `lib/appointments/staff.ts` is the pure mapper). The _subtractive_ side — every busy interval,
   including existing bookings **and** any event the staff added (a day off is
   just a calendar event) — comes from the **FreeBusy API** in
   `lib/google/calendar.repository.ts` (`listBusyInRange`), fed into `computeSlots`
   as `bookings`; `timeOff` is always empty. All wall-clock hours/slots are
   interpreted in `APPOINTMENT_TIMEZONE` (DST-correct via
   `lib/appointments/time.ts`, built on `Intl` — no date library); busy/bookings
   are UTC instants.

   **The Sheets read is hardened against Google's transient 503s** (its backend returns
   them intermittently, and a cold serverless instance has no warm cache to fall back
   on): the read retries a bounded 3 attempts with a short backoff (`lib/google/retry.ts`
   — idempotent **reads only**, never an event write), then serves the cached schedule
   however stale, and only with nothing cached at all throws a `ServiceUnavailableError`
   → **503** with a retriable customer message. That 503 is deliberately **not**
   alert-emailed (a Google outage isn't a defect here); a non-transient status — 401/403
   (key wrong / sheet not shared) or 404 (bad sheet id) — is **not** retried and still
   surfaces as a 500 + alert, because it is a real misconfiguration.

3. **Never trust a client-sent slot.** `POST /appointments` re-derives the type from the
   catalog and re-runs the _same_ `computeSlots` for the requested day (with fresh
   free/busy) before writing; a `start` that isn't currently an open slot (stale, taken,
   off the grid, or inside the lead-time window) is a `BadRequestError` (→ 400). The
   availability endpoint and the booking re-check share one function, so they can't
   disagree. Free/busy is read **fresh** (no cache) for this reason.

4. **Booking writes a calendar event, as the staff member.** Auth is a Google
   **Workspace service account with domain-wide delegation** (`lib/google/client.ts`):
   it impersonates each staff member (the `subject`) to read their free/busy and
   `events.insert` on their calendar with `sendUpdates=all` (a real Google invite to the
   customer) and, for virtual, a Google Meet link (`conferenceData`). The Meet link +
   calendar link flow back into the response, the confirmation email, and the success
   screen. Google Calendar is the sole record — there is **no** Notion appointments
   database.

5. **Booking is free and slots aren't held.** v1 has no Stripe step and no pending-hold:
   two simultaneous bookings for the same slot is a small, accepted race for a low-volume
   atelier. Booking policy is env-tuned: `APPOINTMENT_TIMEZONE`,
   `APPOINTMENT_MIN_LEAD_HOURS` (24), `APPOINTMENT_MAX_ADVANCE_DAYS` (45),
   `APPOINTMENT_SLOT_STEP_MINUTES` (15) — all read at call time in
   `lib/appointments/settings.ts`.

6. **Google setup.** Enable the Calendar API + create a service account (JSON key
   → `GOOGLE_SERVICE_ACCOUNT_KEY`); authorize its client id for
   `https://www.googleapis.com/auth/calendar` under Workspace Admin → Security →
   API controls → Domain-wide delegation (for the calendar impersonation). That
   is now the **only** Google setup: the working hours moved into Notion, so the
   Sheets API, its read-only scope, and the sheet share with the service-account
   email are all retired. `google-auth-library` mints the (impersonated) tokens;
   the rest is raw `fetch`, mirroring the Notion adapter.

### Self-service reschedule & cancel (signed manage link)

A customer can **reschedule or cancel** their own booking from a link in the confirmation
email — no sign-in — freeing the slot automatically. Because there is **no appointments
database**, the durable handle is a **signed HMAC token** (`lib/auth/tokens.ts`, signed
with `SESSION_SECRET`; its `"appointment"` purpose — the only token purpose — carries
`{ email, eventId, staff }`, 60-day TTL).

1. **The token is the authorization**, like a magic link — possession of the
   `${PUBLIC_BASE_URL}/appointments/manage?token=…` link is proof, no cookie/account.
   `bookAppointment` mints it after the event is created and embeds it in the
   confirmation email (`manageUrl` on `AppointmentEmailDetails`). Gated on
   `authConfigured()` + `PUBLIC_BASE_URL` (`buildManageUrl`); unset ⇒ the link is omitted
   and the email falls back to "reply to us". **No new env var / no atelier setup.**

2. **The calendar event is the record — read live, never trust the token's copy.**
   `createCalendarEvent` returns the event `id` and stamps private `extendedProperties`
   (`EVENT_PROP_*`: type, location, confirmation, email, name) so the event is
   self-describing. `lib/google/calendar.repository.ts` has `getCalendarEvent` (404/410 ⇒
   null), `updateCalendarEvent` (PATCH = a merge, so attendees/Meet/props survive), and
   `cancelCalendarEvent` (DELETE, 404/410 ⇒ idempotent success), all `sendUpdates=all` so
   Google re-notifies and the slot frees.

3. **Reschedule re-runs the same `computeSlots`** as booking, **locked to the same
   staff/type/location** (a move, not a rebooking — PATCH can't change calendars). Known
   limit: the current booking counts as busy, so a new time overlapping the old one isn't
   offered. 404 if gone, 409 if already started/cancelled, 400 if the slot isn't open.

4. **Contract-first** (unlike the webhook/cron routes): `GET /appointments/manage`,
   `POST /appointments/reschedule`, `POST /appointments/cancel` are in `openapi.yaml`
   with generated hooks. `AppointmentDetails` carries `timezone` so the manage page
   renders times without a second options fetch. Emails (reschedule/cancel confirmations
   - an atelier change notice) are best-effort from the appointments sender. Code:
     `services/appointment-manage.service.ts`, `routes/appointments.ts`, the three builders
     in `lib/resend/emails.ts`, `pages/appointment-manage.tsx` (+ shared
     `lib/appointment-format.ts`).

The **day-before reminder** was the deferred half of the same roadmap card and has
since shipped, built on the extended-property model above — see "Day-before
appointment reminders" below.

## Staff availability, edited on the dashboard

The studio's **standing working hours** — the positive grid every offered
appointment slot is computed from, before Google free/busy carves the exceptions
out of it — live in the **`staff_availability` Postgres table** and are edited
from `/studio` → **Working hours**. Code:
`lib/db/staff-availability.repository.ts`, `lib/appointments/schedule.ts` (the
read seam), `buildSchedule` in `lib/appointments/staff.ts` (the pure mapper),
`services/staff-availability.service.ts`, the four `/studio/availability` routes
in `routes/studio.ts`, and `web-app/src/components/studio-availability.tsx`.
Schema in `supabase/migrations/0004_staff_availability.sql`.

The schedule has lived in three places: a Google **Sheet**, then a **Notion**
database, and now our own table. Both earlier homes were chosen so the atelier
could edit hours without a redeploy — and both were retired for the same reason
the next one was: once the studio dashboard grew a **typed editor**, the
third-party store was holding data the app both owns and validates, and nobody
edited it there. Load-bearing decisions:

1. **The typed editor is the point, not the storage.** A spreadsheet accepts
   anything typed into a cell: a mistyped staff name, an end before a start, or a
   location spelled some other way produced **no error and no hours** — the day
   simply stopped being offered, silently. So every write goes through
   `staff-availability.service.ts`, which refuses (with a reason the dashboard
   shows verbatim) a staff name the appointment catalog doesn't route to, a range
   that ends before it begins, and a row left with no weekday or location after
   normalization — and stores what it accepts **canonically** (weekdays in week
   order, locations as the ids the slot calculator uses). The editor asks for
   staff as a picker fed by the server's own list, days and locations as toggles,
   and times as `time` inputs, so most of those refusals are unreachable from the
   UI at all.

2. **This is the one table in `lib/db/` that IS the record.** Every other one
   (`processed_payments`, `clients`, `order_index`, `restock_alerts`) is an
   optional integrity layer over something Notion owns, and degrades to a Notion
   fallback when `POSTGRES_URL` is unset. This one has no second store, so
   **appointment booking now requires Postgres** — the deliberate trade for a
   single, validated, app-owned schedule. Notion stays the record for what the
   _atelier_ manages by hand (orders, inventory, invoices); the working hours are
   not one of those.

3. **The database enforces what the service validates.** `end_time > start_time`
   is a check constraint, and `weekdays` / `locations` are checked against the
   canonical vocabularies — so a hand-run `update` can't introduce a value the
   slot calculator would silently skip. `start_time`/`end_time` are real `time`
   columns (Notion had no time property and had to use `HH:MM` text), formatted
   back to `HH:MM` in SQL so the driver's `"10:00:00"` never reaches the domain.
   The mapper in `staff.ts` stays tolerant anyway — it predates all of this and
   costs nothing.

4. **Required, and it fails loudly.** An unset `POSTGRES_URL` throws a pointed
   error from the repository naming the schedule, rather than degrading to empty
   — the same contract the retired `APPOINTMENT_SHEET_ID` and
   `NOTION_STAFF_AVAILABILITY_DATABASE_ID` had, because "no working hours" and
   "no configuration" look identical from the booking page and only one of them
   is a bug. An **empty** table is legitimate (the atelier hasn't set hours yet),
   and the editor says plainly that no times are being offered.

5. **The read keeps its 60s TTL cache + fall-back-to-stale-on-error.** Inherited
   from both predecessors and kept for the same reason: the schedule changes
   rarely but is read on every availability query and every booking re-check, so
   a database blip degrades booking to _slightly stale hours_ rather than _no
   hours_. Writes bust the cache. It is per-instance, so a write on one warm
   serverless instance doesn't bust another's — bounded by the TTL, and the same
   tradeoff both earlier versions had.

6. **Same staff gate as the rest of the dashboard.** The four operations
   (`GET`/`POST` `/studio/availability`, `PUT`/`DELETE`
   `/studio/availability/{entryId}`) sit behind `requireStaff` + the studio rate
   limiter like the analytics and the tools, and they are the only way the
   schedule is written. Contract-first (in `openapi.yaml` + generated hooks) —
   and the contract is storage-agnostic (`id` is just a string), which is why
   moving stores changed no generated code. An update **replaces the whole entry**
   rather than patching fields, so it and the create validate identically. A
   delete is a **hard delete** (the Notion version archived to the workspace
   trash; there is no trash here, and a block of hours is a handful of fields the
   atelier can retype in seconds — not worth an `archived_at` column every read
   would filter on). A malformed `entryId` is screened to a **404** rather than
   reaching Postgres as a uuid parse error and surfacing as a 500.

7. **A day off is still a calendar event.** This table is the standing week;
   `timeOff` remains permanently empty and every exception comes from FreeBusy, as
   before. Bookings already made inside hours that are later removed are
   untouched — they live on the staff calendar.

The atelier's one-time setup: run `db:migrate` so `staff_availability` exists,
then enter the hours under `/studio` → **Working hours**. **No Notion database,
no Google Sheet, and no env var of its own** — it rides the `POSTGRES_URL` the
Supabase integration already provides. Afterwards `NOTION_STAFF_AVAILABILITY_DATABASE_ID`
can be deleted from Vercel and the "Staff Availability" Notion database archived;
`APPOINTMENT_SHEET_ID` / `APPOINTMENT_SHEET_RANGE` were already retired, the
Sheets API can be disabled on the Google Cloud project, and the old sheet
unshared from the service account. Full walkthrough in `SETUP.md` (Part C).

## Customer account portal (Supabase Auth)

A signed-in home base gathering a customer's custom orders and shop orders in one place,
so they don't have to remember an order number per garment. It is an identity layer over
the existing lookups, not new order/invoice logic. Auth runs on **Supabase Auth**; Notion
and Google Calendar stay the system of record, still matched by **email**. Frontend:
`pages/account-login.tsx`, `account-callback.tsx`, `account-reset.tsx`, `account.tsx`,
`lib/supabase.ts`, `lib/auth-context.tsx`. Backend: `services/account.service.ts`,
`routes/account.ts`, `middlewares/auth.ts`, `lib/supabase/client.ts`.

1. **Identity is the email; there is no user table.** The dashboard is the existing
   order/shop-order lookups **re-keyed from order number to email** — no accounts of our
   own to store or enumerate. Supabase owns the credential store (its `auth.users`); the
   app never persists a user record. `requireCustomer` normalizes the token's email at
   the gate (`normalizeEmail`) so the Notion lookups key on the same canonical
   (lowercased) form the CRM dedupes on.

2. **Sign-in is Supabase-native and browser-driven.** `pages/account-login.tsx` calls
   supabase-js directly — **email+password** (`signInWithPassword` / `signUp`, with
   Supabase-managed hashing + email verification), **passwordless magic link**
   (`signInWithOtp`), **Google OAuth** (`signInWithOAuth`), and **forgot-password**
   (`resetPasswordForEmail` → `pages/account-reset.tsx` → `updateUser`). There is **no**
   server login/logout/verify route — the browser holds the session and logout is
   `supabase.auth.signOut()`. OAuth + magic-link redirects land on
   `pages/account-callback.tsx`, which lets supabase-js parse the token out of the URL
   (`detectSessionInUrl`, PKCE) and forwards to `/account`.

3. **Session transport is a Bearer JWT, not a cookie.** supabase-js holds the session in
   the browser (localStorage, auto-refreshed) and the generated API client sends the
   access token via the **`setAuthTokenGetter` seam** in `custom-fetch.ts`
   (`Authorization: Bearer <jwt>`); `lib/auth-context.tsx` (`AuthProvider` / `useAuth`)
   wires that getter once and drops the cached overview query on any auth-state change so
   data can't leak across identities. Tradeoff: the token is JS-readable (XSS-exposed) —
   accepted for the standard Bearer model. (`custom-fetch.ts` still passes
   `credentials: "include"` for any incidental same-origin cookie, but the portal
   authenticates by the header.)

4. **The server only verifies the JWT — it holds no session.** `requireCustomer`
   (`middlewares/auth.ts`) reads the Bearer token and verifies it with
   `getSupabaseClient().auth.getClaims(token)` (cached JWKS, local verification, no
   per-request round-trip; supports the ES256 asymmetric keys new projects default to),
   setting `res.locals.customer = { email, userId }` (the `sub` claim) or throwing
   `UnauthorizedError` (→ 401; the frontend redirects to sign-in). Adapter:
   `lib/supabase/client.ts` (lazy first-use env read, `supabaseConfigured()`, test seams
   `__setSupabaseClientForTests` / `__resetSupabaseClient`). Unset `SUPABASE_URL` /
   `SUPABASE_ANON_KEY` ⇒ the portal is inert (sign-in reports "unavailable",
   `/account/overview` 401s). The route carries the `accountRateLimiter`
   (`middlewares/rate-limit.ts`, `express-rate-limit`, in-memory/per-instance) as a cheap
   brake on the authorization surface.

5. **`SESSION_SECRET` is still required, but signs no sign-in token.**
   `lib/auth/tokens.ts` HMAC-signs/verifies only the **`appointment`**-purpose manage-link
   token. Supabase sends the branded verify / magic-link / reset emails itself over
   **custom SMTP = Resend** (configured in the Supabase dashboard, not
   `lib/resend/emails.ts`) — the version-controlled source for that copy lives in
   `.agents/memory/supabase-auth-emails.md`.

6. **Contract.** `/account/overview` is the only account operation in `openapi.yaml`
   (generated hook `useGetAccountOverview`), secured with a `bearerAuth` (JWT) scheme.

7. **Order lookup is Notion by email, augmented by the Postgres index.**
   `findOrdersByEmail` / `findShopOrdersByEmail` are the never-regress baseline —
   filtered on the `Email` / `Customer Email` property, paginated, returning lightweight
   summaries (no per-order milestone/invoice fan-out; the cards link out to `/track` and
   `/invoice/:n`). Notion's email `equals` is **exact** (hence the gate-side
   `normalizeEmail`), so when Postgres is configured `listCustomOrders` / `listShopOrders`
   **union in** any order numbers `findOrderRefsByEmail` discovers that the exact match
   missed (case-insensitive via `citext`, legacy orders joined by client id), then read
   those back from Notion by number so Stage/measurements are always live. The Postgres
   step is **best-effort**: a DB failure degrades to the Notion-only result. Caveat:
   orders predating the `Email` property are invisible to the Notion path — the customer
   can still track those by number, and `db:backfill-legacy` recovers the email from the
   page body.

8. **Scope.** Orders + shop orders + invoices (which ride along the order detail pages) +
   a **referral** card, plus **upcoming appointments** and **measurement history**:
   - **Appointments.** `getAccountOverview` runs `listUpcomingAppointmentsByEmail`
     (`lib/google/calendar.repository.ts`): one `events.list` per staff calendar, filtered
     by the **`aptEmail` private extended property** stamped on every booking (there is
     still no appointments DB; the calendar event is the record). The event→DTO mapping is
     the shared `lib/appointments/event-details.ts`, reused by the manage service so they
     can't drift. Each summary carries a freshly-signed `manageToken`, so the portal's
     inline reschedule/cancel drive the **existing** `/appointments/reschedule|cancel`
     endpoints — no new mutation routes. Controls are the shared
     `components/appointment-manage-panel.tsx` (also used by
     `pages/appointment-manage.tsx`); success invalidates the overview query.
     Best-effort: a calendar failure degrades to `appointments: []` and never fails the
     orders view. Caveat: bookings predating the `aptEmail` stamp won't list.
   - **Measurement history (display-only).** Measurements are written as typed Notion
     **properties** (five `number`s + a `Measurement Unit` select) in
     `buildOrderProperties`, alongside the page-body blocks the atelier reads (both from
     the one intake payload, so no drift). `extractMeasurements` reads them into
     `OrderSummary.measurements`, shown read-only under each custom order
     (`MeasurementsBlock`). Editing still goes through the measurement-change request.
     Caveat: only orders placed after the properties were added have readable
     measurements; `db:backfill-legacy` recovers earlier ones from the page body.
     **Still deferred:** in-place measurement _editing_.

9. **Finished orders are denoted, not inferred — and filed away.** Every order in
   the overview carries a derived **`state`** (`AccountOrderState`: `active` /
   `completed` / `cancelled`, contract-first), so the dashboard never has to read
   completion out of a stage name. It's computed server-side by
   `orderLifecycleState` (`services/delivery.ts`, alongside the review gate's
   `orderDelivered`) so **both order kinds are classified by the one positional
   rule** — the order is `completed` when its stage/status is the **last** in its
   live list (no stage name baked in, survives an atelier rename), `cancelled`
   when the `Cancelled` checkbox is set, which **wins over** completed (a shop
   order can be cancelled after fulfilment; a custom one can't). Custom orders
   classify for free (the summary already carries its live `stages`); shop-order
   records don't carry their status list, so `listShopOrders` reads the live one
   (`fetchLiveShopOrderStatuses`, 60s cached) — **best-effort**: a failed read
   yields an empty list, which classifies everything uncancelled as `active`, the
   safe way to be wrong (an order is never wrongly shown as finished). On the
   frontend (`pages/account.tsx`), active orders stay under "Custom orders" /
   "Shop orders"; everything completed or cancelled collects in one **"Past
   orders"** section, collapsed by default (expanded when nothing is current, so
   a history-only account never looks empty). A past card carries a
   **Delivered / Cancelled badge** (the contract's finished state is the
   kind-neutral `completed`; the customer-facing word is the atelier's own
   "Delivered", for both order kinds), drops the now-meaningless "Stage N of N" +
   target-completion line, and — when cancelled — drops the invoice link (the
   refund is the atelier's, don't point back at a pay screen). The `cancelled`
   flag added to `OrderSummary` is internal: the zod response parse strips it,
   the dashboard is served the derived `state`.

The atelier must, one time: create a Supabase project and set `SUPABASE_URL` +
`SUPABASE_ANON_KEY` (backend) and `VITE_PUBLIC_SUPABASE_URL` +
`VITE_PUBLIC_SUPABASE_ANON_KEY` (frontend) — on Vercel these come from the
Supabase integration; enable Email+password (confirm-email) + Magic Link + Google
in the Supabase Auth dashboard, point custom SMTP at Resend, and add
`${PUBLIC_BASE_URL}/account/callback` + `/account/reset` to the redirect
allow-list. `SESSION_SECRET` is still needed for the appointment manage-link, and
`PUBLIC_BASE_URL` for the redirect origin. **No new database of our own** — the
dashboard reads the customer's existing Notion orders/shop orders by email. For
the Phase 2 additions: appointments reuse the existing Google Calendar integration
(unset ⇒ they just don't appear); measurements need five `number` properties
(`Waist`, `Chest`, `Hips`, `Height`, `Body Girth`) + a `Measurement Unit` `select`
(`inches`/`cm`) added to the Order Tracking Pipeline database (until added, new
orders have no readable measurements). The Supabase auth email copy (confirm /
magic-link / reset) is version-controlled in `.agents/memory/supabase-auth-emails.md`
and pasted into the Supabase dashboard.

## Studio analytics dashboard (internal, staff-gated)

The atelier's own numbers in one place — `pages/studio.tsx` at **`/studio`**, fed
by `GET /api/studio/analytics`: custom and shop orders by stage, production load
against due dates, revenue by month, deposits vs. balances, and the best-selling
shop pieces. The figures are a **read-only aggregation over data the app already keeps** —
nothing new written, no new vendor, no new env var beyond the staff allowlist.
(The page also carries the atelier's internal tools and the working-hours editor,
which do write — see the two sections below.) Code: `services/studio-analytics.service.ts`, `routes/studio.ts`,
`middlewares/auth.ts` (`requireStaff`), `lib/staff.ts`, `lib/notion/scan.ts`, the
three `list*ForAnalytics` repository reads, and `web-app/src/pages/studio.tsx`.
Load-bearing decisions:

1. **Auth is the customer's Supabase session plus an allowlist — no second auth
   vendor.** A staff member signs in exactly like a customer at `/account/login`;
   `requireStaff` verifies the same Bearer JWT `requireCustomer` does (both share
   one `resolveSessionCustomer`) and then checks the email against
   `STUDIO_STAFF_EMAILS` (`lib/staff.ts`). Not signed in ⇒ **401** (the page
   redirects to sign-in). Past that the two checks answer **differently, on
   purpose**: an email that isn't on the allowlist ⇒ **404**, and the page
   renders the ordinary Not Found — the same thing a mistyped URL renders,
   because `/studio` is unlinked and `noindex` and a 403 would confirm to a
   customer who typed it that a dashboard is there to find (there is nothing
   they can do about the refusal, so there is nothing to tell them). An
   allowlisted email whose session came the wrong way ⇒ **403** with the
   server's reason shown verbatim, because there _is_ something to do about it
   and only someone already holding that mailbox can provoke it. Neither is a
   401 — they _are_ signed in, so bouncing them to sign-in would just loop. The
   allowlist is
   **env-only and NOT a Studio Setting** — access control isn't a business
   tunable, and anyone who could edit the settings database could otherwise grant
   themselves the studio's revenue figures. It **fails closed**: unset ⇒ nobody is
   staff and the dashboard is inert, the opposite of the optional integrations'
   degrade-to-off. The same gate now carries the atelier's internal **actions**
   too — see "Internal tools on the studio dashboard" below, which is what
   finished the roadmap's "Staff authentication for internal tools" and retired
   the CRON_SECRET-in-a-URL buttons.

2. **Staff must sign in with Google — the method is checked, not just the
   identity.** The studio's addresses are published on the site, so an allowlist
   alone is only as strong as the mailbox behind one: a leaked password or an
   intercepted magic link would be enough. So `requireStaff` also requires the
   session to have been established through Google, read from the access token's
   **`amr`** claim — what established _this_ session, unlike
   `app_metadata.provider`, which only says what's linked to the account.
   Supabase records an OAuth sign-in as `oauth` and doesn't name the provider, so
   this means "Google" precisely because Google is the only OAuth provider
   enabled on the project; enable a second and the check widens with it. The
   actual second factor is then **2-step verification enforced in Google
   Workspace admin**, which is what buys real MFA with no enrollment flow of our
   own. Load-bearing details: it **defaults ON** (`STUDIO_REQUIRE_GOOGLE`,
   opt-_out_ via `false`/`0`/`no`/`off`) because an access-control default you
   have to remember isn't one; it **fails closed** when a token carries no
   readable `amr`; the refusal is logged at `warn` with the email and methods (a
   staff address failing only on method is worth seeing); and the 403 message is
   rendered verbatim by the page — this is now the **only** thing that reaches
   that panel, so its **Continue with Google** button is always the actual fix —
   a button
   that signs out first (Supabase would otherwise hand back the same session) and
   returns to `/studio` via `lib/post-signin.ts` — a `sessionStorage` hop rather
   than a `?next=` on the redirect URL, which would need its own Supabase
   allow-list entry and hand a stranger an open-redirect parameter.

3. **Full-database scans, bounded in one place.** Unlike every other Notion read
   here, the analytics have nothing to filter by — they summarize the whole book
   of work. `lib/notion/scan.ts` (`scanDatabase`) is the single paging
   implementation the three readers share (`listOrdersForAnalytics`,
   `listShopOrdersForAnalytics`, `listInvoicesForAnalytics`), capped at
   `MAX_SCAN_PAGES` (100 pages ≈ 10,000 rows): hitting the cap **warns and returns
   a partial read** rather than fanning out unboundedly on a serverless function.
   One invoice scan replaces a per-order invoice fetch, and the aggregation is
   cached for 60s (the same TTL as every other live Notion read), so a refreshed
   dashboard doesn't re-scan.

4. **Shop revenue and custom bookings are side by side, never summed.** A shop
   order records what was collected and when (Stripe took it, Notion stamped the
   page `created_time`). A custom order's payments carry **no dates at all** — the
   invoice holds a paid _checkbox_ per stage — so the only honest monthly figure
   for bespoke work is what was **booked**: the invoice's `Final Balance`,
   attributed to the month the order came in. The contract carries them as two
   fields (`shopRevenue` / `customBooked`) and the UI labels them apart. Dating
   custom payments properly needs a real payment ledger — the roadmap's "move real
   invoicing to a finance tool". Months and "today" are read in the studio's
   timezone (`APPOINTMENT_TIMEZONE`), so a 9pm order on the 31st lands in the month
   the atelier worked it.

5. **Deposits vs. balances split without double counting.** Across every invoice
   on a live (non-cancelled) order: an unpaid deposit counts once as
   `depositsOutstanding`, and `balancesOutstanding` is what's left **beyond every
   deposit scheduled against the invoice** — so the two add to `outstandingTotal`
   with no overlap. A **paid balance settles the invoice outright** (the balance
   stage charges `Final Balance − deposits paid`, sweeping up an uncollected
   deposit), so it leaves nothing outstanding. An invoice whose `Order` relation is
   empty still counts; one on a cancelled order doesn't.

6. **Completion is positional, as everywhere else.** Both pipelines classify with
   the shared `orderLifecycleState` (`services/delivery.ts`) against the live
   stage / fulfilment-status lists, so an atelier rename never miscounts. An active
   order whose stage isn't in the live list still counts as active — it just has no
   bucket.

7. **Best sellers ride the inventory relation, and can legitimately be empty.**
   Top items are counted from each shop order's `Inventory Items` relation (the
   Phase-2 "relate shop orders to inventory rows" card), deduped per order and
   resolved to names via `listVariants()`. That relation records _which_ pieces
   were bought, not how many, so the figure is **orders containing the piece**, not
   units. Orders placed before the relation shipped (or with `NOTION_RELATION_LINKS`
   off) carry none, so the list comes back empty and the panel says why. The
   inventory read is the one **best-effort** source (a failure degrades to no best
   sellers); the orders / shop orders / invoices scans **are** the dashboard, so a
   failure there surfaces as a 500 rather than quietly rendering zeroes.

8. **No charting dependency.** The panels are plain CSS bars. A charting library
   would be the largest dependency in the app for six panels of numbers, against
   the repo's pruned-dependencies rule. The page is `noindex` (so it's out of
   the sitemap and the prerender pass) — the gate that matters is server-side,
   but there's no reason to advertise it.

9. **The way in is a staff-only nav link, gated by the server's own answer —
   and it takes Account's place.** `/studio` was originally reachable _only_ by
   typing the URL, which is what made it invisible in practice — a staff member
   on a preview deployment had no way to find it. It is still **not in
   `NAV_LINKS`** (the public array stays flat and unconditional):
   `useNavLinks()` in `navbar.tsx` swaps the `/account` entry for a separate
   `DASHBOARD_LINK` when — and only when — `useStudioAccess()`
   (`web-app/src/lib/studio-access.ts`) says so. That hook asks
   **`GET /api/studio/access`**, which is mounted behind the **same
   `requireStaff`** as the figures rather than re-deriving the answer
   client-side — one decision, so the link can never be offered to an account
   the dashboard would then refuse. The allowlist is deliberately never shipped
   to the browser, so asking the server is the only honest test. It **fails
   closed**: signed out it doesn't ask at all (an anonymous probe can only be a
   401), a 401/403/outage renders no link, and a refusal is **not retried**
   (`retry: false`) — a 403 is an answer. It counts against the shared
   `studioRateLimiter` budget, which is separate from (and much looser than) the
   account overview's: past the staff gate the ceiling exists to stop a runaway
   client, not to deter a stranger, and a dashboard load is already six reads. The answer is cached for
   the session (`staleTime: Infinity`; staff membership changes when an env var
   does, not mid-browse) and dropped on **any** auth-state change in
   `lib/auth-context.tsx` alongside the overview — otherwise a customer signing
   in after a staff member on the same tab would keep being offered the link.

10. **For staff the dashboard REPLACES the account portal, and is labelled
    "Dashboard".** A staff member doesn't place orders through the shop, so the
    customer portal is empty by construction for them — offering both only ever
    led somewhere blank. So `pages/account.tsx` hands a confirmed staff session
    on to `/studio` (`<Redirect>`), the navbar swaps the link rather than adding
    one, and the page's own H1 (and the `/studio` SEO title, and the 403 panel's
    heading) reads **Dashboard**. The **route is still `/studio`** — only the UI
    label changed, so the server routes, `post-signin.ts`, and the memory notes
    all still say studio. Three things make it hold together:
    - **The hand-off is at one door.** Sign-in (`account-login.tsx`) and the
      OAuth callback (`account-callback.tsx`) both default to `/account`, so
      redirecting there covers every way in without touching either.
    - **`useStudioAccess()` returns `{ staff, loading }`.** A caller that
      _routes_ on staffhood has to wait for a settled answer or a staff member
      sees a flash of the empty portal on the way past — so `/account`'s loader
      waits on `loading` too. (The navbar only _offers_ a link, so it ignores
      it and renders the public set until the answer lands.) `loading` is false
      while the probe is disabled, so a signed-out visitor is answered at once
      rather than held on a request that will never be made. The sign-in bounce
      still comes first: a pending staff answer never delays it.
    - **Sign-out moved onto the dashboard**, in the header _and_ the error
      state. With `/account` bouncing staff back to `/studio`, a dashboard with
      no sign-out is a dead end — a failed analytics read especially.

The atelier's one-time setup: set **`STUDIO_STAFF_EMAILS`** (comma-separated);
make sure **Google sign-in is enabled** in Supabase Auth and each staff address
can use it; and enforce **2-step verification** for those accounts in Google
Workspace admin — that last step is what the `amr` check leans on, and without it
the gate only means "signed in with Google". Prefer addresses that aren't
published on the site: the allowlist entry needn't be the studio's contact
address, and a private one removes the enumeration angle entirely. Also confirm
**"Confirm email" is ON** in Supabase, or a stranger could sign up _as_ a studio
address without ever touching its inbox. Everything else is already configured —
it reads the orders, shop-orders, invoices, and inventory databases the app
already uses.

## Internal tools on the studio dashboard

The atelier's five internal actions — **reconcile production milestones**,
**itemize an invoice**, **send a status update**, **cancel & refund an order**,
**refund a return** — are run from the signed-in `/studio` page, through
`POST /api/studio/tools/:tool`. None of the underlying work changed; who is
allowed to trigger it did. This is the roadmap's "Staff authentication for
internal tools" + "Retire the copy-a-secret buttons". Code:
`services/studio-tools.service.ts` (the dispatcher + the wording),
`routes/studio.ts`, and `web-app/src/components/studio-tools.tsx` (rendered at the
bottom of `pages/studio.tsx`). Load-bearing decisions:

1. **What replaced what.** Each tool used to be a `GET` link authenticating with
   `?secret=<CRON_SECRET>`, built by a **Notion formula property** on the relevant
   row and opened in a browser tab that rendered an HTML confirmation page. Those
   routes are **deleted**, not deprecated: `…/cron/generate-milestones/run`,
   `…/webhooks/notion-stage-change/run`, `/api/invoices/generate-line-items[/run]`,
   `/api/orders/process-cancellation[/run]`, and
   `/api/shop-orders/process-return[/run]`. The Bearer halves went too — nothing
   machine-driven called them. `test/integration/retired-secret-links.routes.test.ts`
   asserts they stay gone, because re-mounting one would put a
   money-moving credential back into URLs and browser history.

2. **What deliberately survives on `CRON_SECRET`.** Two callers are machines that
   can send a header, so they keep it: **Vercel Cron** →
   `GET /api/cron/generate-milestones` (the nightly reconciliation in
   `vercel.json`), and the **Notion stage-change automation** →
   `POST /api/webhooks/notion-stage-change`. The webhook still also accepts
   `?secret=` — the one place left that reads the secret from a URL — kept only
   because a live automation may already be configured that way; it should use the
   `Authorization` header. `lib/cron-route.ts` is now just those two auth checks.

3. **Contract-first, unlike the links it replaced.** The retired routes were
   outside the OpenAPI contract because they were browser tabs, not API calls.
   This is an ordinary SPA JSON call, so it lives in `openapi.yaml` with a
   generated `useRunStudioTool` hook: the tool name is a **path-param enum** (an
   unknown tool is a 400 from the generated schema, not a route that quietly
   doesn't exist) and `amount` is validated as a non-negative number before any
   service sees it.

4. **The server owns the wording; the page renders it.** Every tool returns the
   same `{ tool, status, title, message, details[] }` — the summary sentences the
   HTML confirmation pages used to compose, moved into
   `studio-tools.service.ts`. So the dashboard renders one shape instead of five,
   and a result reads as it always did. `status` is the part that carries meaning:
   **`ok`** (it did something), **`noop`** (there was nothing to do — every action
   is idempotent, so this is the normal result of a repeat run and must not read as
   success), **`attention`** (it ran but left work for a human, e.g. a refund
   Stripe rejected, which leaves the order uncancelled precisely so a re-run can
   retry). Something the tool couldn't even start — a missing order number, an
   unknown order, an invoice that isn't ready — is thrown as
   `BadRequestError`/`NotFoundError` and surfaces as a 400/404 with its own
   message, which the panel shows verbatim.

5. **The two refunds confirm before running.** `cancellation-refund` and
   `return-refund` move real money against a hand-typed order number, so the UI
   asks again with the number echoed back, and editing the field re-arms the
   question. Editing an order number is also the fix for the one thing a formula
   link did better — it could never be typed wrong. That trade buys the thing a
   link could never do: a **partial** return refund is a form field rather than an
   `&amount=180` hand-appended to a URL.

**Atelier setup (one time, after this deploys):** delete the four formula-property
link fields in Notion — `Send Status Update` on Order Tracking Pipeline, the
invoice-generator link on invoices & payments, and the cancellation / return refund
links on Order Tracking Pipeline and Shop Orders — plus any "Open link" button
pointing at `…/generate-milestones/run`. Then **rotate `CRON_SECRET`**: it has sat
in Notion formulas and browser history, and now that nothing but Vercel Cron and
the Notion automation sends it, rotating costs one env var and one automation
header. No new env var is needed — the tools reuse the `STUDIO_STAFF_EMAILS`
allowlist the dashboard already has.

## Customer requests on the studio dashboard

Six kinds of request land in the shared **"Website Contact Messages"** inbox — a
website inquiry, a back-in-stock ask, a measurement change, a cancellation, a
return or exchange, a newsletter opt-in — and the app had only ever **written**
them. Actioning one meant opening Notion, reading the row, and re-typing its
order number into one of the tools above: a trip off the surface the work happens
on, and the one way to point a refund at the wrong customer. The dashboard's
**Customer requests** panel is that read path, and each row **carries its own
order number to the tool that actions it**. `GET /api/studio/requests` for the
queue, `PUT /api/studio/requests/:id/state` for one decision — both contract-first
and behind the same `requireStaff` gate as the rest of the studio surface. Code:
`lib/notion/requests.{schema,repository}.ts`, `services/studio-requests.service.ts`,
the two handlers in `routes/studio.ts`, and on the frontend
`components/studio-requests.tsx` + `lib/studio-handoff.ts` (rendered by
`pages/studio.tsx`).

1. **The hand-off fills a tool; it never runs one.** The panel's action button
   sets the matching tool card's field, scrolls to it and focuses it — and stops.
   The two refunds keep their "ask again with the order number echoed back" step,
   because that confirmation is what makes a wrong number impossible rather than
   merely unlikely, and it would be a poor trade to skip it for one fewer click.
   The plumbing is `lib/studio-handoff.ts`, whose only subtlety is a **nonce**:
   two requests naming the same order, or the same request pressed twice, would
   otherwise be an identical object the tool card can't tell from the one it
   already applied, so it would neither re-scroll nor re-arm a dismissed
   confirmation. A hand-off also clears the card's previous result, which would
   otherwise sit under a freshly filled field reading as "this one is done".

2. **Which tool actions which kind is derived server-side.** `requestAction`
   (`requests.schema.ts`) maps cancellation → `cancellation-refund`, return →
   `return-refund`, back-in-stock → `restock-alert`, and lives next to the
   `Request type` constants that define what a cancellation _is_ rather than in
   the component that draws the button. A **measurement change** and an
   **inquiry** carry **no** action on purpose — the first is applied to the order
   by hand (the app never edits an order's measurements) and the second is
   answered by email — and the panel says what to do instead, which is better
   than a button that does nothing.

3. **The order number is PARSED, and withheld rather than guessed.** There is no
   order-number property on the contact database: the order-scoped writers put it
   in the row's **title** (`Cancellation: ORD-000002`) and again in the message
   body's first line. `extractOrderNumber` reads the title first (the writer's own
   summary) and falls back to the body (for a title someone rewrote), matching only
   `ORD-…` / `SHP-…`. A bare `000002` does **not** match: the tools refund against
   whatever is in the field, so a number that can't be recovered means the action
   is **not offered at all**, and the atelier types it themselves as before.
   Parsing is skipped entirely for the kinds that concern no order — an inquiry
   quoting an order number is not a request against that order, and offering a
   refund button on one would be a serious way to be wrong.

4. **Both derivations point at "show it", not "hide it".** The `kind` comes from
   `Request type` and the state from `Stage`; an unrecognized `Request type` is
   `other` (shown, with the raw value named) and an unrecognized or **blank**
   `Stage` is `new` (open). That's the same direction `reviewModeration` takes and
   the same one the inbox's own saved views take — `Stage != Closed` rather than
   `Stage in (New, Replied)` — because a request nobody triaged should appear
   rather than vanish. `Replied` and `Closed` are **targeted business rules**
   naming live option values, like `REVIEW_STATUS_PUBLISHED`: rename `Closed` in
   Notion and every closed request reopens here.

5. **Newsletter opt-ins are excluded, deliberately.** They land in the same
   database and are written by the same shape of writer, but they are a **consent
   record nobody answers** — leaving them in makes a queue that never empties.
   They're dropped in the Notion filter _and_ in the pure extractor (so a row the
   filter lets through on a casing difference still can't reach the queue), and the
   panel's empty state says so rather than leaving "six kinds, five listed"
   unexplained. Same call the Notion ops page's "Open requests" view made.

6. **Two bounded queries, not a scan.** The contact inbox is the largest database
   the app reads — every inquiry and opt-in ever filed — so paging it front to back
   (as the analytics do) would turn one dashboard load into up to a hundred Notion
   requests to find a handful of open rows. Instead the **open** rows are asked for
   directly (one page, oldest first, `truncated` when cut short) and the **closed**
   ones are a short second read. The open list is the feature and the closed list is
   the undo history, so a failure reading the closed rows **degrades to an empty
   record** and still serves the queue; a failure reading the queue itself throws.
   Unlike the public testimonials read, an unconfigured database **fails loudly** —
   an empty work queue that means "misconfigured" is indistinguishable from one
   that means "nothing to do", which is the worst way for a queue to be wrong.

7. **The only thing it writes is `Stage`.** The request row itself is never edited,
   the same contract the capture endpoints keep with the orders they concern. Every
   state is reversible and `new` writes the **capture default**
   (`CONTACT_DEFAULT_STAGE`), so reopening leaves the row exactly as a freshly filed
   one rather than in a state only this page can produce.

**No new env var, no new database, and nothing to add in Notion** — it reads and
writes the same `Website Contact Messages` database, the same `Stage` select, and
the same `Request type` values the six writers already use (the inbox's triage
views read the same property, so neither surface is authoritative over the other).

### The newsletter panel (opt-ins vs. the Resend audience)

The sixth request type gets its own panel rather than a place in the queue above,
because nobody _answers_ an opt-in — someone puts the address on the mailing list.
`GET /api/studio/newsletter` lists them; `POST /api/studio/newsletter/:id/subscribe`
adds one to the audience and files its row away. Code:
`services/studio-newsletter.service.ts`, the newsletter half of
`lib/notion/requests.{schema,repository}.ts`, the read side of
`lib/resend/audience.ts`, and `web-app/src/components/studio-newsletter.tsx`.

1. **Membership is READ from Resend, never stored — this is the whole design.**
   The app already tries to sync each opt-in at capture time
   (`upsertAudienceContactBestEffort`), and that sync is **best-effort** and
   **self-gates off** when `RESEND_AUDIENCE_ID` is unset. So an opt-in can sit in
   Notion having never reached the list, with nothing anywhere saying so — and an
   "added" checkbox on the row would be silent about exactly that case, because it
   records what someone remembered to tick and the capture-time sync wouldn't tick
   it. `listAudienceContacts` asks Resend instead. Same rule as "Stripe is the
   source of truth for money — the Notion markers are not".

2. **"We couldn't ask" is its own answer.** `NewsletterSubscription` is
   `subscribed` / `absent` / **`unknown`**, and the Add button is offered **only**
   on `absent`. An unreadable or unconfigured audience reports `unknown` for every
   row and the panel says which of the two it is — because rendering "we couldn't
   reach Resend" as "not on the list" would put an Add button in front of people
   who are already on it. The audience read is best-effort: Notion and Resend are
   separate systems, so a Resend outage costs the subscribed column for one page
   load, not the list of who opted in.

3. **Resend first, Notion second.** An opt-in left in the panel having already
   been added costs one wasted press (the upsert is idempotent); one filed away
   having never reached the list costs a subscriber, silently, forever. So the
   `Stage` write only happens after Resend accepts, and a Resend failure leaves
   the row open.

4. **Whether a contact has since UNSUBSCRIBED is deliberately not modelled.**
   Resend owns unsubscribes — it attaches the one-click unsubscribe to every
   broadcast and honours it — so an opt-out is not something the atelier acts on,
   and a state nobody acts on is one more thing to reason about for no gain. Such
   a contact reads as `subscribed` (Resend holds them) and so is never offered
   the Add button. That also keeps the studio structurally out of anyone's
   opt-out: `subscribeNewsletterSignup` **skips the Resend write for an address
   already on the audience** and just files the row, so `upsertAudienceContact`'s
   re-subscribe PATCH — right at capture time, when the person has just asked, and
   wrong from a dashboard — is unreachable from this panel. A 409 is left for the
   two states that genuinely block: an unconfigured audience (closing the row
   would record a subscription that never happened) and a row with no address.

5. **Dismiss reuses the queue's state operation.** There is one writer of a
   contact row's `Stage` (`PUT /studio/requests/:id/state`), and the newsletter
   panel calls it for dismiss/put-back rather than growing a second one. That is
   why `newsletter` rejoined `StudioRequestKind` — the row type has to be
   expressible in the response — while `extractStudioRequests` still filters
   opt-ins out of the queue itself.

6. **The already-filed list keeps its live status.** A row dismissed in error, or
   filed away before the audience was configured, still shows **Not on the list**
   — so a mistake stays visible instead of being assumed dealt with.

7. **`source` is parsed from the subject.** `newsletter.blocks.ts` deliberately
   folds it into the title (`Newsletter opt-in — footer`) rather than adding a
   property, so `extractSignupSource` reads it back. Display-only; nothing
   branches on it, and an unrecognized subject simply yields nothing.

Setup is the same `RESEND_AUDIENCE_ID` the capture-time sync already uses — unset
⇒ the panel still lists the opt-ins (so nothing is lost) and says what to set.

## Postgres (payment idempotency + a provisioned read-model)

One-time setup: create a Supabase project and set `SUPABASE_URL` + `SUPABASE_ANON_KEY`
(backend) and `VITE_PUBLIC_SUPABASE_URL` + `VITE_PUBLIC_SUPABASE_ANON_KEY` (frontend) —
on Vercel these come from the Supabase integration; enable Email+password
(confirm-email) + Magic Link + Google in the Supabase Auth dashboard (the Google
OAuth-client + consent-screen steps are the runbook in
`.agents/memory/supabase-google-signin.md`); point custom SMTP at Resend; and add
`${PUBLIC_BASE_URL}/account/callback` + `/account/reset` to the redirect allow-list.
`SESSION_SECRET` is still needed for the appointment manage-link and `PUBLIC_BASE_URL`
for the redirect origin. **No new database of our own.** Appointments reuse the existing
Google Calendar integration (unset ⇒ they just don't appear); measurements need five
`number` properties (`Waist`, `Chest`, `Hips`, `Height`, `Body Girth`) + a
`Measurement Unit` `select` (`inches`/`cm`) on the Order Tracking Pipeline database. The
Supabase auth email copy is version-controlled in
`.agents/memory/supabase-auth-emails.md` and pasted into the Supabase dashboard.

## Postgres (payment idempotency + the account order index)

A **Postgres layer**, provided by the same Supabase project. Notion stays the record for
the order lifecycle; Postgres holds **app-owned facts** Notion can't enforce or has no
stake in. Most of it is **degrade-safe**: unset `POSTGRES_URL` ⇒ `postgresConfigured()`
is false and those callers fall back to the pre-Postgres behavior.

**Two features are the exception and hard-require it**, because they have no second
store to fall back to: the **back-in-stock alert's** sent-marker (without it a nightly
sweep re-emails everyone) and the **staff working hours** (without them there are no
appointment slots to offer). Both fail loudly with a pointed message rather than
degrading to empty — see "Automated back-in-stock alerts" and "Staff availability,
edited on the dashboard". Adapter: `lib/db/client.ts` (lazy first-use env read, the narrow
injectable `DbClient` seam — `query` + `end` — so repos are driver-agnostic and fakeable
like `NotionClient`; test seams `__setDbForTests` / `__resetDb`).

1. **Three data tables, all wired.** `supabase/migrations/0001_init.sql` provisions
   `schema_migrations`, `clients`, `order_index`, and `processed_payments`.
   `processed_payments` is Stripe idempotency (below); `clients` + `order_index` are the
   email-keyed customer/order discovery index for the account portal — written
   **best-effort** on order/checkout (`upsertClientIndex` / `writeOrderIndex`, from
   `orders.service` + `checkout.service`) and read by the overview
   (`findOrderRefsByEmail`, `account.service`). When Postgres is unset the index no-ops
   and the portal falls back to reading Notion directly. A one-off
   `backfill-order-index.ts` (`db:backfill`) seeds the index from existing Notion orders.

2. **`processed_payments` is atomic Stripe idempotency for shop orders.**
   `lib/db/processed-payments.repository.ts` — `claimPayment`
   (`insert … on conflict (stripe_session_id) do nothing`, returning `claimed` / `done` /
   `in_progress`, with a `STALE_CLAIM_MINUTES = 10` reclaim window so a crash between
   claim and confirm can't swallow a payment forever), `confirmPayment`, `releasePayment`.
   `recordPaidOrder` claims → writes the Notion order → confirms, releasing + rethrowing
   on failure so a Stripe redelivery reprocesses, and throwing on a live `in_progress`
   claim so a concurrent delivery can't race a duplicate. The Notion
   `findOrderBySessionId` guard is retained as a reclaim-only backstop, and a DB error is
   caught and logged, falling back to that Notion dedup — so a Postgres outage never
   blocks recording a paid order. **Custom-order payments don't use it.**

3. **Pooled at runtime, direct for migrations; never in the deploy path.** The running app
   reads the **pooled** `POSTGRES_URL` (Supabase PgBouncer, transaction mode) with
   `prepare: false, max: 1, idle_timeout: 20` (each warm serverless instance holds its own
   tiny pool feeding the shared pooler). Migrations run **out-of-band** via
   `pnpm --filter @workspace/api-server db:migrate` (`src/scripts/migrate.ts`, applying
   `supabase/migrations/*.sql` in filename order, each in a transaction with its
   `schema_migrations` insert) on the **non-pooled** `POSTGRES_URL_NON_POOLING` — DDL
   can't traverse PgBouncer. That's a manual `workflow_dispatch` job
   (`.github/workflows/migrate.yml`), deliberately kept out of `build:vercel` and cold
   starts. `postgres` (porsager) is a prod dependency.

4. **These tables are closed to the Data API — keep them that way.** Supabase serves the
   `public` schema through PostgREST, and the `anon` key is public (it ships in the
   browser bundle as `VITE_PUBLIC_SUPABASE_ANON_KEY`), so a table left at Supabase's
   defaults is world-readable **and world-writable** by anyone who reads the JS.
   `0002_lock_down_public_tables.sql` closes that: RLS on with **no policies**
   (deny-all), all grants revoked from `anon`/`authenticated`, and the schema's
   `ALTER DEFAULT PRIVILEGES` reset so a future `create table` doesn't silently reopen it.
   The app is untouched because it never uses PostgREST — it connects directly as
   `postgres`, which **owns** these tables and so bypasses RLS. Two rules follow: a new
   table in `public` needs its own `enable row level security` + `revoke` pair in the
   migration that creates it, and a PostgREST RPC (there are none today) would need an
   explicit `grant execute`.

One-time setup: on Vercel the Supabase integration provides `POSTGRES_URL` +
`POSTGRES_URL_NON_POOLING`; run `db:migrate` once against the non-pooled URL. Unset ⇒ the
degrade-safe callers no-op, but appointment booking and the back-in-stock sweep do not
work at all. Tests: `test/unit/db.client.test.ts`,
`test/unit/processed-payments.repository.test.ts`,
`test/unit/staff-availability.repository.test.ts`, and the `checkout.service`
dedup-branch tests, all over `test/support/fake-db.ts`.

## Web analytics & cookie consent

The site collects **privacy-friendly web analytics** (pageviews + client-side
navigations) via **Vercel Web Analytics** (`@vercel/analytics/react`), gated behind an
explicit **opt-in cookie-consent banner**. Purely client-side — no backend, no data
model, no new env var (enable _Web Analytics_ in the Vercel project dashboard for data
to flow). Files: `lib/consent.tsx` (the consent context), `components/analytics.tsx`
(the gated `<Analytics />`), `components/cookie-consent-banner.tsx`, all wired in
`App.tsx`, plus a "Cookies and analytics" section + "Manage cookie preferences" control
on `pages/privacy.tsx`.

1. **Consent is opt-IN, and analytics is the only thing it gates.** `ConsentProvider`
   holds one status — `"granted" | "denied" | "unset"` — persisted to `localStorage`
   under `aa-cookie-consent`. Until the visitor chooses, status is `"unset"`, the banner
   shows, and **nothing non-essential loads**. `ConsentedAnalytics` renders Vercel's
   `<Analytics />` (which injects the insights script) **only** when status is
   `"granted"`, so no analytics request is made otherwise.

2. **Essential storage is never gated here.** The Supabase session (the customer's auth
   token in localStorage) is strictly necessary and out of scope for the banner — there
   is deliberately no "reject essential" path. Vercel Web Analytics is itself
   **cookieless** and doesn't track across sites; the opt-in gate is kept anyway for
   compliance and so the gate is already in place if analytics ever moves to a
   cookie-based provider.

3. **The choice is revisitable.** The privacy page's `ManageCookiePreferences` calls the
   context's `reset()`, clearing the stored choice so the banner reappears — a visitor
   can withdraw consent as easily as they gave it. This is why `pages/privacy.tsx`
   consumes `useConsent()` and its test wraps it in `ConsentProvider`.

Tests: `test/consent.test.tsx`, `test/cookie-consent-banner.test.tsx`,
`test/analytics.test.tsx` (with `@vercel/analytics/react` mocked).

## Social share metadata (Open Graph, Pinterest, prerendering)

Every page carries Open Graph / Twitter card metadata, and — because this is a
client-rendered SPA — the version that matters is **baked in at build time**. A social
scraper (Pinterest, Facebook, LinkedIn, Slack, iMessage) does not execute JS, so the
runtime `<Seo>` component reaches only JS-executing crawlers like Google. Three layers,
all reading from one source of truth:

| Layer                                | File                                                                           | Reaches         |
| ------------------------------------ | ------------------------------------------------------------------------------ | --------------- |
| Route metadata (the source of truth) | `web-app/src/lib/seo-routes.ts`                                                | —               |
| Runtime head mutation                | `web-app/src/components/seo.tsx` (`<Seo>`)                                     | JS crawlers     |
| Build-time prerender + sitemap       | `web-app/src/lib/seo-html.ts` + the `seo-prerender` plugin in `vite.config.ts` | Everything else |

`seo-html.ts` holds the pure string transforms so they are unit-testable
(`test/seo-html.test.ts`); `vite.config.ts` is only the filesystem shell. On Vercel the
built filesystem is checked **before** `rewrites`, so `dist/public/<route>/index.html` is
served at the clean path and the SPA catch-all remains the fallback for dynamic/noindex
routes.

1. **Each route ships two images, landscape first.** The platforms disagree and only one
   image can be primary: Facebook / LinkedIn / Slack crop to landscape (1.91:1), while
   **Pinterest's feed is 2:3 vertical** and renders a landscape image as an
   easily-scrolled-past sliver. So `socialImages()` emits an ordered pair — `1200x630`
   then `1000x1500` — and a scraper that understands only one image takes the first.
   Sizes live in `SOCIAL_IMAGE_SIZES` next to the metadata, not in the generator, so the
   two can't disagree.

2. **`og:image:width` / `:height` / `:alt` bind to the `og:image` they FOLLOW,** so an
   image and its dimensions must move together. Both writers replace the **whole** image
   block (delimited by the `<!-- seo:images:start/end -->` markers in `index.html`)
   rather than patching tags one at a time — patching individually is what let a
   per-route image inherit the default's `1280x720`. An image of **unknown** size (a
   Notion-hosted product photo) emits **no** dimension tags; never guess, since a wrong
   ratio is worse than none. The prerenderer **throws** if the markers go missing rather
   than silently shipping every route with the default image.

3. **Artwork is generated out-of-band and committed.**
   `pnpm --filter @workspace/web-app social-images`
   (`scripts/generate-social-images.ts`) renders each route's card from the brand tokens
   - fonts via headless Chromium and writes `public/social/<slug>-{og,pin}.png`. The
     display copy lives in that script's `ART` table (deliberately _not_ the SEO
     title/description, which are written for search results and read as clutter at poster
     scale) and the run **fails** if an indexable route has no entry. It is **not** in the
     build or deploy path. Prefer Playwright's `headless_shell` binary: with a full Chrome,
     `--window-size` sizes the OS _window_, so the viewport comes out ~90px short and the
     bottom of the art is clipped. `test/social-images.test.ts` guards the seam by reading
     each file's real dimensions out of its PNG/JPEG header, so a route added without
     regenerating the art fails CI instead of shipping a 404 share image.

4. **Product pages are prerendered from a build-time catalogue snapshot.**
   `/shop/:productId` is dynamic, so it can't live in `seo-routes.ts` — and without a page
   of its own it fell through Vercel's SPA rewrite to the _home_ `index.html`, so pinning
   a dress produced a card titled "Custom Figure Skating & Dance Costumes".
   `build:vercel` runs `pnpm --filter @workspace/api-server seo:export-products` between
   the two builds, writing the verbatim `GET /api/products` payload to
   `web-app/.seo/products.json` (gitignored); the prerender plugin bakes
   `dist/public/shop/<id>/index.html` per product with real OG tags, the `Product` +
   `BreadcrumbList` JSON-LD, and a sitemap entry. The share image is the product's **own
   photograph**, falling back to the shop's artwork when it has none. The JSON-LD/meta
   helpers are shared with `pages/shop.tsx` via `web-app/src/lib/product-seo.ts` so the
   runtime and prerendered tags can't drift.

   Two consequences: the exporter is **degrade-safe** (Notion unconfigured or failing ⇒
   it logs, writes nothing, exits 0, and the build ships without product pages — it must
   never fail a deploy), and the baked pages are a **snapshot** (a product added after a
   deploy has no prerendered page until the next one; a removed product keeps a stale
   one). The SPA always renders live inventory; only the share card is frozen. Ids are
   filtered against `SAFE_ID` so catalogue data can't write outside `outDir`.

5. **The exporter is bundled by esbuild, not run through type-stripping.** It imports the
   Notion service layer, whose relative imports use `.js` specifiers that
   `node --experimental-strip-types` will not resolve back to the `.ts` sources. It is a
   third entry point in `api-server/build.mjs`, emitting
   `dist/scripts/export-product-seo.mjs`; `dist/app.mjs` and `dist/index.mjs` keep their
   paths, so the Vercel entrypoint is unaffected.

6. **Pinterest domain claim is an optional build-time env var.**
   `PINTEREST_DOMAIN_VERIFY` (no `VITE_` prefix — it is consumed by a Vite plugin at
   build time and never reaches the client bundle) injects
   `<meta name="p:domain_verify">` into `index.html`, which the prerenderer propagates to
   every route. Claiming the domain attributes Pins saved from the site to the studio
   account and unlocks Pinterest analytics. Unset ⇒ **no tag at all** rather than an empty
   one, since an empty `content` reads to Pinterest as a failed claim.

**Pinterest setup (one time):** in Pinterest → Settings → Claimed accounts → Claim
website → "Add HTML tag", copy the `content="…"` value into the
`PINTEREST_DOMAIN_VERIFY` Vercel env var, redeploy, then press Verify.

## Invisible anti-spam (honeypot + timing + submission rate limit)

The public, anonymous submission forms — **contact** (`POST /api/contact`),
**back-in-stock notify** (`POST /api/notify`), and **newsletter**
(`POST /api/newsletter`) — carry a zero-friction, no-third-party anti-spam layer so a bot
can't cheaply pollute the Notion contact database (+ Resend mail / marketing audience).
Nothing is customer-visible; there is no CAPTCHA. Three signals:

1. **Honeypot** — a hidden `website` field a real visitor never sees or fills (off-screen
   - `aria-hidden` + `tabIndex=-1`, not `display:none`). Any non-empty value marks the
     submission as a bot.
2. **Timing** — an `elapsedMs` field. A submit faster than a human plausibly could
   (`< SPAM_MIN_FILL_MS`, default **2000**, `0` disables) is a bot. **Absent ⇒ treated as
   human (fail open)**, so a client that can't measure it still works.
3. **Rate limit** — a shared per-IP `submissionRateLimiter` (5 / 10 min, the same
   in-memory/per-instance `express-rate-limit` as the account limiter — a best-effort
   brake, not a hard wall).

- **Contract-first.** `website` + `elapsedMs` are **optional** fields on
  `NewContactRequest` / `NewNotifyRequest` / `NewNewsletterRequest` in `openapi.yaml`
  (regenerate the libs after editing). Optional ⇒ a legacy client that omits them keeps
  working.
- **Silent success-looking drop, never a 4xx.** `spamFilter(success)`
  (`middlewares/spam-filter.ts`) runs **after** `validate` (reading `res.locals.body`); a
  flagged request gets the exact success response the endpoint would return
  (`{ status: 201, body: { success: true } }`) with **no** Notion write or email, so a bot
  gets no signal it was caught and never learns to evade. The pure `isLikelySpam`
  predicate is unit-testable without HTTP.
- **No service / Notion-blocks change.** The two fields are never read by the blocks
  builders — the middleware short-circuits before the service.
- **`SPAM_MIN_FILL_MS` is read fresh from env per call**; unset ⇒ default, so it's
  inert-safe in dev/test. It is **not** a Studio-Settings key.
- **Frontend reuse.** `web-app/src/lib/anti-spam.tsx` exports the shared `HoneypotField`,
  `honeypotSchema` (spread into each form's local zod schema), and `useSubmitTimer()`,
  wired into `pages/contact.tsx`, `components/notify-dialog.tsx`,
  `components/newsletter-signup.tsx`, and the order-form newsletter path.

Tests: `test/unit/spam-filter.test.ts`, `test/integration/contact.routes.test.ts`
(honeypot silently dropped, no write), `test/integration/submission-rate-limit.routes.test.ts`,
and the frontend form tests. This covers the fully-anonymous forms only; the
order/appointment/order-scoped endpoints are out of scope.

## Development workflow

### Prerequisites

- **pnpm is required** (the `preinstall` hook fails the install for npm/yarn).
- Node with the versions implied by `@types/node` ^26.
- Copy `.env.example` → `.env` and fill in `NOTION_API_KEY` +
  `NOTION_ORDERS_DATABASE_ID`.

### Install & run

```bash
pnpm install
pnpm dev            # backend (:3000) and frontend (Vite) in parallel
```

The frontend proxies `/api` to the backend. The api-server `dev` script builds with
esbuild and runs the bundled output; it reads env from the repo-root `.env` via
`DOTENV_CONFIG_PATH`.

### Build & typecheck

```bash
pnpm build          # typecheck everything, then build all packages
pnpm build:vercel   # what Vercel runs: api-server (esbuild) + product SEO export + frontend (vite)
pnpm typecheck      # tsc --build across project references + per-package typechecks
```

TypeScript uses **project references** (`tsconfig.json` → `lib/*`, `tsconfig.base.json`
for shared compiler options). `customConditions: ["workspace"]` lets packages resolve
each other from **source** during typecheck. `strict` null checks on, `module: esnext`,
`moduleResolution: bundler`, `noEmitOnError`, ESM everywhere (`"type": "module"`).

### Tests

```bash
pnpm test           # all unit + integration tests (Vitest, no network)
pnpm test:e2e       # Playwright e2e (tests/e2e/*.spec.ts)
pnpm test:smoke     # Playwright against the real deployed site
pnpm test:coverage  # both Vitest suites with v8 coverage (report-only, no thresholds)
```

**Layout convention.** Every package with Vitest tests keeps them in `test/` at the
package root (never co-located in `src/`, so they stay out of the _build_ graph), with
`test/support/` holding the setup file plus package-local helpers.

**`.test.ts` vs `.spec.ts` vs `.smoke.ts` is load-bearing, not an accident.** Vitest
files are `*.test.ts(x)`, mocked Playwright e2e is `*.spec.ts`, production smoke is
`*.smoke.ts`. The extension tracks the runner: Vitest's `include` glob can then never
match an e2e spec, and Playwright's default `testMatch` (which _does_ match `.test.ts`)
can never pick up a Vitest suite. Don't "unify" these.

**Shared fixtures — `lib/test-fixtures`.** `@workspace/test-fixtures` holds the domain
fixtures used by all three suites (`createOrderInput()`, `orderRecord()`,
`contactInput()`, `STAGES`, `GENERIC_ERROR`), typed against the generated
`@workspace/api-zod` contract so a fixture can't silently drift from the API. Two rules,
both explained in that package's header comment:

1. **A fixture is only ever a _stub input_** — a request body, a mocked repo return, a
   stubbed hook result, a mocked HTTP response. Never the _expected output_ of the mapper
   that consumes it, or a bug in the fixture cancels a bug in the mapper. Where a test
   both stubs and asserts (e.g. `orders.routes.test.ts`), the stub uses the fixture and
   the expectation stays written out by hand.
2. **Notion-wire-shaped fakes stay local** to
   `artifacts/api-server/test/support/fake-notion.ts` (`orderPage()`,
   `databaseSchemaWithStages()`). Those are raw Notion page JSON — a different layer from
   the DTOs above, and keeping them apart is what lets `schema.test.ts` take its input
   from one place and write its expectation in another.

**Tests are typechecked.** Each package has a `tsconfig.test.json` (and `tests/` a
`tsconfig.json`) covering the test dir without adding it to the build/emit graph;
`pnpm typecheck` runs them. `tests/tsconfig.json` also carries a `paths` mapping for
`@workspace/test-fixtures` — Playwright won't transpile TypeScript inside `node_modules`
and ignores Vite's `customConditions`, so mapping the package to source is what makes the
import resolve from an e2e spec.

**Backend unit / integration (Vitest).** `artifacts/api-server/test/` — `unit/`
(pure-function tests for Notion schema mapping and block builders, repository tests
driving the **injected** `NotionClient` with a fake, service logic) and `integration/`
(supertest route tests over the real Express stack with the Notion repository mocked). No
server, no network, no Notion. `vitest run test/unit` is the fast loop. A vitest-config
plugin maps the source's `.js` import specifiers to the on-disk `.ts` files so tests run
with no build step.

**Frontend component (Vitest + Testing Library).** `artifacts/web-app/test/` (jsdom) —
the status timeline's completed/active/future logic, the shop's render states and
category filter, the order-form validation + submit-payload mapping, and the
consent/analytics gates. Each file mocks the generated react-query hook it needs
(`vi.mock("@workspace/api-client-react")`) and drives the page through its states via
`test/support/mock-hook.ts`.

Both Vitest configs set `clearMocks: true`, so tests don't hand-roll a
`beforeEach(() => vi.clearAllMocks())`. Note `pnpm test` filters on `./artifacts/**`
rather than using `-r`: the `@workspace/tests` package's `test` script is
`playwright test`, and `-r` would drag Playwright into the unit-test run (which CI
executes _before_ it installs a browser).

**End-to-end (Playwright).** By default the e2e run is self-contained: Playwright starts
the frontend dev server itself (`webServer` in `playwright.config.ts`) and every spec
intercepts `/api/*` in the browser (`tests/e2e/support/mock-api.ts`), so no api-server or
Notion is required and the runs are deterministic. Set `PLAYWRIGHT_BASE_URL` to point at
an already-running app instead. `order-form.spec.ts` also carries an **opt-in**
live-Notion smoke test guarded by `E2E_LIVE_NOTION=1` — the only path that writes to the
real Notion database.

**Production smoke tests (Playwright).** A separate, deliberately **non-mocking** suite in
`tests/smoke/*.smoke.ts` with its own config (`playwright.smoke.config.ts`) drives the
**real deployed site** (`PLAYWRIGHT_BASE_URL`, default the apex
`https://a3iceanddance.com`) to catch production breakage the mocked run can't see — a bad
deploy, a Notion/Google outage, an unshared database. Two rules keep it distinct from
`e2e/` and must hold: (1) it **never** intercepts `/api/*` and does **not** import
`e2e/support/test.ts` (whose fixture fails any unmocked call); (2) every spec is
**read-only** — health, shop inventory, the appointment catalog, an order lookup for a
nonexistent number (the real Notion 404 path), and client-side form validation, but
**never** creating an order/checkout/booking/contact message or sending an email, so it is
safe to run against production forever.

It runs **daily** at 13:00 UTC (not on every push) via `.github/workflows/smoke.yml`
(`schedule` cron

- `workflow_dispatch`) — daily rather than weekly because the suite is read-only, so
  running it often is free and it cuts worst-case detection latency for a production
  break from ~7 days to ~1. The summary **email** is still weekly (Mondays), plus
  immediately on any failure; after those runs it **emails a pass/fail report**
  (`tests/scripts/email-smoke-report.mjs`, through the app's Resend mailer — needs the
  `RESEND_API_KEY` + `RESEND_FROM_EMAIL` repo secrets, recipient `SMOKE_REPORT_TO`
  defaulting to the atelier inbox; the script self-gates and never fails the job if Resend
  is unset), built from the run's `json` reporter output. On a scheduled failure the
  workflow also opens or updates a single GitHub issue.

**Two optional repo variables sharpen the suite.** Neither is a secret (an order number
and a boolean aren't sensitive), so they are repo **variables**, not secrets:

| Variable                   | Effect when unset                                             | Effect when set                                                    |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `SMOKE_KNOWN_ORDER_NUMBER` | Falls back to the **`ORD-TEST-00000`** default in `smoke.yml` | Overrides the default with that order                              |
| `SMOKE_EXPECT_REVIEWS`     | `reviews.smoke.ts` accepts an empty list                      | `1` requires `GET /api/reviews` to return at least one testimonial |

`SMOKE_KNOWN_ORDER_NUMBER` gates the **only** spec that asserts a _successful_ data
render. Every other data spec proves "the endpoint didn't error" — a regression that broke
the success timeline (the actual payoff) would sail through an otherwise-green run. It is
therefore **defaulted in `smoke.yml`** rather than left unset: it _was_ unset for the
suite's entire life, so that spec never once ran while the job still reported green — a
check that silently doesn't exist is worse than no check, because the green tells you it
passed.

The default uses the same shape as `PLAYWRIGHT_BASE_URL`'s apex fallback in that file, and
a repo variable or secret still overrides it. What makes an order suitable as the
sentinel: **permanent** (the atelier will never delete it), already at its **final stage**
so its timeline can't shift under the test, and **studio-owned** rather than a customer's
record being polled daily. `ORD-TEST-00000` ("Toothless Dress") is Delivered, has
`Archived` ticked, and is the studio's own. Archiving is a checkbox the app never filters
on, so an archived order still resolves normally; a **cancelled** one would not suit,
because the tracking page then renders the cancelled banner instead of the timeline.

Similarly `SMOKE_EXPECT_REVIEWS=1` is worth setting once testimonials are actually live —
until then `GET /api/reviews` returning `[]` is ambiguous between "nothing published" and
"the Notion read failed", and the endpoint is degrade-safe so it cannot tell you which.

**CI.** `.github/workflows/ci.yml` runs on every pull request and push to `main`: install
→ `pnpm format:check` → `pnpm typecheck` → `pnpm build:vercel` → `pnpm test:coverage`
(both Vitest suites, reports uploaded as an artifact) → `pnpm test:e2e` (Playwright
installs its own Chromium; the mocked specs need no backend). The Playwright config prefers `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, then a
NixOS system Chromium, then Playwright's managed browser — so it runs in CI, locally, and
in the maintainer's env without edits.

## Conventions & gotchas

- **Surface customer-facing copy for review.** When adding or changing any text a
  customer will see — email subjects/bodies (`lib/resend/emails.ts`), on-site strings,
  confirmation pages — show the exact copy in the reply so the atelier can approve the
  wording before it ships. Don't quietly bury new customer-visible wording in a diff.
- **ESM only.** Server-side relative imports use explicit `.js` extensions (e.g.
  `import router from "./routes/index.js"`) even though the source is `.ts` — required so
  `@vercel/node`/Node ESM can resolve the compiled output. Don't drop the extensions.
  Frontend imports use the `@/` alias resolving to `artifacts/web-app/src`.
- **Shared dependency versions** live in the `catalog:` section of
  `pnpm-workspace.yaml`. Reference them as `"react": "catalog:"` rather than pinning per
  package.
- **`minimumReleaseAge: 1440`** — pnpm won't install package versions younger than 24h
  (supply-chain hardening). Expect this if adding a brand-new release.
- **Frontend stack:** React 19, Vite 7, Tailwind **v4** (via `@tailwindcss/vite`, no
  `tailwind.config` — config lives in `src/index.css`), wouter for routing, TanStack Query
  for data, shadcn/ui ("new-york" style) in `src/components/ui`, react-hook-form + zod for
  forms. The design is an intentionally minimal editorial/serif aesthetic — match it.
- **Navigation & page shell.** Routes are declared with wouter in `src/App.tsx`; add a
  `<Route>` for each new page (before the `NotFound` fallback). The header is a single
  global `components/navbar.tsx` rendered once in `App.tsx` — its `NAV_LINKS` array is the
  **one place** to add/rename nav links (it drives both the desktop bar and the mobile
  `Sheet` menu, and `data-testid`s are auto-derived from each label). Pages wrap their
  content in `components/page-shell.tsx`, which supplies the background, navbar clearance,
  and optional centering — follow `pages/home.tsx` as the scaffold.
- **Prettier** is the formatter (root devDependency); run `pnpm format`.
- **Order reference-image upload goes to Notion, not object storage.** The order form's
  optional reference / inspiration images ride **Notion's File Upload API**, so there is
  _no new service or env var_ — it reuses `NOTION_API_KEY`, and the images land as inline
  image blocks on the order's own Notion page. The flow: the browser downscales each
  chosen image on a canvas (`web-app/src/lib/reference-images.ts`), then POSTs the bytes
  **one at a time** to `POST /api/orders/reference-images`
  (`components/reference-image-upload.tsx`); the server (`routes/order-images.ts` →
  `lib/notion/file-uploads.repository.ts`) relays each to Notion (create → send) and
  returns a `file_upload` id; the form collects the ids and sends them as the order body's
  `referenceImageIds`, which `orders.blocks.ts` attaches as image blocks. Two load-bearing
  points: (1) the upload endpoint is a **raw-bytes route deliberately outside the OpenAPI
  contract** — hand-mounted in `app.ts` with `express.raw()` ahead of the JSON parser, and
  the frontend calls it with a plain `fetch`, not the generated client; only the
  `referenceImageIds` array is in the contract. (2) Client-side downscaling + a **4 MB
  cap** keep each request under Vercel's ~4.5 MB serverless body limit — the
  one-image-per-request design is what avoids multipart parsing and stays under it. Notion
  single-part uploads are ≤ 20 MB and must be attached within an hour (the order-create
  call does that).
- **Notion is the system of record; Postgres is a thin integrity layer.** Orders,
  inventory, invoices, and the like all live in Notion — there is no ORM and no Drizzle.
  The one relational store is the optional Supabase Postgres layer (`lib/db/`, the
  porsager `postgres` driver, raw SQL via the narrow `DbClient` seam), holding only
  app-owned integrity facts (`processed_payments`, `clients`, `order_index`) and degrading
  to no-op when unconfigured. See "Postgres".
- **Dependencies are pruned — keep them that way.** The repo shipped an unpruned
  shadcn/Replit scaffold; most of the `ui/` components and many frontend deps were dead
  weight and were deleted. When you add a shadcn component, add only the one you use;
  don't bulk-import the set. A few deps look unused but are **load-bearing** — don't
  "clean" them up: `pino-pretty` (a _string_ transport target in `logger.ts`),
  `thread-stream` (version pin for `esbuild-plugin-pino`), `@testing-library/dom`
  (required peer; `autoInstallPeers: false`), `tw-animate-css` /
  `@tailwindcss/typography` (pulled in by `src/index.css`, not by JS), and root `prettier`
  (orval's codegen calls it).
- **Reclaiming disk.** `pnpm clean` removes regenerable build output; `pnpm clean:deep`
  also prunes stale Playwright browser builds (the shared cache never evicts old ones).

## Git & deployment

- Default branch: **`main`**. Feature work happens on branches; changes reach
  `main` via pull requests.
- Do **not** open a pull request unless explicitly asked.
- Vercel deploys from the repo using `vercel.json`:
  `installCommand: pnpm install`, `buildCommand: pnpm run build:vercel`,
  output `artifacts/web-app/dist/public`, plus the `/api` rewrite, the
  www→apex redirect, and the nightly milestone cron.
- **Required Vercel env vars:** `NOTION_API_KEY`, `NOTION_ORDERS_DATABASE_ID`,
  `NOTION_CONTACT_DATABASE_ID` (the "Website Contact Messages" database that the
  `/contact` form **and** the shop's `/notify` dialog both write to),
  `NOTION_INVENTORY_DATABASE_ID` (the finished-goods "inventory" database the
  shop's `/products` endpoint reads), `NOTION_PRODUCT_CATEGORIES_DATABASE_ID` (the
  "Product Categories" database the shop resolves each product's category + size-
  guide flag from via the inventory `Category` relation — `/products` fails without
  it, there is no fallback), `NOTION_SHOP_ORDERS_DATABASE_ID` (the
  "Shop Orders" database the checkout webhook writes paid orders to — it needs an
  `Order Number` rich_text property so the shop-order-tracking lookup works), and
  `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID` (the "Production Schedule" database the
  milestone-reconciliation cron writes per-stage milestones to),
  `NOTION_INVOICES_DATABASE_ID` (the "invoices & payments" database) and
  `NOTION_INVOICE_LINE_ITEMS_DATABASE_ID` (the "Invoice Line Items" database) —
  the two the custom-order invoice flow reads to show a customer their balance —
  plus `NOTION_COSTING_DATABASE_ID` (the "costing (custom orders)" database) and
  `NOTION_MATERIAL_USAGE_DATABASE_ID` (the "material usage database") — the two
  the invoice line-item generator reads to itemize an order from its costing —
  and `NOTION_REVIEWS_DATABASE_ID` (the "Reviews" database the post-delivery
  review capture writes customer reviews to; required for that feature — the
  review endpoint errors if unset).
  The Notion integration must be shared with each database or queries 404. The
  production-schedule cron also needs `CRON_SECRET` (the bearer token Vercel Cron
  sends to `GET /api/cron/generate-milestones`; unset ⇒ that endpoint 401s). It is
  also accepted on the Notion stage-change automation webhook. It is no longer
  pasted into any Notion formula link — those became studio-dashboard tools, so the
  secret is now only ever sent as a header by a machine, and can be rotated without
  editing Notion.
  Optionally `NOTION_CLIENT_CRM_DATABASE_ID` (the "Client CRM" database): when set,
  every customer touchpoint **best-effort** upserts a client record there (deduped by
  email) and links back to it — a new custom order, a paid **shop order**, and the
  three **contact-message** writers (inquiry / back-in-stock / measurement change),
  each via a `Client` relation on its row; unset ⇒ CRM linking is skipped and those
  writes are unchanged. New clients are `Active` for buyers / order customers and
  `Lead` for inquiries and back-in-stock requests; an existing client's status is
  left untouched. Code:
  `artifacts/api-server/src/lib/notion/clients.repository.ts`
  (`upsertClientByEmail`), wired from `orders.service.ts`, `checkout.service.ts`
  (`recordPaidOrder`), and the contact/notify/measurement-change services; the
  `Client` relation is written by each domain's `*.blocks.ts`. The Shop Orders and
  Website Contact Messages databases must each have a `Client` relation to Client CRM
  (see `.agents/memory/notion-p2-duplicates.md`).
  Optionally `COLOR_PALETTE` (the intake color picker's palette): a comma-separated
  `Name #hex` list (e.g. `Emerald #0B6E4F, Rose Gold #C5878C`) served at
  `GET /api/colors`; unset ⇒ a built-in primary palette is used, so the picker always
  works. Better set as a `COLOR_PALETTE` row in the "Studio Settings" database so it's
  editable without a redeploy (see "Color selector (intake)"). Recording the customer's
  picks needs a `Colors` (multi_select) + `Color Usage` (rich_text) property on the Order
  Tracking Pipeline database. **Appointment scheduling** needs `GOOGLE_SERVICE_ACCOUNT_KEY` (the full
  service-account JSON key, with domain-wide delegation authorized for the
  Calendar scope; enable the Calendar API) for conflicts and bookings, plus
  `POSTGRES_URL` — the standing working hours are the `staff_availability` table,
  edited on the studio dashboard, so booking cannot be offered without it. It
  needs **no database id of its own**: it replaced first a Google Sheet and then a
  Notion database (see "Staff availability, edited on the dashboard"). Checkout also
  needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (the signing secret of the
  Stripe webhook endpoint), and `PUBLIC_BASE_URL` (the site origin Stripe
  redirects back to after payment — also the Supabase Auth redirect origin). The
  **customer account portal** runs on **Supabase Auth**: `SUPABASE_URL` +
  `SUPABASE_ANON_KEY` (backend, for JWT verification) and `VITE_PUBLIC_SUPABASE_URL`
  - `VITE_PUBLIC_SUPABASE_ANON_KEY` (frontend, browser sign-in) — on Vercel supplied
    by the Supabase integration; unset ⇒ the portal is inert (sign-in unavailable,
    `/account/overview` 401s). `SESSION_SECRET` is still required — it now signs only
    the appointment manage-link token (unset ⇒ those links are omitted). No database
    of our own for the portal (it reads the customer's existing Notion orders by
    email). The **Supabase Postgres** layer: `POSTGRES_URL` (pooled, runtime) +
    `POSTGRES_URL_NON_POOLING` (direct, migrations only) — also from the Supabase
    integration. Required for appointment booking (the staff working hours live there)
    and the back-in-stock sweep; the rest degrades to the pre-Postgres behavior when
    unset (Stripe idempotency falls back to the Notion read-before-write dedup). Run
    `pnpm --filter @workspace/api-server db:migrate` once to create its tables (see
    "Postgres").
    Optionally, `STRIPE_SHIPPING_RATE_IDS` — a
    comma-separated list of Stripe Shipping Rate ids (`shr_…`) to offer at shop
    checkout (unset ⇒ no shipping charged, i.e. no shipping options appear at
    checkout at all). **Mode-scoped:** the ids must be created in the same Stripe
    mode as `STRIPE_SECRET_KEY`, so map Vercel environments to modes — **Production**
    gets your **live** `shr_…` ids, **Preview/Development** get your **test** ids
    (a test-mode rate won't work with a live key, and vice-versa). The rate's
    currency must be USD to match the checkout session, or Stripe silently drops
    it. The atelier reprices by editing the rate's amount in the Dashboard (no
    redeploy); a redeploy is only needed when the ids themselves change.
    Optionally, `STRIPE_BNPL_METHODS` — a comma-separated list of buy-now-pay-later
    methods (`klarna`, `affirm`, `afterpay_clearpay`) to offer at checkout (shop
    cart + custom-order balance; deposits stay card-only). Each must also be enabled
    in the Stripe Dashboard (Settings → Payment methods) and is **mode-scoped** like
    the shipping rates. Setting it pins the session's payment methods to card + these
    (overriding dynamic payment methods on those sessions); unset ⇒ payment methods
    stay dynamic (Dashboard-managed), unchanged. See "Working with Stripe". Customer
    notification emails also require
    `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (the verified sender, e.g.
    `A.A Atelier <orders@a3iceanddance.com>`). The sending domain must be verified in
    Resend (SPF/DKIM) or mail won't deliver. A missing/failed mailer is
    non-fatal: the send is best-effort and the endpoints still succeed.
    Optionally `ATELIER_INBOX_EMAIL` (e.g. `orders@a3iceanddance.com`) to also receive an
    internal notification for each new order / contact message / back-in-stock
    request; leave it unset to skip those. Optionally `RESEND_CONTACT_FROM_EMAIL` and
    `ATELIER_CONTACT_INBOX_EMAIL` (e.g. `hello@a3iceanddance.com`) to send/receive
    contact-form mail from a separate address; each falls back to the base
    `RESEND_FROM_EMAIL` / `ATELIER_INBOX_EMAIL` when unset (same verified domain, no
    extra Resend setup). Appointment mail has the same optional overrides
    (`RESEND_APPOINTMENTS_FROM_EMAIL` / `ATELIER_APPOINTMENTS_INBOX_EMAIL`).
    Optionally `RESEND_AUDIENCE_ID` (a Resend **Marketing** Audience id): when set,
    each newsletter opt-in is also synced into that Resend Audience — the mailing
    list + unsubscribe authority campaigns (Resend **Broadcasts**, sent from the
    dashboard) go out against; unset ⇒ the sync is skipped and the opt-in is still
    captured in Notion. Free up to 1,000 contacts (the Marketing track bills apart
    from transactional above that).
- **Optional appointment-booking policy env vars:** `APPOINTMENT_TIMEZONE`
  (IANA zone for working hours/slots, default `America/Chicago`),
  `APPOINTMENT_MIN_LEAD_HOURS` (24), `APPOINTMENT_MAX_ADVANCE_DAYS` (45),
  `APPOINTMENT_SLOT_STEP_MINUTES` (15), and `APPOINTMENT_REMINDER_LEAD_DAYS` (1 —
  how many local days ahead the reminder sweep looks; a value below 1 falls back
  to the default rather than becoming a morning-of note). All have defaults, and
  all five are Studio-Settings tunables.
- **Optional measurement-change env var:** `MEASUREMENT_LOCK_FROM_STAGE` (default
  `Cutting/Pinning`) — the live **Stage** option at/after which an order's
  measurements are frozen and `POST /orders/:n/measurement-change-requests` is
  rejected. Like `STATUS_IN_STOCK`, this names a specific option value (a targeted
  business rule), so if the atelier renames that stage in Notion, set this override.
  Read in `services/measurement-lock.ts` (`measurementsLocked()`), enforced by
  `services/measurement-change.service.ts`.
- **Optional rush-surcharge env vars:** _frontend, build-time_ —
  `VITE_RUSH_WINDOW_DAYS` (default `21`, a needed-by date within this many days of
  today marks a custom order as a rush) and `VITE_RUSH_SURCHARGE_NOTE` (default
  `"a 15% rush surcharge"`, the disclosure copy on the order form), both read in
  `web-app/src/lib/rush.ts`; _server, runtime_ — `RUSH_SURCHARGE_RATE` (default
  `0.15`), the fraction of the itemized subtotal the invoice generator prices the
  rush `Surcharge` line at (`0` disables it), read in `services/rush.ts`. Keep the
  frontend copy and the server rate in step (see "Rush order surcharge").
- **Optional reward env vars:** `REFERRAL_CREDIT_AMOUNT` (default `40`, the dollars a
  referred skater's first paid order credits the referrer), `REFERRAL_WELCOME_PERCENT`
  (default `10`, the new skater's welcome discount), `RETURNING_DISCOUNT_PERCENT`
  (default `10`, the standing repeat-customer discount), and `REWARD_CODE_EXPIRES_DAYS`
  (default `90`, how long a one-time reward code stays redeemable). All are Studio-
  Settings tunables (Notion → env → default), read in `services/rewards.service.ts`.
  No new env var is required — the feature reuses the CRM + Stripe + Resend (see
  "Referral & returning-skater rewards"). One-time: add the seven reward properties to
  the Client CRM database.
- **Optional live-config database:** `NOTION_SETTINGS_DATABASE_ID` (the "Studio
  Settings" key/value database). When set (and the integration is shared with it),
  the atelier can retune the runtime business tunables — `RUSH_SURCHARGE_RATE`,
  `MEASUREMENT_LOCK_FROM_STAGE`, the five `APPOINTMENT_*` policy vars, the four
  reward amounts, `COLOR_PALETTE` (the intake color picker's palette), and the
  notification inboxes (`ATELIER_INBOX_EMAIL`, `ATELIER_CONTACT_INBOX_EMAIL`,
  `ATELIER_APPOINTMENTS_INBOX_EMAIL`, `ALERT_INBOX_EMAIL`) — from the studio
  dashboard's **Studio settings** editor (or the Notion rows directly) instead of
  Vercel; each still falls back to its env var, then the built-in default. Unset ⇒
  env-only, exactly as before, and the editor says so rather than offering a Save
  with nowhere to write. Secrets, database ids, and email **senders** stay in
  Vercel by design (see "Studio Settings" and "Studio settings, edited on the
  dashboard").
- **Optional fitting-reminder env vars:** `FITTING_REMINDER_STAGES` (default
  `Fitting`) — the live **Stage** option name(s), comma-separated, that trigger an
  automated fitting reminder; and `FITTING_REMINDER_LEAD_DAYS` (default `10`) — how
  many days ahead of a fitting milestone's target date to email. Both are targeted
  business rules like `MEASUREMENT_LOCK_FROM_STAGE`; read in
  `services/fitting-reminder.ts`, consumed by `sendDueFittingReminders` in
  `services/schedule.service.ts`. One-time: add a `Reminder Sent` checkbox to the
  Production Schedule database. See "Automated fitting reminders" above.
- **Optional payment-reminder env var:** `PAYMENT_REMINDER_LEAD_DAYS` (default `7`) —
  how many days ahead of an invoice deposit/balance due date to email the customer a
  payment reminder (the same `on_or_before` cutoff also catches already-overdue
  stages). A targeted business rule like `FITTING_REMINDER_LEAD_DAYS`; read in
  `services/payment-reminder.ts`, consumed by `sendDuePaymentReminders` in
  `services/schedule.service.ts`. One-time on the invoices & payments database: add
  `First Deposit Due` / `Second Deposit Due` (date) — the balance reuses the existing
  `Payment Deadline` — plus `First Deposit Reminded` / `Second Deposit Reminded` /
  `Balance Reminded` checkboxes. See "Payment & deposit due reminders" above.
- **Optional staff-access env var:** `STUDIO_STAFF_EMAILS` — a comma-separated
  allowlist of the email addresses that may reach the internal studio dashboard
  (`/studio` + `GET /api/studio/analytics`). Staff sign in through the same
  Supabase Auth flow customers use; this promotes their address to studio access.
  **Fails closed:** unset ⇒ nobody is staff and the dashboard 404s for everyone.
  Matching is case-insensitive. Deliberately env-only (**not** a Studio Settings
  key) — it's access control, not a business tunable. Read fresh from env in
  `lib/staff.ts`. See "Studio analytics dashboard" above.
- **Optional staff sign-in-method env var:** `STUDIO_REQUIRE_GOOGLE` (**default
  on**) — whether a studio session must have been established with Google. Set it
  to `false`/`0`/`no`/`off` to accept any sign-in method; that's the recovery
  hatch if Google sign-in is ever unavailable, not a normal setting. Read fresh
  from env in `lib/staff.ts`, env-only for the same reason as the allowlist. See
  "Studio analytics dashboard" above.
- **Optional anti-spam env var:** `SPAM_MIN_FILL_MS` (default `2000`) — the minimum
  plausible human fill time, in ms, for the public submission forms (contact /
  notify / newsletter); a faster submit is silently dropped as a bot. `0` disables
  the timing check (the hidden honeypot still applies). Read fresh from env in
  `middlewares/spam-filter.ts`; **not** a Studio-Settings key. No other setup — the
  honeypot + per-IP submission rate limit need no config. See "Invisible anti-spam".
- **Optional relation-links env var:** `NOTION_RELATION_LINKS` (default off; set to
  `1` / `true` / `yes`) — the Phase-2 "relate, don't just name" workspace cards. When
  on, the customer-request writers link the row to the order it concerns via a real
  Notion relation (instead of only naming it in free text), and a paid shop order
  links to the inventory rows purchased. Read fresh from env in
  `services/request-links.ts` (`relationLinksEnabled()`). Gated because the app writes
  to **existing** Notion properties — writing a relation property that doesn't exist
  400s the whole page-create — so the property must exist first. Unset ⇒ no relation is
  written and the behavior is exactly as before (degrade-safe, like the `Client` link).
  See "Relate requests & orders to their sources" below.
- **Optional materials database:** `NOTION_MATERIALS_DATABASE_ID` (the "materials
  inventory" database). When set (and the integration is shared with it), the
  studio dashboard's **Materials** panel lists everything at or below its
  `Minimum Stock`, and the nightly reconciliation emails a weekly digest of the
  same list. Read-only — the app never writes materials stock. Unset ⇒ the panel
  reports it isn't connected and the digest no-ops. The one knob is
  `MATERIALS_DIGEST_WEEKDAY` (default `Monday`, a long weekday name read in the
  studio timezone), a targeted business rule like `FITTING_REMINDER_STAGES`. See
  "Materials restock alerts" above.
- **Optional order-lines database:** `NOTION_ORDER_LINES_DATABASE_ID` (the "order
  lines" database). When set (and the integration is shared with it), a paid shop
  order writes one line row per purchased item, which is what moves inventory's
  `Units Sold (auto)` rollup and so `Quantity Available` — the shop's automatic
  stock decrement. Unset ⇒ no lines are written and stock stays manual, exactly as
  before (the order itself is recorded either way). Read at first use in
  `getOrderLinesNotionClient`; gated by `orderLinesConfigured()`. See "Automatic
  shop inventory decrement" above.

### Environment variables

The Notion integration must be **shared with each database** or queries 404.

**Required**

| Variable                                                    | Purpose                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `NOTION_API_KEY`                                            | Notion integration token                                                                                                                   |
| `NOTION_ORDERS_DATABASE_ID`                                 | Order Tracking Pipeline (custom orders)                                                                                                    |
| `NOTION_CONTACT_DATABASE_ID`                                | "Website Contact Messages" — all six request-type writers                                                                                  |
| `NOTION_INVENTORY_DATABASE_ID`                              | Shop inventory read by `/products`                                                                                                         |
| `NOTION_PRODUCT_CATEGORIES_DATABASE_ID`                     | Product Categories — `/products` fails without it, there is no fallback                                                                    |
| `NOTION_SHOP_ORDERS_DATABASE_ID`                            | Shop Orders (needs an `Order Number` rich_text property for tracking)                                                                      |
| `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`                    | Production Schedule the milestone cron writes to                                                                                           |
| `NOTION_INVOICES_DATABASE_ID`                               | "invoices & payments"                                                                                                                      |
| `NOTION_INVOICE_LINE_ITEMS_DATABASE_ID`                     | "Invoice Line Items"                                                                                                                       |
| `NOTION_COSTING_DATABASE_ID`                                | "costing (custom orders)" — read by the line-item generator                                                                                |
| `NOTION_MATERIAL_USAGE_DATABASE_ID`                         | Material usage — read by the line-item generator                                                                                           |
| `NOTION_REVIEWS_DATABASE_ID`                                | Reviews — the review endpoint errors if unset                                                                                              |
| `CRON_SECRET`                                               | Bearer token for the cron/webhook/button routes; also the `?secret=` query token                                                           |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                | Checkout + the signed webhook                                                                                                              |
| `PUBLIC_BASE_URL`                                           | Site origin for Stripe redirects, Supabase Auth redirects, and email links                                                                 |
| `SESSION_SECRET`                                            | Signs the appointment manage-link token (unset ⇒ those links are omitted)                                                                  |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`                       | Customer email. The sending domain must be verified in Resend (SPF/DKIM). A missing/failed mailer is non-fatal — sends are best-effort     |
| `GOOGLE_SERVICE_ACCOUNT_KEY`                                | Full service-account JSON key, domain-wide delegation for the Calendar scope                                                               |
| `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`                  | Staff working hours + back-in-stock markers. Pooled at runtime, direct for `db:migrate`. Other callers degrade when unset; these two don't |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`                         | Backend JWT verification for the account portal                                                                                            |
| `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY` | Frontend browser sign-in                                                                                                                   |

Unset Supabase vars ⇒ the portal is inert (sign-in unavailable, `/account/overview`
401s). The Google integration needs only the **Calendar** API — the Sheets API and its
scope went with the working-hours sheet.

**Optional**

| Variable                                                                                                          | Effect when unset                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `NOTION_CLIENT_CRM_DATABASE_ID`                                                                                   | CRM linking + all reward paths are skipped                          |
| `NOTION_SETTINGS_DATABASE_ID`                                                                                     | Studio Settings is env-only (see "Studio Settings")                 |
| `NOTION_ORDER_LINES_DATABASE_ID`                                                                                  | No order lines written ⇒ shop stock never decrements                |
| `NOTION_MATERIALS_DATABASE_ID`                                                                                    | No materials panel (`configured: false`) and no weekly digest       |
| `MATERIALS_DIGEST_WEEKDAY`                                                                                        | `Monday` (read in the studio timezone)                              |
| `NOTION_RELATION_LINKS` (`1`/`true`/`yes`)                                                                        | Off — no order/inventory relations written (see "Relate requests…") |
| `STRIPE_SHIPPING_RATE_IDS`                                                                                        | No shipping charged, no shipping options at checkout                |
| `STRIPE_BNPL_METHODS`                                                                                             | Payment methods stay dynamic (Dashboard-managed)                    |
| `ALERT_INBOX_EMAIL`                                                                                               | Defaults to `alexandra@a3iceanddance.com`                           |
| `ATELIER_INBOX_EMAIL`                                                                                             | No internal atelier notifications                                   |
| `RESEND_CONTACT_FROM_EMAIL`, `ATELIER_CONTACT_INBOX_EMAIL`                                                        | Falls back to the base sender/inbox                                 |
| `RESEND_APPOINTMENTS_FROM_EMAIL`, `ATELIER_APPOINTMENTS_INBOX_EMAIL`                                              | Falls back to the base sender/inbox                                 |
| `RESEND_AUDIENCE_ID`                                                                                              | Newsletter sync skipped; the opt-in is still captured in Notion     |
| `APPOINTMENT_TIMEZONE`                                                                                            | `America/Chicago`                                                   |
| `APPOINTMENT_MIN_LEAD_HOURS` / `_MAX_ADVANCE_DAYS` / `_SLOT_STEP_MINUTES`                                         | `24` / `45` / `15`                                                  |
| `APPOINTMENT_REMINDER_LEAD_DAYS`                                                                                  | `1` (the day before)                                                |
| `MEASUREMENT_LOCK_FROM_STAGE`                                                                                     | `Cutting/Pinning`                                                   |
| `RUSH_SURCHARGE_RATE`                                                                                             | `0.15` (`0` disables the surcharge line)                            |
| `VITE_RUSH_WINDOW_DAYS`, `VITE_RUSH_SURCHARGE_NOTE` (build-time)                                                  | `21`, `"a 15% rush surcharge"`                                      |
| `FITTING_REMINDER_STAGES`, `FITTING_REMINDER_LEAD_DAYS`                                                           | `Fitting`, `10`                                                     |
| `PAYMENT_REMINDER_LEAD_DAYS`                                                                                      | `7`                                                                 |
| `REFERRAL_CREDIT_AMOUNT` / `REFERRAL_WELCOME_PERCENT` / `RETURNING_DISCOUNT_PERCENT` / `REWARD_CODE_EXPIRES_DAYS` | `40` / `10` / `10` / `90`                                           |
| `SPAM_MIN_FILL_MS`                                                                                                | `2000` (`0` disables the timing check)                              |
| `PINTEREST_DOMAIN_VERIFY` (build-time)                                                                            | No `p:domain_verify` tag at all                                     |

Several of these are also **Studio-Settings tunables** editable in Notion — see that
section for the full `SETTING_KEYS` list and the Notion → env → default resolution order.

**Stripe env vars are mode-scoped.** `STRIPE_SHIPPING_RATE_IDS` and
`STRIPE_BNPL_METHODS` must match the mode of `STRIPE_SECRET_KEY`, so map Vercel
environments to modes: **Production** gets live values, **Preview/Development** gets test
ones. A shipping rate's currency must be USD to match the checkout session or Stripe
silently drops it; the atelier reprices by editing the rate's amount in the Dashboard (no
redeploy) — a redeploy is only needed when the ids change.

## Relate requests & orders to their sources

Notion rows carry a real **relation** to the thing they concern, so the atelier can click
through and totals roll up, instead of only naming them in free text. All the relation
**writes** are gated behind `NOTION_RELATION_LINKS` — the app writes to **existing**
Notion properties, and writing a relation property that doesn't exist 400s the whole
page-create, so the property must exist first. Unset ⇒ no relation is written and the
behavior is exactly as before.

1. **Requests → their order** (measurement-change / cancellation / return / review). Each
   writer threads the order's Notion page id (the verification lookups
   `findOrderVerification` / `findShopOrderVerification` return `pageId`) and, when
   enabled, sets a relation: a **custom**-order request links `Order` → Custom Orders, a
   **shop**-order request links `Shop Order` → shop orders (both on Website Contact
   Messages), and a **review** links `Order` → Custom Orders on the Reviews db. Helpers:
   `contactOrderRelation` (`lib/notion/contact.blocks.ts`, mirroring
   `contactClientRelation`) and the inline `Order` write in `reviews.blocks.ts`. Custom
   Orders carries an **Open Requests** rollup over the back-relation.
2. **Shop orders → inventory rows.** `checkout.service.ts` stamps each cart line's
   `variantId` (the inventory Notion page id) onto the Stripe line's
   `price_data.product_data.metadata` (always on — harmless); the webhook retrieves the
   session with `expand: ["line_items.data.price.product"]`, recovers the deduped
   inventory ids, and (when enabled) writes them to the shop order's **`Inventory Items`**
   relation (`SHOP_ORDER_ITEMS_PROPERTY`, additive alongside the existing text bullets).
   inventory carries a **Times Ordered** rollup.
3. **No redundant invoice link.** Generated invoice line items do **not** write an `Order`
   relation — it was redundant with the invoice's own `Order`, and nothing read it. The
   stale `Order` property on the **Invoice Line Items** database can be deleted in Notion.
4. **Backfill for legacy rows.** `src/scripts/backfill-legacy-fields.ts`
   (`pnpm --filter @workspace/api-server db:backfill-legacy [-- --dry-run]`) is a one-time,
   idempotent backfill: it recovers a legacy custom order's `Email` + measurements from its
   page **body** blocks and stamps the typed properties, and stamps a deterministic
   `SHP-LEGACY-…` `Order Number` on legacy shop orders that lack one (so they surface in
   the email-keyed account portal). Needs `NOTION_API_KEY` + the order/shop-order database
   ids in env; run it out-of-band, like `db:backfill`.

**Atelier setup (done in Notion; enable with `NOTION_RELATION_LINKS=1`):** an `Order`
(→ Custom Orders) + `Shop Order` (→ shop orders) relation on Website Contact Messages; an
`Order` (→ Custom Orders) relation on Reviews; an `Inventory Items` (→ inventory) relation
on shop orders; the five measurement number properties + `Measurement Unit` select on
Custom Orders; plus the `Open Requests` and `Times Ordered` count rollups.

## Workspace record hygiene (Notion configuration the app never reads)

Additive Notion configuration with no code behind it. Two facts here are load-bearing;
full detail in `.agents/memory/phase2-workspace-crm-archive-markers.md`.

- **Order archiving is a `checkbox`, NEVER a `Stage` option.** Custom Orders and shop
  orders carry an `Archived` checkbox + `Active Orders` / `Archived` views. It must stay a
  separate property because the app reads `Stage` **positionally** —
  `orderDelivered()` treats the **last** live stage as "delivered" (review gate, schedule,
  portal). An "Archived" **Stage** after "Delivered" would silently become the delivered
  position and break all three. Nothing in the app filters on `Archived`.
- **The Custom Orders template pre-fills `Stage` + `Measurement Unit`.**
  `buildOrderProperties` deliberately **omits `Stage`** on create (a new page inherits
  Notion's Stage status default) and writes `Measurement Unit` **only when measurements
  are supplied** — so a hand-keyed order can miss the unit the account portal reads back.
  The database template defaults `Stage = Consultation` and `Measurement Unit = inches`.
  Don't rely on this in code — it's an atelier convenience, not an app guarantee.
- **Client CRM reads as a customer record.** Rollups over the order relations —
  `Order Count`, `Lifetime Value`, `Paid to Date`, `First/Last Order Date`,
  `Shop Order Count`, `Shop Revenue`, and the blended `Total Orders` /
  `Total Lifetime Value`. The app reads **none** of these (`clients.repository.ts` reads
  only email / status / last-contact / reward fields), so they're safe to retune.
- **App-owned markers are corralled out of the working views** (Last Notified Stage,
  Milestones Generated, Stage Index Sys, Reminder Sent, the reward flags, Stripe session
  ids). The curated views hide them; the collapsed "🔧 System" property group is a UI-only
  runbook step (property groups aren't API-reachable).

### The Studio Operations home page (Notion, linked views only)

**🧭 Studio Operations** is the atelier's daily Notion page — a child of
**{ A.A. Atelier }** and the first entry in its Navigation callout — gathering the four
things that need working down: **orders due**, **milestones running late**, **new
reviews**, and **open requests**. It is **linked views only**: no code, no property, no
env var, and **no change to any source database or its own views**. Full detail, live ids
and the verification notes are in `.agents/memory/studio-operations-page.md`.

Three things about it are load-bearing:

- **It reads and edits rows; `/studio` acts.** Figures, refunds, the review queue and the
  five tools stay on the website dashboard, which is the only place money moves. The
  Notion page is deliberately the surface for editing the rows themselves, and says so in
  its own copy so the two don't drift into competing dashboards.
- **Nothing filters on a date being "before today", and nothing filters on
  `Milestone Status`.** The view DSL accepts `< "today"` and then matches **zero rows**
  without erroring, and a filter on the rollup-derived `Milestone Status` formula compiles
  to an untypeable `every` shape — the view-filter face of the API-query 400 in
  `phase2-workspace-cards.md`. So the milestones section **sorts** by target date and
  shows `Milestone Status` as a column to read by eye. Don't "fix" this by adding either
  filter; verify any new filter by querying the view back before trusting it.
- **Six option names are baked into its filters** — the order Stage `Delivered`, the
  review statuses `Published` / `Archived` / `Rejected`, and the request `Stage`=`Closed`
  / `Request type`=`Newsletter`. A Notion rename makes rows silently appear or vanish
  there, exactly as it does to the matching constants in code.

## Quick reference — where things live

| I want to…                                               | Go to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change an API request/response shape                     | `lib/api-spec/openapi.yaml` → run codegen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Change order use-case logic                              | `artifacts/api-server/src/services/orders.service.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Change Notion I/O                                        | `artifacts/api-server/src/lib/notion/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Change a customer email / template                       | `artifacts/api-server/src/lib/resend/*` (`emails.ts` copy, `send.ts` transport, `client.ts` config)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Add/modify an API route                                  | `artifacts/api-server/src/routes/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Add request validation / error mapping                   | `artifacts/api-server/src/middlewares/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Change the order-tracking UI (custom + shop)             | `artifacts/web-app/src/pages/track.tsx` (unified lookup) + `components/custom-order-result.tsx` + `components/shop-order-result.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Change the order intake form                             | `artifacts/web-app/src/pages/order-form.tsx` — then carry the new field through to Notion + both emails (see "What the intake records"): `lib/notion/orders.{schema,blocks}.ts` for the property + page-body write, and `orderDetailFields` in `lib/resend/emails.ts` for both emails at once                                                                                                                                                                                                                                                                                                                                                                                                 |
| Change which service an order can be placed for          | `api-server/src/lib/service-catalog.ts` (the catalog + its gates) + `routes/services.ts` (`GET /services`) + `enforceServiceGate` in `services/orders.service.ts`; frontend `web-app/src/lib/order-services.ts` (the fallback + deep-link resolution) + the picker and conditional sections in `pages/order-form.tsx` + the per-card links in `pages/services.tsx`; write-back via `ORDER_SERVICE_PROPERTY` in `lib/notion/orders.{schema,blocks}.ts` and the `Service` row in `orderDetailFields` (`lib/resend/emails.ts`)                                                                                                                                                                   |
| Change the color selector (intake)                       | `artifacts/web-app/src/components/color-picker.tsx` + `pages/order-form.tsx` (frontend, step 2 of the three-step flow); `api-server/src/services/colors.ts` (`intakeColorPalette`/`parseColorPalette` + the built-in default) + `routes/colors.ts` (`GET /api/colors`, the `COLOR_PALETTE` Studio Settings value); `lib/notion/orders.{schema,blocks}.ts` (write-back to the order's `Colors` + `Color Usage`)                                                                                                                                                                                                                                                                                |
| Change the rush order surcharge                          | `artifacts/web-app/src/lib/rush.ts` (window + disclosure) + `pages/order-form.tsx` (detect/acknowledge/send); `api-server/src/lib/notion/orders.blocks.ts` + `orders.schema.ts` (`Rush Order` record); `api-server/src/services/rush.ts` + `services/invoice-generator.service.ts` (server-priced "Surcharge" line); `web-app/src/lib/invoice-format.ts` ("Surcharge" line display)                                                                                                                                                                                                                                                                                                           |
| Change referral & returning-skater rewards               | `api-server/src/services/rewards.service.ts` (engine + amount getters) + `lib/stripe/promotions.ts` (`createDiscountCode`) + `lib/notion/clients.repository.ts` (reward reads + `patchClientProperties`); wired from `submitOrder` (capture) + `recordPaidOrder` / `recordPayment` (issue); reward emails in `lib/resend/emails.ts`; `services/account.service.ts` + `web-app/src/pages/account.tsx` (referral card) + `pages/order-form.tsx` (`referralCode` field)                                                                                                                                                                                                                          |
| Add/read an atelier-editable live setting                | `api-server/src/lib/settings/catalog.ts` (`SETTING_DEFINITIONS` — the typed entry the dashboard renders) + `lib/settings/store.ts` (`settingValue`) + `lib/notion/settings.{schema,repository}.ts` (Notion read/write); consume with `settingValue(KEY) ?? process.env[KEY] ?? default` (see `services/rush.ts`); primed by the middleware in `app.ts`. Notion "Studio Settings" DB, `NOTION_SETTINGS_DATABASE_ID`                                                                                                                                                                                                                                                                            |
| Change the measurement-change request                    | `artifacts/web-app/src/components/measurement-change-dialog.tsx` (opened from `components/custom-order-result.tsx`); `api-server/src/services/measurement-change.service.ts` + `routes/orders.ts` + `lib/notion/measurement-change.{blocks,repository}.ts` (writes to the **contact** database)                                                                                                                                                                                                                                                                                                                                                                                               |
| Change the studio settings editor                        | `web-app/src/components/studio-settings.tsx` (rendered by `pages/studio.tsx`); `services/studio-settings.service.ts` + the `/studio/settings` handlers in `routes/studio.ts` + `lib/settings/catalog.ts` (the per-key definition + its two validators) + `fetchSettingRows` / `saveSetting` in `lib/notion/settings.repository.ts`                                                                                                                                                                                                                                                                                                                                                            |
| Change review moderation on the dashboard                | `web-app/src/components/studio-reviews.tsx` (rendered by `pages/studio.tsx`); `services/studio-reviews.service.ts` + the `/studio/reviews` handlers in `routes/studio.ts` + the moderation half of `lib/notion/reviews.{schema,repository}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Change the customer-request queue on the dashboard       | `web-app/src/components/studio-requests.tsx` + `lib/studio-handoff.ts` (the hand-off into `components/studio-tools.tsx`), rendered by `pages/studio.tsx`; `services/studio-requests.service.ts` + the `/studio/requests` handlers in `routes/studio.ts` + `lib/notion/requests.{schema,repository}.ts` — which tool actions which kind lives in `requestAction`                                                                                                                                                                                                                                                                                                                               |
| Change the newsletter panel on the dashboard             | `web-app/src/components/studio-newsletter.tsx` (rendered by `pages/studio.tsx`); `services/studio-newsletter.service.ts` + the `/studio/newsletter` handlers in `routes/studio.ts` + the newsletter half of `lib/notion/requests.{schema,repository}.ts` + the read side of `lib/resend/audience.ts` (`listAudienceContacts` / `membershipIn` — membership is never stored)                                                                                                                                                                                                                                                                                                                   |
| Change post-delivery review capture                      | `artifacts/web-app/src/components/review-dialog.tsx` (opened from `components/custom-order-result.tsx` for delivered orders); `api-server/src/services/review.service.ts` + `services/delivery.ts` + `routes/orders.ts` + `lib/notion/reviews.{blocks,repository}.ts` (writes to the **Reviews** database)                                                                                                                                                                                                                                                                                                                                                                                    |
| Change the published testimonials                        | `artifacts/web-app/src/components/testimonials.tsx` (rendered by `pages/home.tsx` + `pages/about.tsx`); `getPublishedReviews` in `api-server/src/services/review.service.ts` + `routes/reviews.ts` + `lib/notion/reviews.schema.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Change the studio's daily Notion ops page                | The **🧭 Studio Operations** page under **{ A.A. Atelier }** — four linked views over Custom Orders / Production Schedule / Reviews / Website Contact Messages; no code; see `.agents/memory/studio-operations-page.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Curate which reviews show on the site                    | The **Reviews** Notion database's saved views (Curate / Live on the site / Awaiting curation / Published but not showing) — no code; see `.agents/memory/reviews-curation-views.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Change order cancellation & refunds                      | `artifacts/web-app/src/components/cancellation-request-dialog.tsx` (rendered by `components/custom-order-result.tsx` + `shop-order-result.tsx`); customer request in `api-server/src/services/cancellation.service.ts` + `routes/orders.ts` + `routes/shop-orders.ts` + `lib/notion/cancellation.{blocks,repository}.ts` (writes to the **contact** database); atelier refund in `services/order-cancellation.service.ts` + the `cancellation-refund` studio tool (`services/studio-tools.service.ts`) + the `Cancelled`/`setOrderCancelled`/`setShopOrderCancelled` writers                                                                                                                  |
| Change the landing page                                  | `artifacts/web-app/src/pages/home.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Change the shop (live Notion inventory)                  | `artifacts/web-app/src/pages/shop.tsx` + `services/products.service.ts` + `lib/notion/products.*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Change the back-in-stock notify dialog                   | `artifacts/web-app/src/components/notify-dialog.tsx` + `services/notify.service.ts` + `lib/notion/notify.*` (writes to the **contact** database — see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Change the materials restock alerts                      | `api-server/src/services/materials.service.ts` (the pure `classifyMaterials` + `getMaterialsOverview`) + `lib/notion/materials.{schema,repository}.ts` + `getMaterialsNotionClient` + the `/studio/materials` route in `routes/studio.ts`; the weekly email is `services/materials-digest.service.ts` + `materialsDigestEmail` in `lib/resend/emails.ts`, run by `sendDueMaterialsDigest` in `services/schedule.service.ts`; panel in `web-app/src/components/studio-materials.tsx`                                                                                                                                                                                                           |
| Change the shop's inventory decrement                    | `api-server/src/services/order-lines.service.ts` (`purchasedLinesFromSession` + the best-effort `recordShopOrderLines`) + `lib/notion/order-lines.{blocks,repository}.ts` + `getOrderLinesNotionClient`; called at the tail of `processPaidShopOrder` in `services/checkout.service.ts`. The `Voided` release is `setShopOrderCancelled` in `lib/notion/shop-orders.repository.ts`                                                                                                                                                                                                                                                                                                            |
| Change shop checkout / payments                          | `artifacts/web-app/src/lib/cart.tsx` + `components/cart-drawer.tsx` + `components/add-to-cart.tsx` (frontend); `api-server/src/services/checkout.service.ts` + `routes/checkout.ts` + `routes/stripe-webhook.ts` + `lib/stripe/*` + `lib/notion/shop-orders.*` (backend)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Change shop-order tracking                               | `artifacts/web-app/src/components/shop-order-result.tsx` (rendered by `pages/track.tsx`; + order number on `pages/shop-success.tsx`); `api-server/src/services/shop-orders.service.ts` + `routes/shop-orders.ts` + `lib/notion/shop-orders.{blocks,repository}.ts` + `services/checkout.service.ts` (mints the number)                                                                                                                                                                                                                                                                                                                                                                        |
| Change the return / exchange request                     | `artifacts/web-app/src/components/return-exchange-dialog.tsx` (opened from `components/shop-order-result.tsx`); `api-server/src/services/return-request.service.ts` + `routes/shop-orders.ts` (`POST /shop-orders/:n/return-requests`) + `lib/notion/return-request.{blocks,repository}.ts` (writes to the **contact** database) + `findShopOrderVerification` in `lib/notion/shop-orders.repository.ts`; policy copy in `pages/shipping-returns.tsx`                                                                                                                                                                                                                                         |
| Change return / exchange refunds (atelier action)        | `api-server/src/services/return-refund.service.ts` (the target-total refund engine + `parseRefundTarget`) + the `return-refund` studio tool (`services/studio-tools.service.ts`) + `lib/stripe/refunds.ts` (shared Stripe refund primitives) + `recordShopOrderRefund` / `SHOP_ORDER_REFUNDED_PROPERTY` / `SHOP_ORDER_RETURN_PROCESSED_PROPERTY` in `lib/notion/shop-orders.{repository,blocks}.ts` + `returnRefundEmail` in `lib/resend/emails.ts`                                                                                                                                                                                                                                           |
| Change the footer / legal pages                          | `artifacts/web-app/src/components/footer.tsx` (global, in `App.tsx`) + `pages/{privacy,terms,shipping-returns}.tsx` + `components/legal-page.tsx`; shared studio contact details in `lib/contact-info.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Change custom-order payments (deposits + balance)        | `artifacts/web-app/src/components/custom-order-result.tsx` (`DepositsSection`, rendered by `pages/track.tsx`) + `pages/invoice.tsx`; `api-server/src/services/invoice.service.ts` (`createPaymentCheckout`/`recordPayment`) + `routes/orders.ts` (`POST /orders/:n/payments/:stage`) + `lib/notion/invoice.{schema,repository}.ts` + `routes/stripe-webhook.ts`                                                                                                                                                                                                                                                                                                                               |
| Change invoice line-item generation (from costing)       | `api-server/src/services/invoice-generator.service.ts` + the `invoice-lines` studio tool (`services/studio-tools.service.ts`) + `lib/notion/costing.{schema,repository}.ts` + `lib/notion/invoice-line-items.blocks.ts` + `createInvoiceLineItem`/`setInvoiceTitle` in `lib/notion/invoice.repository.ts`                                                                                                                                                                                                                                                                                                                                                                                     |
| Change production-schedule milestones                    | `api-server/src/services/schedule.service.ts` + `routes/cron.ts` + `lib/notion/production-schedule.{blocks,repository}.ts` + `lib/notion/orders.repository.ts` (`findOrdersNeedingMilestones`/`markMilestonesGenerated`); cron in `vercel.json`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Change order status-change emails (+ pipeline graphic)   | `api-server/src/lib/resend/emails.ts` (`orderStageChangeEmail`) + `services/order-notification.service.ts` + `routes/order-notification.ts` + `lib/notion/orders.repository.ts` (`findOrderForStageNotification`); Notion automation → `POST /api/webhooks/notion-stage-change`; on-demand send via the `status-email` studio tool                                                                                                                                                                                                                                                                                                                                                            |
| Change back-in-stock alerts                              | `services/restock-notification.service.ts` + `services/restock.ts` + `sendDueRestockAlerts` in `services/schedule.service.ts` + `claimRestockAlert` in `lib/db/restock-alerts.repository.ts` + `findPendingBackInStockRequests` in `lib/notion/notify.repository.ts`; the on-demand run is the `restock-alert` studio tool                                                                                                                                                                                                                                                                                                                                                                    |
| Change day-before appointment reminders                  | `lib/appointments/reminders.ts` (window, per-channel markers, `whenPhrase`) + `services/appointment-reminder.service.ts` (the sweep) + `sendDueAppointmentReminders` in `services/schedule.service.ts` + `listAppointmentsInRange` / `markAppointmentReminded` / the `aptPhone` stamp in `lib/google/calendar.repository.ts` + `appointmentReminderEmail` in `lib/resend/emails.ts`; runs in the milestone cron                                                                                                                                                                                                                                                                               |
| Change automated fitting reminders                       | `api-server/src/services/schedule.service.ts` (`sendDueFittingReminders`) + `services/fitting-reminder.ts` (env business rule) + `lib/notion/production-schedule.{blocks,repository}.ts` (`findMilestonesNeedingFittingReminder`/`markFittingReminderSent`, `Reminder Sent` prop) + `fittingReminderEmail` in `lib/resend/emails.ts`; runs in the milestone cron                                                                                                                                                                                                                                                                                                                              |
| Change payment & deposit due reminders                   | `api-server/src/services/schedule.service.ts` (`sendDuePaymentReminders`) + `services/payment-reminder.ts` (env business rule) + `lib/notion/invoice.repository.ts` (`findInvoicesNeedingPaymentReminder`/`markPaymentStageReminded`) + `extractPaymentReminderInvoice` + `PAYMENT_STAGE_REMINDER_FIELDS` in `lib/notion/invoice.schema.ts` + `paymentReminderEmail` in `lib/resend/emails.ts`; runs in the milestone cron                                                                                                                                                                                                                                                                    |
| Change appointment booking (UI)                          | `artifacts/web-app/src/pages/appointments.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Change appointment reschedule / cancel                   | `artifacts/web-app/src/pages/appointment-manage.tsx` (+ shared `lib/appointment-format.ts`); `api-server/src/services/appointment-manage.service.ts` + `routes/appointments.ts` (`/appointments/manage`, `/reschedule`, `/cancel`) + `lib/google/calendar.repository.ts` (`getCalendarEvent`/`updateCalendarEvent`/`cancelCalendarEvent`) + the reschedule/cancel builders in `lib/resend/emails.ts`; token `"appointment"` purpose in `lib/auth/tokens.ts`                                                                                                                                                                                                                                   |
| Change appointment types / routing rules                 | `api-server/src/lib/appointments/catalog.ts` (targeted business rule — durations, which staff, which locations)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Change staff working hours / calendars                   | `/studio` → **Working hours** (`web-app/src/components/studio-availability.tsx`); `api-server/src/services/staff-availability.service.ts` + the `/studio/availability` routes in `routes/studio.ts` + `lib/db/staff-availability.repository.ts` (schema in `supabase/migrations/0004_staff_availability.sql`), read through `lib/appointments/schedule.ts` and mapped by `buildSchedule` in `lib/appointments/staff.ts`                                                                                                                                                                                                                                                                       |
| Change appointment slot logic / policy                   | `api-server/src/lib/appointments/availability.ts` (`computeSlots`) + `time.ts` + `settings.ts`; `services/appointments.service.ts` + `routes/appointments.ts` + `lib/google/*` (Calendar free/busy + event insert)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Change who can see the Dashboard nav link                | `web-app/src/lib/studio-access.ts` (the probe) + `useNavLinks()` / `DASHBOARD_LINK` in `components/navbar.tsx` (where it renders, in Account's place) + the staff hand-off in `pages/account.tsx` + the `/studio/access` route in `api-server/src/routes/studio.ts`; the gate itself is `requireStaff` (`middlewares/auth.ts`) + `lib/staff.ts`                                                                                                                                                                                                                                                                                                                                               |
| Change the customer account portal (Supabase Auth)       | `artifacts/web-app/src/pages/account.tsx` (+ `components/appointment-manage-panel.tsx`, shared with `pages/appointment-manage.tsx`) + `pages/account-login.tsx` / `account-callback.tsx` / `account-reset.tsx` + `lib/supabase.ts` + `lib/auth-context.tsx` (frontend); `api-server/src/services/account.service.ts` + `routes/account.ts` + `middlewares/auth.ts` + `lib/supabase/client.ts`; queries `findOrdersByEmail` / `findShopOrdersByEmail` + `listUpcomingAppointmentsByEmail` (`lib/google/calendar.repository.ts`, mapped via `lib/appointments/event-details.ts`) + `extractMeasurements` (`lib/notion/orders.schema.ts`). Auth emails: `.agents/memory/supabase-auth-emails.md` |
| Change the internal studio dashboard                     | `artifacts/web-app/src/pages/studio.tsx` (+ the `/studio` route in `App.tsx`, `noindex` entry in `lib/seo-routes.ts`); `api-server/src/services/studio-analytics.service.ts` (the pure `aggregateStudioAnalytics` + the cached use-case) + `routes/studio.ts` + `requireStaff` in `middlewares/auth.ts` + `lib/staff.ts` (the `STUDIO_STAFF_EMAILS` allowlist + the `amr` Google check); the 403 panel's re-sign-in lands back via `web-app/src/lib/post-signin.ts` (read by `pages/account-callback.tsx`); reads via `lib/notion/scan.ts` + `listOrdersForAnalytics` / `listShopOrdersForAnalytics` / `listInvoicesForAnalytics`                                                             |
| Change the studio's internal tools (generators, refunds) | `api-server/src/services/studio-tools.service.ts` (the dispatcher + the composed result wording) + `routes/studio.ts` (`POST /studio/tools/:tool`, `requireStaff`) + `web-app/src/components/studio-tools.tsx` (rendered by `pages/studio.tsx`); the underlying work stays in `services/{schedule,invoice-generator,order-notification,order-cancellation,return-refund}.service.ts`. Contract in `openapi.yaml` (`StudioTool` / `StudioToolRequest` / `StudioToolRun`)                                                                                                                                                                                                                       |
| Change the Postgres integrity layer / payment dedup      | `api-server/src/lib/db/client.ts` (`DbClient` seam + `postgresConfigured`) + `lib/db/processed-payments.repository.ts` (`claimPayment` / `confirmPayment` / `releasePayment`); consumed by `services/checkout.service.ts` (`recordPaidOrder`). Schema in `supabase/migrations/*.sql`, applied by `src/scripts/migrate.ts` (`pnpm db:migrate`, `.github/workflows/migrate.yml`)                                                                                                                                                                                                                                                                                                                |
| Change the newsletter opt-in                             | `artifacts/web-app/src/components/newsletter-signup.tsx` (footer field, in `footer.tsx`) + the intake checkbox in `pages/order-form.tsx`; `api-server/src/services/newsletter.service.ts` + `routes/newsletter.ts` + `lib/notion/newsletter.{blocks,repository}.ts` (writes to the **contact** database) + `newsletterWelcomeEmail` in `lib/resend/emails.ts`                                                                                                                                                                                                                                                                                                                                 |
| Change invisible anti-spam (honeypot/timing/limit)       | `api-server/src/middlewares/spam-filter.ts` (`isLikelySpam` + `spamFilter`) + `submissionRateLimiter` in `middlewares/rate-limit.ts`; applied in `routes/{contact,notify,newsletter}.ts`; frontend `web-app/src/lib/anti-spam.tsx` (`HoneypotField` / `honeypotSchema` / `useSubmitTimer`) wired into `pages/contact.tsx` + `components/{notify-dialog,newsletter-signup}.tsx` + `pages/order-form.tsx`. Fields `website` + `elapsedMs` on the contact/notify/newsletter request schemas in `openapi.yaml`                                                                                                                                                                                    |
| Change the mailing-list / Resend audience sync           | `api-server/src/lib/resend/audience.ts` (`upsertAudienceContact` → Resend Contacts API) + `audienceId()` in `lib/resend/config.ts`; wired best-effort from `services/newsletter.service.ts`. Campaigns are sent as Resend **Broadcasts** from the dashboard (no in-app sender). Marketing-email disclosure in `pages/privacy.tsx`                                                                                                                                                                                                                                                                                                                                                             |
| Add a page / route                                       | new `src/pages/*.tsx` + `<Route>` in `src/App.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Add or rename a nav link                                 | `NAV_LINKS` in `artifacts/web-app/src/components/navbar.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Add a shared UI component                                | `artifacts/web-app/src/components/ui/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Add/change a shared test fixture                         | `lib/test-fixtures/src/index.ts` (read its guardrail first)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Understand a past decision / gotcha                      | `.agents/memory/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Adjust the Vercel serverless entrypoint                  | `api/index.ts` + `vercel.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Change social share metadata / OG tags                   | `web-app/src/lib/seo-routes.ts` + `components/seo.tsx` + `lib/seo-html.ts` + the `seo-prerender` plugin in `vite.config.ts`; regenerate artwork with `pnpm --filter @workspace/web-app social-images`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Change product page SEO / share cards                    | `web-app/src/lib/product-seo.ts` + `api-server/src/scripts/export-product-seo.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

```

```
