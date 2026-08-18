# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**AA-Atelier** is the order-management web app for a custom figure skating/dance costume business. Its
two core customer-facing flows are:

1. **Order status lookup** — a customer enters their order number and sees a
   vertical timeline of their garment's progress through the atelier's stages.
2. **New order intake** — a customer submits contact details, body
   measurements, and dress notes to place a custom order.

These sit inside a small marketing site: a landing page (`pages/home.tsx`) and
informational pages — **Services, About, Shop, Contact** — reachable from a
global navbar. These are fully built out: Services lists offerings + the
process, About carries the studio story + an FAQ accordion, Shop is a live
Notion-backed product grid, and Contact is a working inquiry form.

There is **no traditional database for orders**. Orders live in a **Notion
database**, which the team manages directly through the Notion UI. The
API server talks to the Notion REST API.

The app is deployed on **Vercel** (migrated off Replit — see
`.agents/memory/vercel-migration.md`).

## Repository layout

This is a **pnpm workspace monorepo**. Package globs are defined in
`pnpm-workspace.yaml`: `artifacts/*`, `lib/*`, `tests`. Every
workspace package is named `@workspace/<name>`. (`scripts/` is plain bash
tooling, deliberately _not_ a workspace package.)

```
artifacts/
  web-app/           Frontend SPA (Vite + React 19 + Tailwind v4 + shadcn/ui)
    src/App.tsx      wouter routes + a global <Navbar />
    src/pages/       one component per route (home landing, track, order-form,
                     invoice, services, about, shop, shop-success,
                     contact, appointments, privacy, terms,
                     shipping-returns, not-found)
    src/components/  ... plus a global footer.tsx and legal-page.tsx shell
    src/components/  navbar.tsx (global nav), page-shell.tsx (page wrapper),
                     ui/ (shadcn primitives — pruned to only the ones actually
                     used; re-add others with `npx shadcn add <name>`)
  api-server/        Backend (Express 5) — talks to Notion, bundled by esbuild
    src/routes/      thin HTTP handlers (validate → service → respond)
    src/services/    HTTP-agnostic order use-cases
    src/middlewares/ reusable zod validation + central error handler
    src/lib/notion/  Notion adapter: client, schema mapping, block builder, repository
    src/lib/supabase/ Supabase client (verifies the account portal's JWT)
    src/lib/db/      Postgres integrity layer (client seam + processed-payments repo)
    src/scripts/     migrate.ts — out-of-band Postgres migration runner (`db:migrate`)
api/
  index.ts           Vercel serverless entrypoint — re-exports the built Express app
lib/
  api-spec/          OpenAPI spec (openapi.yaml) + orval codegen config — SOURCE OF TRUTH
  api-zod/           GENERATED zod schemas from the spec (server-side validation)
  api-client-react/  GENERATED react-query hooks + typed fetch client (frontend)
  test-fixtures/     Shared domain fixtures for all three test suites
supabase/migrations/ Postgres schema (SQL migrations applied by `pnpm db:migrate`)
scripts/             Bash tooling: cleanup.sh (disk reclaim, `pnpm clean`),
                     install-hooks.sh (`pnpm hooks:install`), pre-push +
                     post-merge git hooks
tests/               Playwright end-to-end tests
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
                                    ├──►  Supabase Auth (verify account-portal JWT)
                                    └──►  Postgres (optional: Stripe payment dedup)
  │
  ├─ GET  /api/health              → { status: "ok" }
  ├─ GET  /api/account/overview    → the signed-in customer's custom orders +
  │                                  shop orders (with measurements) + upcoming
  │                                  appointments + referral, looked up by the email
  │                                  on the customer's Supabase access token.
  │                                  Appointments come from Google Calendar by the
  │                                  email stamped on each booking + carry a signed
  │                                  manage token (best-effort — degrade to none on
  │                                  a calendar outage). Bearer-JWT gated (401).
  │                                  Sign-in runs on Supabase Auth in the browser —
  │                                  there is NO server login/logout/verify route
  ├─ GET  /api/orders/:orderNumber → order status + stage list
  ├─ POST /api/orders              → creates a Notion page, returns order number
  │                                  + sends an order-confirmation email
  │                                  + (best-effort) upserts a Client CRM record
  │                                  by email and links the order to it. Optional
  │                                  referenceImageIds (from the upload endpoint
  │                                  below) are attached as image blocks.
  ├─ POST /api/orders/reference-images
  │                                → relays one raw customer-uploaded reference/
  │                                  inspiration image to Notion's File Upload API
  │                                  and returns its file_upload id (for the order
  │                                  body's referenceImageIds). Raw bytes, NOT part
  │                                  of the OpenAPI contract.
  ├─ POST /api/orders/:n/payments/:stage
  │                                → creates a Stripe Checkout session for one
  │                                  payment stage of custom order :n — first
  │                                  deposit, second deposit, or the final balance
  │                                  — each priced server-side from the order's
  │                                  Notion invoice; the webhook marks it paid
  ├─ POST /api/orders/:n/measurement-change-requests
  │                                → files a customer request to change order :n's
  │                                  measurements in the SAME "Website Contact
  │                                  Messages" database, tagged Request type =
  │                                  "Measurement update". Gated: values-or-
  │                                  appointment, email must match the order, and
  │                                  rejected once the garment is in production
  │                                  (MEASUREMENT_LOCK_FROM_STAGE). Never edits the
  │                                  order — the atelier applies the change by hand
  │                                  (Approach A) + sends a confirmation email
  ├─ POST /api/orders/:n/reviews    → files a customer's post-delivery review of
  │                                  order :n (star rating + testimonial + optional
  │                                  credit name, publish consent, and photos of the
  │                                  finished piece) into a dedicated Notion
  │                                  "Reviews" database. Gated: the order must be at
  │                                  its final (delivered) stage and the email must
  │                                  match the order. Photos reuse the reference-
  │                                  image upload (attached as image blocks) + sends
  │                                  a customer thank-you email. Curated by the
  │                                  atelier (Status defaults to "New") to feed
  │                                  testimonials + the portfolio
  ├─ POST /api/orders/:n/cancellation-requests
  │                                → files a customer request to cancel custom
  │                                  order :n into the SAME "Website Contact
  │                                  Messages" database, tagged Request type =
  │                                  "Cancellation". Gated: email must match the
  │                                  order, and rejected once the order is
  │                                  delivered (a delivered order is a return).
  │                                  Never refunds — the atelier reviews and
  │                                  processes the refund via the button below
  ├─ POST /api/contact             → saves a contact message to the Notion
  │                                  "Website Contact Messages" database
  │                                  + sends an acknowledgement email
  ├─ GET  /api/products            → shop inventory + the live category list,
  │                                  from the Notion "inventory" database
  ├─ GET  /api/colors              → the studio's intake color palette for the
  │                                  order form's color picker (id + name + hex per
  │                                  chip). Read from the atelier-editable
  │                                  `COLOR_PALETTE` Studio Settings value, falling
  │                                  back to a built-in primary palette, so it's
  │                                  always non-empty. No dedicated Notion database
  ├─ GET  /api/shop-orders/:orderNumber
  │                                → a ready-to-wear shop order's current
  │                                  fulfillment Status + the live status list
  │                                  (for a tracking timeline), by the order
  │                                  number issued at checkout
  ├─ POST /api/shop-orders/:n/cancellation-requests
  │                                → files a customer request to cancel shop
  │                                  order :n into the SAME contact database,
  │                                  tagged Request type = "Cancellation". Gated
  │                                  on email match only (no delivered gate); the
  │                                  atelier reviews + refunds via the button below
  ├─ POST /api/shop-orders/:orderNumber/return-requests
  │                                → files a customer's return/exchange request
  │                                  for a shop order in the SAME "Website Contact
  │                                  Messages" database, tagged Request type =
  │                                  "Return / exchange" (kind + reason + item(s)
  │                                  + optional exchange-for + note). Gated: the
  │                                  email must match the shop order (403), legacy
  │                                  orders with no stored email are accepted but
  │                                  flagged unverified. Never refunds/edits the
  │                                  order — the atelier reviews + actions it by
  │                                  hand (Approach A) + sends a confirmation email
  ├─ POST /api/notify              → files a back-in-stock request (email + item
  │                                  + optional size) in that SAME contact
  │                                  database, tagged Request type = "Back in
  │                                  stock" + sends a request-confirmation email
  ├─ POST /api/newsletter          → files a marketing newsletter opt-in (email +
  │                                  optional source) in that SAME contact
  │                                  database, tagged Request type = "Newsletter"
  │                                  + sends a best-effort welcome email (from the
  │                                  contact/hello@ sender). Marketing consent,
  │                                  separate from the transactional captures; no
  │                                  atelier notification (a list needs no triage)
  ├─ POST /api/checkout            → prices the requested in-stock items from
  │                                  live Notion inventory and creates a Stripe
  │                                  Checkout session; returns the hosted-
  │                                  checkout URL for the browser to redirect to
  ├─ GET  /api/checkout/session/:id→ a session's status + itemized receipt
  │                                  (items, shipping, tax, total) for the
  │                                  success page
  ├─ GET  /api/appointments/options→ the bookable appointment types (duration,
  │                                  allowed staff + locations) + booking
  │                                  timezone, for the booking form’s pickers
  ├─ GET  /api/appointments/availability
  │                                → open slots for a type/location/(staff) over
  │                                  a date window, computed from config working
  │                                  hours minus Google Calendar free/busy
  ├─ POST /api/appointments        → books an open slot (re-checked server-side),
  │                                  writes it as a Google Calendar event that
  │                                  invites the customer (+ Meet for virtual) +
  │                                  emails a confirmation (with a signed
  │                                  "manage your appointment" link)
  ├─ GET  /api/appointments/manage → the current details of a booked appointment,
  │                                  identified by the signed token in the manage
  │                                  link (read live from Google Calendar). Drives
  │                                  the self-service reschedule/cancel page
  ├─ POST /api/appointments/reschedule
  │                                → moves the appointment (by its signed token) to
  │                                  a new open slot — re-checks availability for the
  │                                  SAME staff/type/location, PATCHes the calendar
  │                                  event (re-notifying), emails a confirmation
  ├─ POST /api/appointments/cancel → cancels the appointment (by its signed token):
  │                                  deletes the calendar event (frees the slot +
  │                                  notifies), emails a confirmation. Idempotent
  ├─ POST /api/webhooks/stripe     → Stripe → server webhook (raw body, signed).
  │                                  On checkout.session.completed, records the
  │                                  paid order in the Notion "Shop Orders"
  │                                  database. NOT part of the OpenAPI contract.
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
  ├─ GET  /api/webhooks/notion-stage-change/run
  │                                → the SAME send, on demand: a link the atelier
  │                                  opens (`?secret=<CRON_SECRET>&order=<ORD>`) to
  │                                  send one order's update by hand — the way to
  │                                  test in production against a single order
  │                                  without wiring up the automation. Returns an
  │                                  HTML confirmation page. NOT part of the
  │                                  OpenAPI contract.
  ├─ GET  /api/cron/generate-milestones
  │                                → Vercel Cron reconciliation (CRON_SECRET-
  │                                  guarded, Bearer header, JSON). Finds orders
  │                                  with a "Due Date" but no milestones and writes
  │                                  one per-stage milestone row to the Notion
  │                                  "Production Schedule" database, then re-syncs
  │                                  every existing milestone's Status from its
  │                                  order's live stage (so the calendar reflects
  │                                  real progress, not a frozen "Not Started").
  │                                  Also emails a best-effort fitting reminder for
  │                                  any "Fitting" milestone due within the lead
  │                                  window (see "Automated fitting reminders") and
  │                                  a best-effort payment reminder for any invoice
  │                                  deposit/balance coming due or overdue (see
  │                                  "Payment & deposit due reminders").
  │                                  NOT part of the OpenAPI contract.
  ├─ GET  /api/cron/generate-milestones/run
  │                                → the SAME reconciliation, on demand: a Notion
  │                                  "Open link" button the atelier presses. Auth
  │                                  is a `?secret=<CRON_SECRET>` query token
  │                                  (a button can't send a Bearer header) and it
  │                                  returns a small HTML confirmation page. NOT
  │                                  part of the OpenAPI contract.
  ├─ GET  /api/invoices/generate-line-items
  │                                → itemize a custom order's invoice from its
  │                                  costing (CRON_SECRET Bearer, JSON, `?order=`).
  │                                  Mirrors the order's costing items into
  │                                  "Invoice Line Items": one Material line per
  │                                  non-packaging usage line (at cost), one Labor
  │                                  line, and one reconciling "Design & finishing"
  │                                  Adjustment line = Σ(Suggested Price) −
  │                                  (materials + labor) so the total lands on the
  │                                  costing's margin-loaded price. Also names the
  │                                  invoice after the ORD- number. Idempotent
  │                                  (skips an invoice that already has lines). NOT
  │                                  part of the OpenAPI contract.
  ├─ GET  /api/invoices/generate-line-items/run
  │                                → the SAME generation, on demand: a Notion link
  │                                  the atelier clicks (a formula-built URL
  │                                  carrying the row's Order Number). Auth is a
  │                                  `?secret=<CRON_SECRET>&order=<ORD>` query
  │                                  token; returns an HTML confirmation page. NOT
  │                                  part of the OpenAPI contract.
  ├─ GET  /api/orders/process-cancellation
  │                                → the atelier's cancellation-refund action
  │                                  (CRON_SECRET Bearer, JSON, `?order=<ORD or
  │                                  SHP>`). Refunds every paid Stripe payment on
  │                                  the order (custom: each paid deposit + the
  │                                  balance from the invoice; shop: the single
  │                                  checkout session) and sets a `Cancelled`
  │                                  marker. Idempotent (skips a payment that
  │                                  already has a refund) and marks cancelled only
  │                                  after all refunds succeed. NOT part of the
  │                                  OpenAPI contract.
  └─ GET  /api/orders/process-cancellation/run
                                   → the SAME action, on demand: a Notion link the
                                     atelier clicks (a formula-built URL carrying
                                     the row's Order Number). Auth is a
                                     `?secret=<CRON_SECRET>&order=<ORD>` query
                                     token; returns an HTML confirmation page. NOT
                                     part of the OpenAPI contract.
```

The customer-notification POST endpoints (`/api/orders`, `/api/contact`,
`/api/notify`, `/api/newsletter`, `/api/appointments`,
`/api/appointments/reschedule`, `/api/appointments/cancel`,
`/api/orders/:n/measurement-change-requests`, `/api/orders/:n/reviews`,
`/api/orders/:n/cancellation-requests`, `/api/shop-orders/:n/cancellation-requests`,
`/api/shop-orders/:n/return-requests`)
each send a customer email via **Resend** as
a **best-effort** side effect after the Notion write: the send is logged-and-swallowed
on failure and never changes the response status (see the Resend adapter in
`artifacts/api-server/src/lib/resend/` and the notification-email note in
`.agents/memory/vercel-migration.md`). This replaced the old Notion automations
that used to send these emails.

Order **status-change** emails are the one notification the app can't fire from a
request — stage changes happen inside Notion, and there's no Notion→app trigger.
They're driven instead by a Notion **database automation** that calls
`POST /api/webhooks/notion-stage-change` (see the routes above + the "Order
status-change emails" section below): the webhook reads the order back and sends a
best-effort customer email with a pipeline graphic. It's still the same Resend
adapter and the same best-effort contract as the request-driven mail.

Each of those also sends an **internal atelier notification** to
`ATELIER_INBOX_EMAIL` (with **Reply-To** set to the customer) — but only when that
env var is set; unset means the notification is skipped and only the customer email
goes out. So the atelier gets an email nudge on top of the Notion row. The
customer-facing and atelier-facing builders live side by side in
`lib/resend/emails.ts`. (The one exception is `/api/newsletter`: it sends the
customer welcome but deliberately **no** atelier notification — a mailing-list
opt-in needs no triage, so a per-signup studio email would just be noise.)

Emails are grouped into three **categories** (`lib/resend/config.ts`): **orders**
(order + back-in-stock mail), **contact** (contact-form + newsletter mail), and
**appointments** (booking mail). Each category resolves a **sender** and a
**notification inbox** from env, with the per-category overrides falling back to
the base vars when unset (so unset ⇒ identical to a single-address setup): sender
`RESEND_CONTACT_FROM_EMAIL` / `RESEND_APPOINTMENTS_FROM_EMAIL` → `RESEND_FROM_EMAIL`,
inbox `ATELIER_CONTACT_INBOX_EMAIL` / `ATELIER_APPOINTMENTS_INBOX_EMAIL` →
`ATELIER_INBOX_EMAIL`. The service resolves the pair via
`fromAddress(category)`/`atelierInbox(category)` and spreads the `from` onto the
message; the client uses a per-message `from` over its base. This lets, e.g.,
order mail send from `orders@` and contact mail from `hello@`.

**Production error alerting.** On top of logging, the app emails an alert to
`ALERT_INBOX_EMAIL` (default `alexandra@a3iceanddance.com`) whenever it hits an
error-level condition that would otherwise be invisible: an unhandled 500 (the
central `middlewares/error.ts` handler), a failed Stripe-webhook record, a failed
milestone cron, or a customer email Resend rejects (`lib/resend/send.ts`). This is
`services/alert.service.ts` (`reportError` / `reportEmailFailure`), reusing the
Resend adapter — chosen over a Vercel Log Drain because Log Drains need a Pro plan
(the project is on Hobby) and an in-process, **awaited** send flushes reliably on
serverless (a fire-and-forget drain can be frozen before it delivers). Load-bearing
rules: the alert itself sends via the **strict** `sendEmail` and logs its own
failures at `warn`, never re-entering `reportError` (the loop guard); it self-gates
when `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are unset (so it's inert in dev/test and
never blocks a response); and a per-instance 5-minute de-dupe bounds repeats (it
can't throttle across serverless instances). Deliberately **not** wired to the
CRM-upsert (`warn`-level, order unaffected) or shipping-rate (documented degraded-
but-OK, high-frequency) catches, to keep alerts high-signal.

- **Locally:** the Vite dev server proxies `/api` to the Express server on
  `localhost:3000` (see `artifacts/web-app/vite.config.ts`).
- **On Vercel:** `vercel.json` rewrites `/api/:path*` → `/api/index`, which is
  the serverless function at `api/index.ts`. That file imports the
  **pre-bundled** Express app from `artifacts/api-server/dist/app.mjs` (built by
  esbuild during `build:vercel`). It imports the built artifact — not the TS
  source — deliberately, so `@vercel/node` doesn't try to type-check the whole
  workspace TypeScript graph. Don't "fix" this by importing the source.

### The API is contract-first — this is the most important convention

`lib/api-spec/openapi.yaml` is the **single source of truth** for the HTTP API.
Two packages are **generated from it** by [orval](https://orval.dev) and must
never be hand-edited:

- `lib/api-zod` — zod schemas used by the **server** to validate/parse
  requests and responses (`CreateOrderBody`, `GetOrderStatusResponse`, …).
- `lib/api-client-react` — **react-query hooks** (`useGetOrderStatus`, …) and a
  typed `customFetch` client, consumed by the frontend.

Files under `src/generated/` carry a "Do not edit manually" header. To change
the API:

1. Edit `lib/api-spec/openapi.yaml`.
2. Run codegen: `pnpm --filter @workspace/api-spec run codegen`
   (runs orval, then re-typechecks the libs).
3. Update the server route handlers and frontend as needed.

Note: `lib/api-client-react/src/custom-fetch.ts` is the **mutator** (hand-written,
not generated) — the fetch/error-handling layer all generated hooks route
through. It's safe to edit.

Both frontend flows go through the generated client: the unified tracking page
(`pages/track.tsx`) uses `useGetOrderStatus` (custom orders) and
`useGetShopOrderStatus` (shop orders), and the intake form
(`pages/order-form.tsx`) uses the `useCreateOrder` mutation. The form's local
zod schema is checked against the generated `NewOrderRequest` where it hands
data to the mutation, so it can't silently drift from the contract.

## Working with Notion (read `.agents/memory/` first)

The Notion integration lives in `artifacts/api-server/src/lib/notion/`
(`client.ts` for the REST client, `orders.schema.ts` for property-name constants +
extraction helpers, `orders.blocks.ts` for the order page-body builder, and
`orders.repository.ts` for create/lookup — each domain's `*.blocks.ts` /
`*.schema.ts` / `*.repository.ts` follow the same prefixed convention). It encodes
two hard-won lessons captured in `.agents/memory/`:

1. **Property types must match the live schema, not the property name.**
   "Order Number" is a Notion `rich_text` property, **not** `number` — values
   have leading zeros (`"000002"`). Filters must use `rich_text: { equals }`.
   Before writing any Notion filter, inspect the actual `type` of the property
   on a sample page. See `notion-status-filters.md`.

2. **Never hardcode a Notion option list.** The atelier team edits select/status
   options directly in Notion and expects changes to appear without a redeploy.
   `fetchLiveOrderStages()` reads the order **Stage** options live from
   `GET /v1/databases/{id}` with a 60s in-memory TTL cache, falling back to the
   cached list on error (`notion/orders.repository.ts`). Don't reintroduce a
   hardcoded constant for it. (The per-stage _description text_ in
   `lib/stage-descriptions.ts` is cosmetic flavor only.)

   The **shop's category list is a dedicated "Product Categories" database** (not
   the inventory "Item Type" select, which was retired). Each inventory row points
   at a category via a `Category` **relation**; `listCategoryRecords()`
   (`notion/product-categories.repository.ts`, same 60s cache + fallback) reads the
   category name, `Show size guide` flag, `Size Guide Type` (which chart — see
   below), and `Sort` order, and `products.service` resolves each product's
   category + `sized` flag + `sizeGuide` by joining the relation. A category
   rename propagates automatically (the relation follows the page); a new category
   defaults unsized. `NOTION_PRODUCT_CATEGORIES_DATABASE_ID` must be set — there is
   no fallback.

   **Which size chart a category shows is Notion-driven, not name-matched.** The
   shop has two size charts (`web-app/src/components/size-chart-dialog.tsx`): the
   ready-to-wear body-measurement chart (Jalie bands) and the skate-soaker
   blade-length chart. A category's `Size Guide Type` **select** picks between
   them via the same `Category` relation — so renaming the "Skate Soakers"
   category never breaks routing (nothing matches on the name). A soaker category
   is treated as sized regardless of its `Show size guide` checkbox (the blade
   chart is implied by the type), so the atelier only sets the one select. On the
   API this is `Product.sizeGuide` (`garment` | `soaker`, omitted ⇒ garment); the
   frontend passes it to `SizeChartDialog`'s `variant` prop.

   The deliberate exceptions are _targeted business rules_ naming specific
   option values — `STATUS_IN_STOCK` ("In Stock" is the only sellable status),
   the `MEASUREMENT_LOCK_FROM_STAGE` stage (`services/measurement-lock.ts`,
   default `Cutting/Pinning`, env-overridable; `measurementsLocked()` is the gate,
   consumed by `services/measurement-change.service.ts`) at/after which measurements
   freeze, and `SIZE_GUIDE_TYPE_SOAKER` (the `"Skate soaker"` value of the
   `Size Guide Type` select that routes a category to the blade-length chart, in
   `notion/product-categories.schema.ts`).
   These name values, not the list; rename those options in Notion and you must
   update them here too. (The size chart's category list used to be a fourth such
   rule — `SIZED_CATEGORIES` — but it is now Notion-driven via the Product
   Categories relation, so no name is left to drift.)

3. **The contact database has six writers.** "Website Contact Messages" holds
   contact-form messages (`contact.blocks.ts`), the shop's back-in-stock requests
   (`notify.blocks.ts`), order measurement-change requests
   (`measurement-change.blocks.ts`), marketing newsletter opt-ins
   (`newsletter.blocks.ts`), order cancellation requests
   (`cancellation.blocks.ts`), and shop-order return/exchange requests
   (`return-request.blocks.ts`), separated by the **Request type** select
   (`Inquiry` / `Back in stock` / `Measurement update` / `Newsletter` /
   `Cancellation` / `Return / exchange`). A restock request carries **Item** and
   **Size** as real properties, a measurement-change request carries the order
   number + requested measurements, and a return/exchange request carries the shop
   order number + kind + reason (and reuses the shared **Item** property for the
   piece), so the atelier can filter the inbox by request type rather than reading
   it out of free text. A newsletter opt-in needs no property of its own — email +
   the shared Subject/Stage/Request type carry it, with its `source` (footer /
   order form) folded into the subject, the way notify folds item/size — so the
   database needs nothing added for it. The property names these writers share are
   exported from `contact.blocks.ts` and imported by `notify.blocks.ts` /
   `measurement-change.blocks.ts` / `newsletter.blocks.ts` /
   `cancellation.blocks.ts` / `return-request.blocks.ts` — keep it that way so they
   can't drift (the return writer also reuses `NOTIFY_ITEM_PROPERTY` from
   `notify.blocks.ts`). All six also best-effort **link to the Client CRM** (the
   shared `Client` relation — `CONTACT_CLIENT_PROPERTY`), via the same
   `upsertClientByEmail` the order flow uses: a contact inquiry / back-in-stock
   request / newsletter opt-in creates a `Lead`, a measurement change / cancellation
   / return reuses the order's existing (`Active`) client. See
   `.agents/memory/notion-p2-duplicates.md`.

   The newsletter opt-in is the marketing counterpart to those transactional
   captures (roadmap "Newsletter & mailing-list opt-in"): `POST /api/newsletter`
   (contract-first — in `openapi.yaml` + the generated client) records explicit
   marketing consent and sends a best-effort **welcome** email from the
   **contact** sender (hello@), keeping it off transactional orders@. Unlike the
   other three flows it sends **no** internal atelier notification — a mailing-list
   opt-in needs no triage, and a per-signup studio email would be noise as the list
   grows; the Notion row (+ CRM Lead) is the record. Two capture surfaces feed it:
   a footer field (`components/newsletter-signup.tsx`, rendered by `footer.tsx`) and
   an intake checkbox on the order form (`pages/order-form.tsx` fires a separate
   best-effort `useSubscribeNewsletter` call, so the order contract is untouched).
   Code: `services/newsletter.service.ts`, `routes/newsletter.ts`,
   `lib/notion/newsletter.{blocks,repository}.ts`, `newsletterWelcomeEmail` in
   `lib/resend/emails.ts`. The Notion capture needs **no new database** — it reuses
   the contact database + the Resend contact sender + the optional Client CRM.

   **The mailing list is managed in Resend, not Notion — Notion is the record,
   not the list manager.** A list also needs one-click unsubscribe (a Gmail/Yahoo
   bulk-sender requirement), a way to actually send a campaign, and reputation
   isolation from the transactional order/appointment mail — none of which Notion
   can do. So on opt-in the subscriber is **also** best-effort synced into a
   **Resend Marketing Audience** (`services/newsletter.service.ts` →
   `upsertAudienceContactBestEffort` in `lib/resend/audience.ts`), which becomes
   the sending list and the **subscription authority** (it owns
   subscribed/unsubscribed). Campaigns are composed and sent as Resend
   **Broadcasts from the dashboard** — there is deliberately **no** in-app campaign
   sender or scheduled-send cron (sized for occasional studio updates; a dedicated
   ESP like Beehiiv/MailerLite is the path if marketing becomes a growth channel).
   Resend attaches the one-click unsubscribe + `List-Unsubscribe` header to every
   Broadcast, which is what makes the "unsubscribe anytime" copy on `order-form.tsx`
   and the **Marketing emails** section of `pages/privacy.tsx` actually true. Load-
   bearing: the audience module is the **only** place the app uses Resend's Contacts
   API (everything else in `lib/resend/` is transactional `send`); it **self-gates**
   on `RESEND_AUDIENCE_ID` (optional — unset ⇒ the sync is skipped and the opt-in is
   still captured in Notion, same degrade-when-unconfigured contract as the CRM) and
   is **best-effort** (a Resend hiccup never fails the opt-in — the Notion row is the
   record). The upsert re-subscribes a previously-unsubscribed email that re-opts-in
   (create with `unsubscribed:false`, else PATCH by email). One-time atelier setup:
   create an Audience in Resend → **Audiences** and set `RESEND_AUDIENCE_ID`; send
   via Resend → **Broadcasts** (free ≤1,000 contacts, Marketing track billed apart
   from transactional above that).

Auth: the server reads `NOTION_API_KEY` and `NOTION_ORDERS_DATABASE_ID` from
environment variables (via `createNotionClient` in `notion/client.ts`, read at
first use rather than module load). On Replit these came from a sidecar; that
path is gone.

## Studio Settings (atelier-editable config in Notion)

The runtime **business tunables** that used to be Vercel-only can be retuned live
from an optional **"Studio Settings"** Notion database (a key/value table), so the
atelier changes them in Notion instead of editing env vars + redeploying. It
extends the same live-read philosophy as stages/categories/working-hours. Load-
bearing decisions:

1. **Only non-secret tunables live here.** Secrets (`NOTION_API_KEY`,
   `STRIPE_*`, `RESEND_API_KEY`, `SESSION_SECRET`, `CRON_SECRET`,
   `GOOGLE_SERVICE_ACCOUNT_KEY`, `SUPABASE_ANON_KEY`, `POSTGRES_URL`) and bootstrap
   wiring (every `NOTION_*_DATABASE_ID`, `SUPABASE_URL`, `APPOINTMENT_SHEET_ID`,
   `PUBLIC_BASE_URL`, …) stay in Vercel — a Notion DB is
   not a secrets store, and you can't read Notion settings without the API key +
   the settings DB's own id, so those two are inherently bootstrap. The keys that
   ARE read from settings are enumerated in `SETTING_KEYS`
   (`lib/settings/store.ts`): `RUSH_SURCHARGE_RATE`, `MEASUREMENT_LOCK_FROM_STAGE`,
   the four `APPOINTMENT_*` policy vars, `COLOR_PALETTE` (the intake color picker's
   palette), and the notification **inboxes**
   (`ATELIER_INBOX_EMAIL`, `ATELIER_CONTACT_INBOX_EMAIL`,
   `ATELIER_APPOINTMENTS_INBOX_EMAIL`, `ALERT_INBOX_EMAIL`). Email **senders**
   (`RESEND_*_FROM_EMAIL`) deliberately stay env-only — they're coupled to Resend
   domain verification, so a wrong value would silently break delivery.

2. **Resolution order is Notion → env → default.** Each config getter
   (`rushSurchargeRate`, `lockFromStage`, the appointment settings, `atelierInbox`,
   the alert inbox) reads `settingValue(KEY) ?? process.env[KEY] ?? default`. So an
   unset row / unconfigured DB behaves **exactly** as env-only did — fully
   backward-compatible and degrade-safe. The Notion `Setting` (title) matches the
   env var name 1:1 so the mapping can't drift; a `Value` and a human `Description`
   complete the row. A blank `Value` reads as unset (falls back).

3. **Sync getters, primed once per request.** The getters are synchronous (read at
   call time); Notion I/O is async. So `app.ts` mounts a middleware that
   `await primeSettings()` at the start of every request — refreshing the in-memory
   snapshot the sync getters read — and the read itself is the usual **60s TTL
   cache + fallback** (`lib/notion/settings.repository.ts`, self-gating to an empty
   map when `NOTION_SETTINGS_DATABASE_ID` is unset or a fetch fails, so a settings
   hiccup never errors a request). Until primed (tests, first request) the snapshot
   is empty, so everything falls back to env — which is why the existing getter
   tests didn't change. Test seams: `__setSettingsSnapshot` / `__resetSettings`
   (store) and `__resetSettingsCache` (repository).

The atelier's one-time setup (all optional — unset ⇒ env-only, as before): create
the "Studio Settings" database (a `Setting` title, a `Value` text, a `Description`
text), share the Notion integration with it, set `NOTION_SETTINGS_DATABASE_ID`,
and fill in a `Value` only for the settings they want to override. Code:
`lib/notion/settings.{schema,repository}.ts`, `lib/settings/store.ts`,
`getSettingsNotionClient` in `notion/client.ts`, the prime middleware in `app.ts`,
and the consuming getters (`services/rush.ts`, `services/measurement-lock.ts`,
`lib/appointments/settings.ts`, `lib/resend/config.ts`, `services/alert.service.ts`).

## Working with Stripe (shop checkout)

The shop sells ready-to-ship items through **Stripe Checkout (hosted)**. The
flow: the client-side cart (`web-app/src/lib/cart.tsx`, persisted to
localStorage) POSTs `{ variantId, size?, quantity }[]` to `/api/checkout`; the
server prices them from live Notion inventory, creates a Stripe Checkout
session, and returns its URL; the browser redirects; Stripe calls
`/api/webhooks/stripe` on completion, which records the paid order in Notion.
Code lives in `api-server/src/services/checkout.service.ts`,
`src/lib/stripe/client.ts`, `src/routes/checkout.ts`, `src/routes/stripe-webhook.ts`,
and `src/lib/notion/shop-orders.*`. Four things are load-bearing:

1. **Never trust client-sent money.** The cart sends only ids/sizes/quantities.
   `checkout.service` recomputes every price and availability from `listVariants()`
   (live Notion), converts dollars → integer cents (`Math.round(price * 100)`),
   and rejects sold-out / unpriced / unknown items with a `BadRequestError` (→ 400).
   An "inquire for price" item (no `Listed Price`) is not purchasable.

2. **The webhook needs the RAW body.** Stripe verifies the signature against the
   exact bytes, so `/api/webhooks/stripe` is mounted in `app.ts` with
   `express.raw()` **before** the global `express.json()`, and directly on the app
   (not the `/api` router). It is deliberately **not** in `openapi.yaml` — it's a
   Stripe→server contract, not part of the browser API or the generated client.

3. **Recording is idempotent.** Stripe delivers at-least-once and retries on any
   non-2xx. When the **Postgres layer** is configured (see "Postgres"), shop-order
   dedup is an atomic `processed_payments` **claim** — `recordPaidOrder` claims the
   session id (`insert … on conflict do nothing`), writes the Notion order, then
   confirms; a failure releases the claim so a redelivery reprocesses cleanly, and a
   still-`processing` claim throws so Stripe retries later instead of racing a
   duplicate. When Postgres is **unset**, it falls back to the original Notion
   read-before-write dedup (`findOrderBySessionId` before insert). Either way the
   Notion `findOrderBySessionId` guard is retained as a reclaim-only backstop
   (`createShopOrder` isn't itself idempotent). Custom-order payments don't use
   `processed_payments` — `recordPayment` is idempotent via the Notion invoice write
   alone (a redelivery sets the same paid checkbox).

4. **Inventory is manual for v1.** A sale does not decrement Notion stock — the
   atelier adjusts it by hand. `Quantity Available` is a Notion **formula** and
   can't be written; auto-decrement would need a new writable count property plus
   reservation logic. Don't wire it up without that.

5. **Shipping rates live in Stripe, not code.** `checkout.service` reads
   `STRIPE_SHIPPING_RATE_IDS` (comma-separated `shr_…` ids the atelier creates and
   prices in the Stripe Dashboard) and attaches them as the session's
   `shipping_options`; unset means no shipping is charged. The order's `Total`
   (Stripe `amount_total`) includes shipping + tax, and `buildShopOrderPageBlocks`
   adds "Shipping" and "Tax" lines to the Notion page body so the itemized bullets
   reconcile with it. Each configured id is **validated at session-create time**
   (`resolveShippingOptions`): it's retrieved from Stripe and kept only if it
   exists, is active, and is priced in USD. An id that fails — deleted/archived, or
   from the wrong Stripe mode (a test `shr_…` under a live key) — is **dropped and
   logged at `error`** rather than 500-ing the whole checkout; if every id is
   invalid, checkout proceeds with no shipping charged. So a stale id degrades the
   shop, it doesn't take it down — but watch the runtime logs for the actionable
   "Skipping shipping rate" message.

6. **Tax is Stripe Tax, enabled on the shop cart only.** `checkout.service` sets
   `automatic_tax: { enabled: true }` and `tax_behavior: "exclusive"` (listed
   prices are pre-tax; tax is added on top), so tax is computed from the collected
   address — configure the origin + a default tax category in the Stripe Dashboard,
   or it computes $0. **Deposits are intentionally untaxed** (tax is assessed on
   the final balance, not the deposits), so `invoice.service` sets
   `automatic_tax` only on the `balance` payment stage, not the deposit stages.

7. **Receipts are Stripe's job; the success page mirrors them.** The emailed
   receipt is a Stripe Dashboard setting (Settings → Emails → "Successful
   payments"), not code. `getCheckoutSession` retrieves the session with
   `expand: ["line_items"]` and returns an itemized view (line items + subtotal /
   shipping / tax / total, dollars); `pages/shop-success.tsx` renders it as an
   on-site receipt. Works for both shop-cart orders and deposits.

8. **Each shop order gets a human-readable order number for tracking.**
   `createCheckoutSession` mints an `SHP-…` number (`generateShopOrderNumber` in
   `shop-orders.blocks.ts`) and stores it in `metadata.orderNumber`, so it flows
   to the webhook session with no extra Stripe round-trip: `buildShopOrderProperties`
   writes it to the Shop Orders `Order Number` (rich_text) property, and
   `getCheckoutSession` returns it so `shop-success.tsx` shows it. The customer
   tracks the order at the unified `pages/track.tsx` (`GET /shop-orders/:orderNumber`
   → `services/shop-orders.service.ts` → `findShopOrderByNumber` /
   `fetchLiveShopOrderStatuses`), which reports the live Notion `Status` workflow
   as a timeline (the status option list is read live, never hardcoded — same rule
   as order stages). The number is surfaced to the customer on the success page
   **and** in the shop confirmation email (`sendShopOrderConfirmation` in
   `checkout.service.ts` passes `metadata.orderNumber` into `ShopOrderEmailDetails`,
   which `shopOrderConfirmationEmail` renders), plus the atelier notification. The
   lookup only serves orders placed after this shipped (older ones have no
   `Order Number`). Once the order ships, the atelier can add **carrier tracking**
   (three **optional, additive** properties the app only ever reads): `Tracking
Number` (rich_text), `Carrier` (rich_text, a display label), and `Tracking URL`
   (url). `findShopOrderByNumber` reads them via `readTracking` — gated on the
   number (a carrier/url with no number is meaningless, so it's dropped) — into
   `ShopOrderRecord.tracking`, which flows through the service to
   `ShopOrderStatus.tracking` (contract-first, in `openapi.yaml` + the generated
   client). `shop-order-result.tsx` renders a "Tracking" panel below the timeline:
   the number linked to the URL when set (else plain text), the carrier as the
   label. Suppressed on a cancelled order. No new env var and nothing to write —
   the atelier just adds the three properties to the Shop Orders database and fills
   them in per order.

9. **Matching add-ons are a self-relation on the inventory, resolved client-side.**
   A product can offer companion items (a skate soaker → its matching blade towel)
   via a **`Matching Add-ons`** relation on the inventory database pointing at other
   inventory rows. The add-on is an ordinary in-stock, priced, one-size variant —
   it also appears as its own shop card. `products.schema.ts` maps the relation to
   `addOnIds: string[]` on each variant (`extractRelationIds`), the service passes
   it through (omitted when empty), and the OpenAPI `ProductVariant.addOnIds` carries
   just the ids — the frontend resolves them against the already-loaded product list
   (`resolveAddOns`/`indexVariants` in `pages/shop.tsx`, keeping only in-stock priced
   add-ons) so the payload never carries the cloth twice. `add-to-cart.tsx` renders an
   opt-in checkbox per resolved add-on; a ticked one is added as its **own** cart line
   (quantity 1, independent of the main item's quantity), so `checkout.service` prices
   and stock-checks it with **no** checkout changes. Because they're distinct lines,
   removing the soaker doesn't remove the cloth (accepted for v1). Add-ons follow the
   _selected_ variant, so a color-specific relation (pink soaker → pink cloth) shows
   the right match. No new env var; the atelier just adds the `Matching Add-ons`
   relation and links each soaker to its cloth.

10. **Installment financing (BNPL) is an opt-in env list, priced by Stripe.** The
    optional `STRIPE_BNPL_METHODS` (comma-separated from `klarna`, `affirm`,
    `afterpay_clearpay`) offers buy-now-pay-later at checkout — Stripe pays the
    studio **in full up front** and carries the installment risk, so nothing extra
    reconciles on our side. `bnplPaymentMethodTypes()` (`lib/stripe/payment-methods.ts`,
    the shipping-rate `STRIPE_SHIPPING_RATE_IDS` pattern) validates the list against
    the supported set (unknown ids dropped + logged at `error`, like the shipping
    resolver) and returns `["card", ...methods]`. **Applied to the shop cart and the
    custom-order final balance only** — both collect an address (shipping / required
    billing) that BNPL needs; deposits are partial pre-payments and stay card-only
    (`taxed ? bnplPaymentMethodTypes() : undefined` in `invoice.service`). Load-bearing:
    setting the var **pins** `payment_method_types` to card + these methods, which
    overrides Stripe's dynamic payment methods on those sessions (other Dashboard
    methods like Link won't appear); **unset ⇒ `payment_method_types` is omitted ⇒
    dynamic methods, exactly as before** (degrade-safe). Card is always prepended and
    an all-invalid list degrades to omitted, so a typo can never produce a card-less
    checkout. Each method must **also** be enabled in the Stripe Dashboard, is
    **mode-scoped** like the shipping rates, and Stripe hides an ineligible method
    (currency/country/amount) itself, so no amount-gating lives here.

The atelier must create the "Shop Orders" Notion database (properties in
`shop-orders.blocks.ts`, including the `Order Number` rich_text property) and
share the integration with it. Local testing uses Stripe test-mode keys +
`stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

### Custom-order payments (invoice = source of truth for all three stages)

Custom (bespoke) orders are quoted offline and paid online in **three staged
payments**: a **first deposit** (after the sketch is finalized), a **second
deposit** (at the first fitting), and the **final balance** (after delivery =
itemized materials + labor − both deposits). All three are owned by the order's
**invoice** in the atelier's Notion finance system (under the "finances" page) —
the app **reads** that, it does not recreate or recompute the costing. The order
row itself carries only the `Invoices` relation (limit 1); it holds **no** deposit
fields.

- **`invoices & payments`** (`NOTION_INVOICES_DATABASE_ID`): one invoice per order
  (`Order` relation), with `Final Balance` (sums the linked `Line Total`s — it has
  been both a rollup and a formula; the app reads either), `Line Items` relation,
  `Invoice Ready`, and the payment fields: `First/Second Deposit Amount` (number),
  `First/Second Deposit Paid` (checkbox), `First/Second Deposit Session Id`
  (rich_text), `First/Second Deposit Due` (date), `Balance Paid` (checkbox),
  `Balance Payment Session Id` (rich_text), `Payment Deadline` (date). Three
  atelier-facing formulas sit on top and are **not** read by the app:
  `Paid to Date` (paid deposits, or `Final Balance` once `Balance Paid`),
  `Remaining to Collect` (`max(0, Final Balance − Paid to Date)`), and
  `Payment Status` (a ✅/⚠️ label driven by the three due dates). Property names
  live in `lib/notion/invoice.schema.ts`.
- **`Invoice Line Items`** (`NOTION_INVOICE_LINE_ITEMS_DATABASE_ID`): each line has
  a `Line Type` (Garment / Material / Labor / Adjustment) and a `Line Total`
  (formula). Each material is its own `Material` row, so the invoice breaks
  materials out per item. **Deposits are not line items** — they live on the
  invoice head, so there is deliberately no "Deposit" option here.

One endpoint serves all three: `POST /orders/:n/payments/:stage`, `stage ∈
{first_deposit, second_deposit, balance}` (`routes/orders.ts` →
`createPaymentCheckout` in `services/invoice.service.ts`). Load-bearing points:

1. **Every amount is priced server-side from the invoice.** A deposit's amount is
   its `First/Second Deposit Amount`; the balance is
   `balanceDue = Σ(Line Totals) − Σ(deposits marked paid on the
invoice)`, floored at 0 (`buildInvoiceView`). `Line Type = Deposit` rows are
   **excluded** from the subtotal — deposits are payments against the total, not
   line items. That option no longer exists in Notion, so the filter is a
   **guard**, kept because re-adding it would otherwise bill a customer for their
   own deposit (Notion's `Final Balance` has no such filter, so a Deposit line
   would inflate the atelier's view while the app stayed correct). A stage with no
   amount set / an already-paid stage / (for the balance) an unready invoice all 400.

2. **Deposits are payable before the invoice is itemized.** `getOrderStatus`
   surfaces `deposits[]` (from the invoice head) as soon as the atelier sets a
   deposit amount, independent of `Invoice Ready`. The itemized `invoice` object
   (and the balance charge) is gated on `Invoice Ready` — the tracking page's deposit
   cards + "View Invoice" button (`components/custom-order-result.tsx`, rendered by
   `pages/track.tsx`), and `pages/invoice.tsx`
   (`/invoice/:orderNumber`) render from these.

3. **Tax on the balance only.** The balance checkout sets `automatic_tax`,
   `tax_behavior: "exclusive"`, and `billing_address_collection: "required"` (no
   shipping step). Deposits stay untaxed.

4. **Write-back is invoice-only + idempotent.** The **one** webhook routes
   `metadata.kind = "custom_payment"` to `recordPayment` → `markInvoicePaid(invoice,
stage, sessionId)`, which ticks that stage's paid checkbox + session-id text on
   the invoice (never the costing formulas). Everything else is a shop-cart order.
   The paid checkbox is the "already paid" guard; the shop-success page skips
   clearing the cart for `custom_payment`.

The atelier must, one time: add the deposit + balance payment fields above to
**invoices & payments** (the order keeps only the `Invoices` relation); share the
Notion integration with **invoices & payments** and **Invoice Line Items**; and
set the two env vars. Code: `services/invoice.service.ts`, `routes/orders.ts`,
`routes/stripe-webhook.ts`, `lib/notion/invoice.{schema,repository}.ts`,
`pages/track.tsx` (via `components/custom-order-result.tsx`), and `pages/invoice.tsx`.

### Generating invoice line items from the costing (button)

Itemizing an invoice by hand is where a **double charge** used to creep in: the
`costing (custom orders)` item is a _whole-garment aggregate_ (its `Suggested
Price` folds in materials + labor + margin), and an `Invoice Line Item` linked to
that costing item prices at the aggregate — so a costing-item line **plus**
separate material/labor lines counts the same money twice (the `Unit Price`
formula resolves the costing item ahead of the material usage line, so even a
"Material" line linked to both silently bills the whole garment). The generator
removes the foot-gun by owning the itemization:
`GET /api/invoices/generate-line-items` (`?order=<ORD>`, CRON_SECRET-guarded,
outside the OpenAPI contract like the milestone button) reads the order's costing
and writes the lines itself —

1. **one Material line per non-packaging material usage line**, priced at that
   line's `Line Material Cost` (at cost);
2. **one Labor line** at the summed costing `Labor Cost`;
3. **one reconciling `Adjustment` line "Design & finishing"** = Σ(costing
   `Suggested Price`) − (materials + labor), which folds the margin in so the
   itemized total lands **exactly** on the costing's margin-loaded price.

Load-bearing: every generated line prices via **`Manual Unit Price`** at quantity
1 and **never links the `Costing Item`** (that link only matters when the manual
price is blank; avoiding it makes the aggregate-vs-components double charge
structurally impossible). It also sets the invoice title (`Invoice ID`) to the
order's `ORD-` number (display-only — lookup is by the order's `Invoices`
relation, never the title). **Idempotent**: it skips an invoice that already has
line items (a re-press only reconciles the title); to regenerate after changing
the costing, delete the existing lines and press again. **Packaging** usage lines
(`Usage Type = "Packaging"`, `USAGE_TYPE_PACKAGING`) are internal cost and never
itemized. Code: `services/invoice-generator.service.ts`,
`routes/invoice-generator.ts`, `lib/notion/costing.{schema,repository}.ts`,
`lib/notion/invoice-line-items.blocks.ts`, and the `createInvoiceLineItem` /
`setInvoiceTitle` writers in `lib/notion/invoice.repository.ts`.

The atelier must, one time: share the Notion integration with **costing (custom
orders)** and the **material usage database**; set `NOTION_COSTING_DATABASE_ID` +
`NOTION_MATERIAL_USAGE_DATABASE_ID`; and add the on-demand trigger — a **formula
property** on invoices & payments (or on the order, which already has `Order
Number`) that builds the clickable URL
`https://<PUBLIC_BASE_URL>/api/invoices/generate-line-items/run?secret=<CRON_SECRET>&order=` +
the order number (a formula that returns a URL renders as a link; a native Button
can't interpolate the row's order number into its URL, which is why this is a
formula link rather than a Button). The `Suggested Price` costing formula is the
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

A customer can request cancellation of a custom (`ORD-`) or shop (`SHP-`) order,
and the atelier processes the refund in one click. It's split the same way every
"a customer asks, the atelier actions" flow is: a **gated customer request** +
an **atelier button**. Load-bearing points:

1. **Customer request (contract-first, like measurement-change).**
   `POST /orders/:n/cancellation-requests` (custom) and
   `POST /shop-orders/:n/cancellation-requests` (shop) file a `Request type =
"Cancellation"` row into the **contact** database (the fifth writer —
   `cancellation.blocks.ts`), verified against the email on the order. The custom
   endpoint rejects a **delivered** order (409 — that's a return, not a
   cancellation); the shop endpoint gates on email only. Best-effort customer
   confirmation + atelier notification emails + CRM link, like every submission
   flow. This **never** refunds or edits the order — it's Approach A. Code:
   `services/cancellation.service.ts`, `routes/orders.ts` + `routes/shop-orders.ts`,
   `lib/notion/cancellation.{blocks,repository}.ts`.

2. **Atelier refund button (CRON_SECRET, outside the OpenAPI contract).**
   `GET /api/orders/process-cancellation[/run]?order=<ORD or SHP>` (Bearer JSON +
   `?secret=` HTML link, mounted directly in `app.ts` **before** the `/api` router
   so it isn't captured by `/orders/:orderNumber`). It detects custom vs shop by
   the number prefix, refunds each paid Stripe payment, and sets a `Cancelled`
   checkbox on the order. Custom orders refund each paid deposit + the balance,
   read off the invoice (`invoice.schema` now reads `balanceSessionId` back — a
   read-only add, no new Notion field); shop orders refund the single stored
   checkout session. Code: `services/order-cancellation.service.ts`,
   `routes/order-cancellation.ts`.

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
   uncancelled and a re-press retries safely (the refund pass is idempotent). The
   customer refund-confirmation email sends **only when something new happened**
   (a refund issued, or the order newly cancelled) — a no-op re-press is silent.

4. **State stays in sync.** `cancelled` is surfaced on both status responses
   (`OrderStatus` / `ShopOrderStatus`), read from the `Cancelled` checkbox, so the
   tracking page shows a cancelled banner and hides the deposit / invoice / review /
   measurement + cancellation affordances (`custom-order-result.tsx` /
   `shop-order-result.tsx`). The request dialog is the shared
   `components/cancellation-request-dialog.tsx`.

The atelier's one-time setup (no new env vars — reuses `CRON_SECRET`,
`STRIPE_SECRET_KEY`, Resend, the contact DB): add a **`Cancelled` checkbox** to the
**Order Tracking Pipeline** and **Shop Orders** databases; and add a formula-property
link on both — `"https://<PUBLIC_BASE_URL>/api/orders/process-cancellation/run?secret=<CRON_SECRET>&order=" + prop("Order Number")`.
The `Cancellation` `Request type` option auto-creates on first write.

## Production schedule (auto-generated stage milestones)

The atelier plans work in the **"📅 Production Schedule"** Notion database
(`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`), which has ready-made Timeline and
Calendar views keyed on `Target Completion Date`. To fill it, the app
**auto-generates one dated milestone row per remaining stage** for any custom
order that has a firm due date. The load-bearing points:

1. **Trigger is a reconciliation cron (plus an on-demand button), not a Notion
   push.** There is no Notion→app trigger (see the deposits/status notes), so the
   atelier sets a `Due Date` on the order in the Order Tracking Pipeline and the
   reconciliation later scans for orders that have a due date but whose
   `Milestones Generated` checkbox is unset, and generates their milestones. It
   runs two ways, both calling `reconcileMilestones` (generation + reminder
   passes; milestone completion state is a live Notion formula now, see point 4): a **Vercel Cron** job
   nightly (`GET /api/cron/generate-milestones`, Bearer `CRON_SECRET`, JSON; in
   `vercel.json` `crons`) and an on-demand **Notion "Open link" button**
   (`GET /api/cron/generate-milestones/run?secret=<CRON_SECRET>`, query token,
   returns an HTML confirmation — a native button can't send a Bearer header). The
   query token sits in the button config + browser history (the request logger
   strips it), so it's a low-stakes reuse of `CRON_SECRET` for an idempotent
   internal action; rotate it or add a dedicated token if that matters. Both
   endpoints are CRON_SECRET-guarded and, like the Stripe webhook, **deliberately
   outside the OpenAPI contract** (mounted in `app.ts`, not the `/api` router).
   Code: `routes/cron.ts` → `services/schedule.service.ts` →
   `lib/notion/orders.repository.ts`
   (`findOrdersNeedingMilestones`/`markMilestonesGenerated`) +
   `lib/notion/production-schedule.{blocks,repository}.ts`.

2. **Scheduling is even-split over the live stage list — don't hardcode stages.**
   `computeMilestoneSchedule` spreads the stages from the order's current stage
   forward evenly across `[today, dueDate]` (the final stage lands on the due date;
   a past-due date clamps all to the due date). The stage list comes live from
   Notion via `fetchLiveOrderStages`, so the schedule adapts when the atelier edits
   stages. The milestone's `Production Stage` is written to a **select** property,
   which Notion auto-creates options for, so no stage constant is baked in either.
   (`Production Stage` is the stage label — named apart from the milestone's
   completion state, the derived `Milestone Status` formula, see point 4.)

3. **Idempotent.** The `Milestones Generated` checkbox plus an
   existing-milestones lookup (`orderHasMilestones`, by the `Order` relation) stop a
   re-run from duplicating rows; the checkbox is only flipped after every row for an
   order is written, and one order's failure is logged-and-skipped (retried next run)
   rather than aborting the batch. To **reschedule** after changing a due date, uncheck
   `Milestones Generated` (and delete the stale rows); the next run regenerates.

4. **Status stays live via a Notion formula — no sync pass (Phase-2 "let the
   schedule read").** A milestone's completion state is the **`Milestone Status`**
   _formula_ on the Production Schedule DB, derived live from the order's `Stage`:
   an **`Order Stage Index`** rollup reads the order's stage (through a
   `Stage Index Sys` index formula on Custom Orders, status→0–10), and
   `Milestone Status` compares this row's `Production Stage` index to it — past →
   `Completed`, current → `In Progress` (`Completed` at the last/Delivered stage),
   ahead → `Not Started`, unknown → blank. So the "Coming Up" calendar reflects real
   progress with **nothing to sync** — the old `syncMilestoneStatuses` /
   `milestoneStatusFor` / `updateMilestoneStatus` pass was retired, and
   `buildMilestoneProperties` no longer seeds a status. Trade-off: the two formulas
   **hardcode the 11-stage pipeline order** (generation still reads the live
   `fetchLiveOrderStages` list; the formulas degrade to blank for an unknown stage),
   so renaming/reordering Stage options means updating them. The fitting-reminder
   query reads `Milestone Status` **client-side** (it filters the query only on the
   `Production Stage` select + `Reminder Sent` checkbox, then evaluates the
   completed / due-or-in-progress conditions from each row's computed value) —
   because a `formula: {…}` **filter** on this rollup-derived formula 400s via the
   API ("Unable to filter based on a formula of unknown type"), even though reading
   the value back per row works. Details + the API-formula gotchas + the one-time setup
   (add the rollups/formulas; the old status-type `Status` property is dropped
   post-deploy) live in `.agents/memory/phase2-workspace-cards.md`.

The atelier must, one time: add `Due Date` (date) + `Milestones Generated`
(checkbox) to the Order Tracking Pipeline; add `Production Stage` (select) +
`Order` (relation → Order Tracking Pipeline) to the Production Schedule; share the
Notion integration with the Production Schedule database; set
`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID` + `CRON_SECRET`; and (optional) add a
Notion **Button** → "Open link" →
`https://<PUBLIC_BASE_URL>/api/cron/generate-milestones/run?secret=<CRON_SECRET>`
on a dashboard page to generate milestones on demand. Property names live in
`orders.schema.ts` (orders) and `production-schedule.blocks.ts` (schedule).

## Automated fitting reminders

When a custom order's **"Fitting"** production milestone is approaching, the app emails
the customer a best-effort nudge to book (or confirm) their fitting, with a deep link
straight into the booking flow (`/appointments?type=fitting`). It **wires two existing
systems together** — the milestone reconciliation and the Resend mailer — with no new
endpoint, no new cron, and no frontend change (the booking page already preselects a type
from `?type=`). Load-bearing points:

1. **It rides the nightly reconciliation, not a new trigger.** `reconcileMilestones`
   (the Vercel cron + the on-demand button) runs a pass, `sendDueFittingReminders`,
   after generation. It finds Production Schedule milestones whose
   `Production Stage` is a configured fitting stage, aren't `Completed`, haven't been
   reminded yet, and are **either** due on/before `today + FITTING_REMINDER_LEAD_DAYS`
   **or** already at the fitting stage (`Milestone Status = In Progress`, the derived
   formula) — then emails the order's
   customer. The In-Progress clause is what catches an order running **ahead of
   schedule**: it reaches Fitting before the target date, so a date-only filter would
   never fire before the stage advances to `Completed` and the reminder would be missed
   entirely. (`Milestone Status` is a live formula derived from the order's stage, so
   it's always current.) Code: `services/schedule.service.ts` (`sendDueFittingReminders`) →
   `services/fitting-reminder.ts` (the business-rule config) +
   `lib/notion/production-schedule.repository.ts`
   (`findMilestonesNeedingFittingReminder` / `markFittingReminderSent`) +
   `fittingReminderEmail` in `lib/resend/emails.ts`.

2. **"Fitting" is a targeted business rule, not hardcoded logic.** `fittingReminderStages()`
   reads `FITTING_REMINDER_STAGES` (comma-separated live Stage option names; default
   `Fitting`) and `fittingReminderLeadDays()` reads `FITTING_REMINDER_LEAD_DAYS` (default
   `10`) — the same deliberate exception as `STATUS_IN_STOCK` /
   `MEASUREMENT_LOCK_FROM_STAGE`. Rename the Fitting stage in Notion and set the override
   (or list a first/second fitting). The email's booking link uses `PUBLIC_BASE_URL` and
   is omitted when unset (graceful, like the stage-change email's tracking link).

3. **Idempotent via a per-milestone `Reminder Sent` checkbox.** The reminder is de-duped
   with a `Reminder Sent` checkbox on the Production Schedule row (the analogue of the
   order's `Milestones Generated` / `Last Notified Stage` markers): a due milestone is
   emailed once, then marked, so the nightly cron never re-sends. An absent/unchecked box
   reads as `false`, so new milestones need nothing set. A milestone is marked reminded
   **even when the order carries no email** (a legacy order can't be reached — marking it
   stops a nightly re-check); if the order lookup itself throws, the row is left unmarked
   so the next run retries it, with per-milestone failures logged and skipped like the
   other passes.

4. **Customer email only + best-effort, like the newsletter.** The reminder sends from the
   **appointments** sender (`fromAddress("appointments")`) and is best-effort (a Resend
   failure is logged-and-swallowed, never fails the cron). There is deliberately **no**
   internal atelier notification — the atelier already sees the schedule/calendar, so a
   per-reminder studio email would be noise (same rationale as the newsletter opt-in). The
   milestone rows don't carry the customer email, so each order is resolved back from its
   `Order` relation via `findOrderForStageNotificationByPageId`.

There are **no new env vars required** (it reuses `CRON_SECRET`, `PUBLIC_BASE_URL`, the
Resend vars, and `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`); the two optional knobs above
tune it. The atelier's one-time setup is adding a **`Reminder Sent`** (checkbox) property
to the "📅 Production Schedule" database (the app writes it; leave it unchecked).

## Payment & deposit due reminders

When a custom order's **deposit or final balance is coming due — or is overdue** —
the app emails the customer a best-effort nudge to pay, using the **due dates already
on the invoice**. Like the fitting reminder, it **wires two existing systems together**
— the milestone reconciliation and the Resend mailer — with **no new endpoint, no new
cron, and no frontend change** (the CTA deep-links to the existing tracking page, where
the deposit + balance pay buttons live). Load-bearing points:

1. **It rides the nightly reconciliation, not a new trigger.** `reconcileMilestones`
   (the Vercel cron + the on-demand button) runs a fourth pass, `sendDuePaymentReminders`,
   after generation + fitting reminders. It queries the **"invoices &
   payments"** database for invoices with an unpaid stage whose due date is **on or before
   `today + PAYMENT_REMINDER_LEAD_DAYS`** (which naturally covers already-overdue stages)
   and whose per-stage `Reminded` marker isn't set, then emails the order's customer one
   reminder **per due stage**. Because the invoice rows don't carry the customer email, each
   order is resolved back from the invoice's **`Order` relation** via
   `findOrderForStageNotificationByPageId` (the same resolver the stage-change + fitting
   emails use) — the **only** place the app navigates invoice → order (everywhere else it
   reads an invoice _from_ an order's `Invoices` relation). Code:
   `services/schedule.service.ts` (`sendDuePaymentReminders`) → `services/payment-reminder.ts`
   (the business-rule config) + `lib/notion/invoice.repository.ts`
   (`findInvoicesNeedingPaymentReminder` / `markPaymentStageReminded`) +
   `extractPaymentReminderInvoice` in `lib/notion/invoice.schema.ts` + `paymentReminderEmail`
   in `lib/resend/emails.ts`.

2. **Every amount is read from the invoice, never invented.** A deposit's amount is its
   `First/Second Deposit Amount`; the balance is `Final Balance` − the deposits already
   marked paid (mirroring `buildInvoiceView`'s `balanceDue`, without fetching line items),
   floored at 0 and **omitted from the email** when `Final Balance` isn't set yet. This keeps
   the "Notion/invoice is the source of truth for money" rule intact. The three stages'
   field mapping (due date, paid checkbox, `Reminded` marker, label) is the single
   `PAYMENT_STAGE_REMINDER_FIELDS` table, the payment analogue of `DEPOSIT_STAGE_FIELDS`;
   the balance's due date reuses the existing `Payment Deadline`.

3. **Idempotent via a per-stage `Reminded` checkbox.** Each stage is reminded once — a
   `First Deposit Reminded` / `Second Deposit Reminded` / `Balance Reminded` checkbox on the
   invoice is flipped after the email, the payment analogue of the schedule's `Reminder Sent`
   marker. An absent/unchecked box reads as false (a new invoice needs nothing set). The order
   is resolved **once per invoice**, then each due stage is emailed + marked; a stage is
   marked reminded **even when the order carries no email** (a legacy order can't be reached —
   marking it stops a nightly re-check). If the order lookup itself throws, the invoice's
   stages are left unmarked so the next run retries, with per-invoice failures logged and
   skipped like the other passes. **This means one reminder per stage** — the first time it's
   within the window or overdue; a distinct repeated-overdue nudge would be a fast follow (a
   second marker per stage). If the reminder query 400s because the setup properties aren't
   added yet, the pass **degrades to a no-op with a warn** (like the fitting reminder's missing
   `Reminder Sent` checkbox), so the nightly cron doesn't alert until the atelier configures it.

4. **Customer email only + best-effort, like the fitting reminder.** The reminder sends from
   the **orders** sender (`fromAddress("orders")`) and is best-effort (a Resend failure is
   logged-and-swallowed, never fails the cron). There is deliberately **no** internal atelier
   notification — the atelier already sees the invoice's `Payment Status` in Notion, so a
   per-reminder studio email would be noise (same rationale as the fitting reminder / newsletter
   opt-in). The email's pay link uses `PUBLIC_BASE_URL` (`/track?orderNumber=…`) and is omitted
   when unset.

There are **no new env vars required** (it reuses `CRON_SECRET`, `PUBLIC_BASE_URL`, the Resend
vars, and the invoice database ids); the one optional knob is `PAYMENT_REMINDER_LEAD_DAYS`
(default `7`), a targeted business rule like `FITTING_REMINDER_LEAD_DAYS`, read in
`services/payment-reminder.ts`. The atelier's one-time setup on the **"invoices & payments"**
database: add the per-stage due dates **`First Deposit Due`** / **`Second Deposit Due`** (date)
— the balance reuses the existing **`Payment Deadline`** — and three checkboxes **`First Deposit
Reminded`** / **`Second Deposit Reminded`** / **`Balance Reminded`** (the app writes them; leave
unchecked). Until those exist the pass is a no-op.

## Post-delivery review capture

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

1. **"Delivered" is positional, not a flag — don't hardcode a stage.** There is
   no "delivered" field on an order; the review gate (`orderDelivered` in
   `services/delivery.ts`) treats the **last** stage in the live
   `fetchLiveOrderStages` list as delivered, exactly as `schedule.service.ts`
   does. The frontend recomputes the same test to decide whether to show the
   review affordance, so the two can't disagree. It **fails closed** (no review)
   when the stage is unknown or the list is empty — a review is a one-way action
   we'd rather withhold on a stale read. This is the mirror of
   `measurement-lock.ts` (which fails **open**), and the trade-off is deliberate.

2. **Two gates, same identity model as measurement-change.** The order must be
   delivered (else `ConflictError` → 409) and the supplied email must match the
   one on the order (`ForbiddenError` → 403); a legacy order with no stored email
   is accepted but flagged **`Email Verified = false`** for the atelier to vet
   before featuring it. The lookup reuses `findOrderVerification` (the renamed,
   generalized `findOrderForMeasurementChange`, kept as an alias).

3. **Reviews get their own database + the atelier curates.** Unlike the three
   contact-inbox writers, reviews land in a dedicated **"Reviews"** database
   (`NOTION_REVIEWS_DATABASE_ID`, required for the feature; the repository throws
   if unset). Each row carries `Rating` (number), `Review` (rich_text),
   `Customer Name`, `Order Number`, `Email`, `Consent to Publish` (checkbox),
   `Email Verified` (checkbox), a `Status` **select** defaulting to **"New"**
   (the atelier moves it to "Published" to feature it), and an optional
   best-effort `Client` relation to the CRM. Property names live in
   `reviews.blocks.ts`.

4. **Photos reuse the reference-image upload — no new service.** The browser
   uploads each finished-piece photo through the same
   `POST /api/orders/reference-images` raw-bytes endpoint the order form uses
   (via the shared `ReferenceImageUpload` component + `lib/reference-images.ts`),
   collects the returned `file_upload` ids, and sends them as the review body's
   `photoIds`; `reviews.blocks.ts` attaches them as image blocks on the review
   page (like `orders.blocks.ts` does for reference images).

5. **Best-effort email + CRM, like every submission flow.** A customer thank-you
   (and an atelier notification when `ATELIER_INBOX_EMAIL` is set) go out via
   Resend under the **"orders"** category; the Client CRM upsert links the review
   to the customer. Both are best-effort — a failure never fails the request, the
   Notion row is the source of truth.

The atelier must, one time: create the "Reviews" database with the properties
above, share the Notion integration with it, set `NOTION_REVIEWS_DATABASE_ID`,
and (optionally) add a `Client` relation to Client CRM.

## Rush order surcharge

A custom order whose **needed-by date is sooner than the studio's standard lead
time** is a **rush order** and carries a surcharge. The intake form
(`pages/order-form.tsx`) detects this off the existing "Needed By" date, discloses
the surcharge, and requires the customer to **acknowledge** it before the order can
be placed; the order is recorded with a rush flag so the atelier prices the fee in.
Load-bearing decisions:

1. **The fee is priced server-side, as one more invoice line written to Notion.**
   When the atelier presses the invoice-line-item generator for a rush order, it
   appends a **"Surcharge"** line (`Line Type = "Surcharge"`) priced at
   `RUSH_SURCHARGE_RATE` (default **15%**) of the itemized garment subtotal
   (materials + labor + the reconciling adjustment, i.e. the costing's Suggested
   Price). Pricing the fee server-side but **writing it to Notion** is what keeps
   the "Notion/invoice is the source of truth for money" rule intact — the app
   never invents a total that diverges from Notion's `Final Balance`. The line then
   flows into the balance like any other (`buildInvoiceView` sums all non-`Deposit`
   lines) and renders on the invoice under its own "Surcharge" heading
   (`lib/invoice-format.ts` — a known type ordered last, after Adjustments). The
   generator never links a costing item on the surcharge line (same double-charge-
   proofing as every generated line), and it's covered by the same idempotency
   guard (a re-press on an already-itemized invoice adds nothing). Code:
   `services/rush.ts` (rate + line name) + `services/invoice-generator.service.ts`.

2. **Rush is derived from the date + an explicit acknowledgement.** `isRushNeededBy`
   (`web-app/src/lib/rush.ts`) is true when the needed-by date falls within
   `RUSH_WINDOW_DAYS` of today. When true, the form shows the surcharge notice and a
   required acknowledgement checkbox (a `superRefine` blocks submit until it's
   ticked), and sends `rush: true` on the order. A standard-timeline date sends no
   `rush` field. The `rush` boolean is part of the OpenAPI contract
   (`NewOrderRequest.rush`, contract-first + generated client).

3. **Recorded as a flag, two ways.** `buildOrderProperties` sets a **`Rush Order`
   checkbox** (property, filterable in Notion) and `buildOrderPageBlocks` adds a
   "Rush Order: Yes — rush surcharge applies" body note, both only when `rush` is
   true (`ORDER_RUSH_PROPERTY` in `orders.schema.ts`). The app reads neither back —
   they're an atelier signal, like the Due Date.

Three knobs, all with defaults (keep the frontend disclosure and the server rate
in step): the frontend window + copy are **build-time** Vite env —
`VITE_RUSH_WINDOW_DAYS` (default `21`) and `VITE_RUSH_SURCHARGE_NOTE` (default
`"a 15% rush surcharge"`) — and the server fee is `RUSH_SURCHARGE_RATE` (default
`0.15`, read at call time; `0` disables the surcharge line). No atelier setup
beyond the **`Rush Order` checkbox** on Custom Orders (already added): the generator
writes the `Surcharge` `Line Type` option, which Notion auto-creates on first write.
Code: `web-app/src/lib/rush.ts` + `pages/order-form.tsx` (frontend detect/disclose/
acknowledge); `orders.blocks.ts` + `orders.schema.ts` (backend record);
`services/rush.ts` + `services/invoice-generator.service.ts` (server-side priced
line); `web-app/src/lib/invoice-format.ts` (display).

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
   existing **Reference Images** upload on step 1 (no separate uploader).

4. **Recorded on the order (write-only).** `orders.blocks.ts` writes the picks as a
   **`Colors` multi_select** (the picked names — filterable in Notion) + a **`Color
Usage` rich_text**, and mirrors both as readable **page-body blocks** in the
   Costume Details section. The app **never reads these back** — they're an atelier
   signal. Property-name constants (`ORDER_COLORS_PROPERTY`,
   `ORDER_COLOR_USAGE_PROPERTY`) live in `orders.schema.ts`.

The color step is the second page of the two-step intake flow (step 1 = details, step
2 = "Colors" + submit); see `order-form.tsx` (`STEPS`, the step gating). The atelier's
one-time setup is **nothing** — the built-in primary palette works out of the box. To
customize, add a **`COLOR_PALETTE`** row to the "Studio Settings" database with a
`Value` like `Emerald #0B6E4F, Rose Gold #C5878C, Navy #1F2A44` (or set the
`COLOR_PALETTE` env var); and add a **`Colors` (multi_select)** + **`Color Usage`
(rich_text)** property to the **Order Tracking Pipeline** database for the write-back.
Code: `openapi.yaml` (`/colors` + `Color`/`ColorList` + `colors`/`colorUsage` on
`NewOrderRequest`), `services/colors.ts` + `routes/colors.ts`, `orders.{schema,blocks}.ts`
(write-back), and `web-app/src/components/color-picker.tsx` + `pages/order-form.tsx`.

## Referral & returning-skater rewards

Every customer gets a shareable **referral code**; when a skater they refer places
their first order, the referrer earns a **credit** and the new skater got a
**welcome discount** — and any repeat customer earns a **standing discount**. All
three are delivered as **Stripe promotion codes** the customer redeems in the
checkout promo box, which already exists (`allow_promotion_codes: true` is on every
Checkout path). The whole feature rides the **email-keyed Client CRM** (the returning-
customer identity is already there) and adds **no new database** — reward state lives
on the CRM row. Code: `services/rewards.service.ts` (the engine),
`lib/stripe/promotions.ts` (`createDiscountCode`), and reward state on the CRM
(`lib/notion/clients.repository.ts`). Load-bearing decisions:

1. **Two mechanics, one engine, driven from the paid-order moment.** There is no
   Notion→app trigger, but every moment that matters runs in-app: an order is
   _placed_ via `POST /orders` (`submitOrder`) and _paid_ via the Stripe webhook
   (`recordPaidOrder` / `recordPayment`). `submitOrder` calls
   `captureReferralOnOrder` (stamp the referrer link + email the new skater their
   welcome code); the two webhook recorders call `runPaidOrderRewards(email,
orderNumber)` at their tails, which issues the **referrer credit** (once the referred
   order is paid — anti-abuse) and the **returning-skater standing discount**.

2. **Everything is best-effort + CRM/Stripe-optional.** A reward failure must never
   fail an order or 500 the webhook (a throw into the webhook makes Stripe retry, and
   the retry early-returns at the dedupe guard, so the reward would be lost) — every
   entry point is `try/catch` + `logger.warn`, exactly like the `upsertClientByEmail`
   side effects. When `NOTION_CLIENT_CRM_DATABASE_ID` is unset (or Stripe isn't
   configured) every reward path no-ops.

3. **Idempotency is layered.** A CRM checkbox is the fast guard —
   `Referral Rewarded` (credit once per referred customer) and
   `Returning Reward Issued` (standing code once) — backed by Stripe's globally-unique
   promo `code` + a per-reward `idempotencyKey` (`createDiscountCode` treats
   `resource_already_exists` as success). The returning trigger keys off
   **`First Paid Order`** (a rich*text holding the customer's first paid order
   \_number*), not a boolean: a webhook retry or a later payment stage of the _same_
   order carries the same number and can't fire the reward — only a genuinely
   different second order does.

4. **Two-sided referral, self/abuse-guarded.** `captureReferralOnOrder` resolves the
   code to a referrer (`findClientByReferralCode`), rejects a self-referral and an
   unknown code, skips an already-captured customer, then stamps
   `Referred By Email` and issues the welcome code. The **referrer's** credit is a
   fixed `$` amount (with a `minimum_amount` restriction so a large single-use credit
   isn't burned on a tiny order); the welcome + returning codes are **percentages**
   (no currency mismatch with the USD checkouts). The referral **capture** surface is
   custom-order-only for now (`NewOrderRequest.referralCode`, contract-first); the
   returning discount + the referrer's own redemption work on any checkout.

5. **Surfaced in the account portal.** `getAccountOverview` calls `ensureReferralCode`
   (best-effort), which generates a deterministic short code on first view and returns
   `AccountOverview.referral` (`{ code, creditAmount, returningCode? }`); `pages/account.tsx`
   renders a "Refer a friend" card with copy-to-clipboard. Absent when the CRM is off.

6. **Amounts are Studio-Settings tunables** (`services/rewards.service.ts` getters,
   the `rush.ts` pattern — Notion → env → default): `REFERRAL_CREDIT_AMOUNT` (40),
   `REFERRAL_WELCOME_PERCENT` (10), `RETURNING_DISCOUNT_PERCENT` (10),
   `REWARD_CODE_EXPIRES_DAYS` (90).

The atelier's one-time setup is **seven properties on the Client CRM** database (no
new database, no new env var, no Stripe Dashboard setup — codes are created
programmatically): `Referral Code`, `Referred By Email`, `Referral Rewarded`
(checkbox), `First Paid Order`, `Returning Reward Issued` (checkbox),
`Referral Credit Code`, `Returning Discount Code`. Code: `services/rewards.service.ts`,
`lib/stripe/promotions.ts`, `lib/notion/clients.repository.ts` (reward reads +
`patchClientProperties`), the three reward builders in `lib/resend/emails.ts`, the
`submitOrder` / `recordPaidOrder` / `recordPayment` tails, `services/account.service.ts`,
`pages/order-form.tsx` + `pages/account.tsx`.

## Order status-change emails (Notion automation → webhook)

When a custom order advances to a new production stage, the customer gets an email
with a **pipeline graphic** — a simplified, inline-HTML version of the on-site
tracking timeline (completed / current / upcoming stages) — so they see where their
piece is without opening the tracking page. Like everything else, the stage change
happens **inside Notion**, and there's no Notion→app trigger, so this is driven by a
**Notion database automation** rather than a request or a cron. Load-bearing points:

1. **Trigger is a Notion automation, not a poll.** The atelier adds a database
   automation on the Order Tracking Pipeline — _when `Stage` changes_ → _send
   webhook_ to `POST /api/webhooks/notion-stage-change`. **No hand-authored body is
   needed**: Notion's default "Send webhook" payload carries the triggering page
   under `data.id`, and the route resolves the order off that page id (newer Notion
   often exposes only headers + a fixed payload, no editable body). An authored body
   `{ "orderNumber": … }` (or `?order=`) is still accepted and preferred when present.
   The POST is mounted with `express.raw` (before the JSON parser, like the Stripe
   webhook) and JSON-parses the buffer itself, so the body is read regardless of the
   Content-Type Notion sends — its webhook action sets the Content-Type and won't let
   you override it, so we can't assume `application/json`.
   Auth reuses `CRON_SECRET`, accepted two ways: an **`Authorization: Bearer
<CRON_SECRET>` header** (preferred — the Notion automation supports custom headers,
   and it keeps the token out of the URL and logs) **or** a `?secret=<CRON_SECRET>`
   query token (the fallback the browser `/run` link uses, since a link can't send
   headers). Both this and the on-demand `…/run` link are **outside the OpenAPI
   contract**, mounted directly in `app.ts` like the Stripe webhook.

2. **Re-fetch, don't trust the payload.** The webhook carries only an identifier (a
   page id or order number); the server reads the order back from Notion —
   `findOrderForStageNotification` (by number) or `findOrderForStageNotificationByPageId`
   (by `data.id`), both like `findOrderByNumber` but including the customer `Email` —
   and renders the email from the live `Stage` + live stage list, never from the
   webhook's own copy. The send is **best-effort** (from the **orders** sender,
   `orders@`): a Resend failure is logged-and-swallowed and never turns the webhook
   into an error, same contract as every other customer email. A missing email or
   unset stage is a graceful skip.

3. **Forward-only, via a `Last Notified Stage` marker.** The email is sent only when
   the order has moved **forward** past the stage the customer was last emailed about.
   The Notion webhook payload doesn't carry the _previous_ stage (and an automation
   condition can't compare status ordering), so the server keeps a `Last Notified
Stage` **rich_text** property on the order: it reads the marker, sends only when the
   current stage is strictly ahead of it in the live pipeline, then advances the marker
   to the current stage. A **backward** edit (a correction/rework) or a **re-fire** of
   the same stage is skipped — the customer is never emailed about moving backward, and
   double-fires are deduped for free. The marker is a **high-water mark** (it only ever
   advances), so re-traversing already-notified stages after a rework doesn't re-email.
   An empty marker (an order that predates this / was never notified) counts as forward,
   so the first genuine change emails. The gate is the pure `isForwardStageChange`
   (`order-notification.service.ts`); the marker write is best-effort (a write hiccup at
   worst risks one duplicate on a later double-fire, never a wrong-direction email).

4. **On-demand + test trigger.** `GET /api/webhooks/notion-stage-change/run?secret=
<CRON_SECRET>&order=<ORD>` runs the same send from a browser and returns an HTML
   confirmation. This is how the atelier **tests in production** — hit the link for
   one test order (their own email) and no customer is touched, because no automation
   is firing for real orders until it's wired up. It's also a manual "notify now";
   append **`&force=1`** to resend even when the order hasn't moved forward (a forced
   resend never rewinds the high-water marker). The automation itself never forces.

5. **Per-order button (fallback to the automation).** The `…/run` link doubles as a
   one-click **per-order button**: a `Send Status Update` **formula property** on the
   Order Tracking Pipeline builds the clickable URL
   `"https://<PUBLIC_BASE_URL>/api/webhooks/notion-stage-change/run?secret=<CRON_SECRET>&order=" + prop("Order Number")`
   (a formula returning a URL renders as a link — same pattern as the invoice-generator
   button). The atelier advances the `Stage`, then clicks the link to email the
   customer — no automation needed. It's forward-only like everything else (clicking
   again at the same stage is a no-op), so it's a reliable alternative when the Notion
   `Stage`-change automation can't be used (e.g. a Notion plan without webhook actions).
   Reuses `CRON_SECRET`; the token sits in the formula + browser history (low-stakes,
   same tradeoff as the milestone/invoice buttons).

There are **no new env vars** (it reuses `CRON_SECRET` for auth, `RESEND_FROM_EMAIL`
for the `orders@` sender via `fromAddress("orders")`, and `PUBLIC_BASE_URL` for the
tracking link, omitted when unset). The atelier's one-time setup is the Notion
automation above **plus** adding a **`Last Notified Stage`** (rich_text) property to
the Order Tracking Pipeline (the app writes it; leave it empty). The per-stage
description text in the email mirrors the frontend's
`web-app/src/lib/stage-descriptions.ts` (cosmetic flavor, graceful fallback for
unknown stages). Code: `orderStageChangeEmail` in `lib/resend/emails.ts` (the template

- pipeline graphic), `findOrderForStageNotification` /
  `findOrderForStageNotificationByPageId` + `updateLastNotifiedStage` in
  `lib/notion/orders.repository.ts`, `services/order-notification.service.ts`, and
  `routes/order-notification.ts`.

## Appointment scheduling (real-time slot booking)

Customers book appointments (consultations, fittings, design reviews, general)
with a staff member from `pages/appointments.tsx` — a four-step flow (purpose →
format → time → details) that goes through the generated client
(`useGetAppointmentOptions`, `useGetAppointmentAvailability`,
`useCreateAppointment`). Scheduling runs on **Google Calendar** (not Notion):
free/busy is the conflict source and each booking is a calendar event. Code lives
in `api-server/src/lib/appointments/*` (pure logic + config),
`lib/google/*` (Calendar I/O), `services/appointments.service.ts`, and
`routes/appointments.ts`. Load-bearing decisions:

1. **The type catalog is a targeted business rule in code.**
   `lib/appointments/catalog.ts` names the four types, their durations, and their
   routing rules (consultations are Alayna only; fittings, design reviews, and
   general appointments can be booked with either Alexandra or Alayna; fittings
   are in-person only). Like `STATUS_IN_STOCK`, these are
   values coupled to code (duration drives slot
   math; staff/locations drive UI + validation). Retune a duration or rename a
   staff member here; the staff names must match the `Staff` column in the
   working-hours sheet (below).

   **Booking gates split by who a type is for** (added to stop strangers who
   don't understand the atelier from booking): each type carries one of two
   optional flags in the catalog. Order-scoped types (**fittings, design
   reviews**) set `requiresOrder` — they only make sense once someone has an
   order, so `bookAppointment` requires an `orderNumber` on the request and
   verifies it with `findOrderVerification` (the same email-matched check the
   measurement-change/review flows use): missing number → 400, unknown order →
   404, mismatched email → 403, legacy order with no stored email → accepted
   (can't lock those customers out). New-customer types (**consultations,
   general**) set `requiresProjectDetails` — a new customer has no order number,
   so instead the request must carry a non-empty `projectDetails` describing what
   they want made (blank → 400), a light screen on the funnel. Both fields are
   optional on `NewAppointmentRequest` (contract-first) and required only by the
   flagged type; the frontend (`pages/appointments.tsx`) renders the matching
   field in the details step and enforces the same requirement client-side, and
   `getAppointmentOptions` surfaces the flags so the UI knows which to show
   (the Purpose step also labels order-scoped types "Requires an order number").
   Both values are recorded on the calendar event + the atelier notification
   email so the studio sees the order / the ask up front. Enforced in
   `services/appointments.service.ts` (`enforceBookingGate`). To change which
   types are gated, flip the flags in the catalog — no other code changes.

2. **Working hours are a Google Sheet; conflicts are Google free/busy.**
   `computeSlots` (`lib/appointments/availability.ts`, pure + heavily unit-tested)
   needs a _positive_ grid of open hours, which Google free/busy can't give (it
   only says when someone is _busy_). That grid comes from a **Google Sheet** the
   atelier edits live (no redeploy) — columns `Staff | Email | Day | Start | End |
Locations`. `lib/google/sheets.repository.ts` reads it (`APPOINTMENT_SHEET_ID`,
   60s cache + fallback, service account reads it as itself via a direct share)
   and `lib/appointments/staff.ts` is the pure `parseScheduleRows` parser
   (`Mon-Fri` ranges, comma lists). The _subtractive_ side — every busy interval,
   including existing bookings **and** any event the staff added (a day off is
   just a calendar event) — comes from the **FreeBusy API** in
   `lib/google/calendar.repository.ts` (`listBusyInRange`), fed into `computeSlots`
   as `bookings`; `timeOff` is always empty. All wall-clock hours/slots are
   interpreted in `APPOINTMENT_TIMEZONE` (DST-correct via
   `lib/appointments/time.ts`, built on `Intl` — no date library); busy/bookings
   are UTC instants.

3. **Never trust a client-sent slot.** `POST /appointments` re-derives the type
   from the catalog and re-runs the _same_ `computeSlots` for the requested day
   (with fresh free/busy) before writing; a `start` that isn't currently an open
   slot (stale, taken, off the grid, or inside the lead-time window) is a
   `BadRequestError` (→ 400). The availability endpoint and the booking re-check
   share one function, so they can't disagree. Free/busy is read **fresh** (no
   cache) for this reason.

4. **Booking writes a calendar event, as the staff member.** Auth is a Google
   **Workspace service account with domain-wide delegation** (`lib/google/client.ts`):
   it impersonates each staff member (the `subject`) to read their free/busy and
   `events.insert` on their calendar with `sendUpdates=all` (a real Google invite
   to the customer) and, for virtual, a Google Meet link (`conferenceData`). The
   Meet link + calendar link flow back into the response, the confirmation email,
   and the success screen. Google Calendar is the sole record — there is **no**
   Notion appointments database.

5. **Booking is free (no payment) and slots aren't held.** v1 has no Stripe step
   and no pending-hold: two simultaneous bookings for the same slot is a small,
   accepted race for a low-volume atelier. Booking policy is env-tuned:
   `APPOINTMENT_TIMEZONE`, `APPOINTMENT_MIN_LEAD_HOURS` (default 24),
   `APPOINTMENT_MAX_ADVANCE_DAYS` (45), `APPOINTMENT_SLOT_STEP_MINUTES` (15) —
   all read at call time in `lib/appointments/settings.ts`.

6. **Google setup.** Enable the Calendar API **and the Sheets API** + create a
   service account (JSON key → `GOOGLE_SERVICE_ACCOUNT_KEY`); authorize its client
   id for `https://www.googleapis.com/auth/calendar` under Workspace Admin →
   Security → API controls → Domain-wide delegation (for the calendar
   impersonation). The working-hours **Sheet is shared with the service-account
   email** (Viewer) — no delegation needed for Sheets, since the SA reads it as
   itself. `google-auth-library` mints the tokens (impersonated for Calendar,
   plain for Sheets); the rest is raw `fetch`, mirroring the Notion adapter.

### Self-service reschedule & cancel (signed manage link)

A customer can **reschedule or cancel** their own booking from a link in the
confirmation email — no sign-in — freeing the slot automatically. Because there is
**no appointments database** (the booking is only a Google Calendar event) and the
booking flow used to discard the event id, the durable handle is a **signed HMAC
token** (`lib/auth/tokens.ts`, signed with `SESSION_SECRET`; its `"appointment"`
purpose — now the **only** token purpose, since sign-in moved to Supabase Auth —
carries `{ email, eventId, staff }`, 60-day TTL). Load-bearing decisions:

1. **The token is the authorization**, like a magic link — possession of the
   `${PUBLIC_BASE_URL}/appointments/manage?token=…` link is proof, no cookie/account.
   `bookAppointment` mints it after the event is created and embeds it in the
   confirmation email (`manageUrl` on `AppointmentEmailDetails`). Gated on
   `authConfigured()` + `PUBLIC_BASE_URL` (`buildManageUrl`); unset ⇒ the link is
   omitted and the email falls back to "reply to us" — inert-safe like the portal.
   **No new env var / no atelier setup.**

2. **The calendar event is the record — read live, never trust the token's copy.**
   `createCalendarEvent` now returns the event `id` and stamps private
   `extendedProperties` (`EVENT_PROP_*`: type, location, confirmation, email, name)
   so the event is self-describing. `lib/google/calendar.repository.ts` gained
   `getCalendarEvent` (404/410 ⇒ null), `updateCalendarEvent` (PATCH = a merge, so
   attendees/Meet/props survive), and `cancelCalendarEvent` (DELETE, 404/410 ⇒
   idempotent success), all `sendUpdates=all` so Google re-notifies and the slot
   frees.

3. **Reschedule re-runs the same `computeSlots`** as booking, **locked to the same
   staff/type/location** (a move, not a rebooking — PATCH can't change calendars).
   Known limit: the current booking counts as busy, so a new time overlapping the
   old one isn't offered. 404 if gone, 409 if already started/cancelled, 400 if the
   slot isn't open.

4. **Contract-first** (unlike the webhook/cron routes): `GET /appointments/manage`,
   `POST /appointments/reschedule`, `POST /appointments/cancel` are in
   `openapi.yaml` with generated hooks — ordinary SPA JSON calls.
   `AppointmentDetails` carries `timezone` so the manage page renders times without
   a second options fetch. Emails (reschedule/cancel confirmations + an atelier
   change notice) are best-effort from the appointments sender, same contract as
   every appointment mail. Code: `services/appointment-manage.service.ts`,
   `routes/appointments.ts`, `lib/resend/emails.ts` (`appointmentRescheduledEmail`/
   `appointmentCancelledEmail`/`appointmentChangeNotificationEmail`),
   `web-app/src/pages/appointment-manage.tsx` (+ shared `lib/appointment-format.ts`).

The roadmap card's **day-before reminder** is a deliberate fast-follow (not built
here): it needs a new cron doing a net-new `events.list`-by-window plus a per-event
`aptReminded` marker — the extended-property model above is the groundwork. See
`.agents/memory/appointment-reschedule-cancel.md`.

## Customer account portal (Supabase Auth)

A signed-in **home base** that gathers a customer's custom orders and shop orders
in one place, so they don't have to remember an order number per garment. It
reuses the data the app already exposes — the portal is an identity layer over
the existing lookups, not new order/invoice logic. Auth runs on **Supabase Auth**
(the customer-facing half of the Phase-3 "Supabase: accounts + a real database"
work); Notion + Google Calendar stay the system of record, still matched by
**email**, so this is an auth-vendor swap, not new order/invoice logic. Frontend:
`pages/account-login.tsx` (sign-in) + `pages/account-callback.tsx` (redirect
landing) + `pages/account-reset.tsx` (password reset) + `pages/account.tsx`
(dashboard) + `lib/supabase.ts` + `lib/auth-context.tsx`. Backend:
`services/account.service.ts`, `routes/account.ts`, `middlewares/auth.ts`,
`lib/supabase/client.ts`. Load-bearing decisions:

1. **Identity is the email; there is no user table.** The dashboard is just the
   existing order/shop-order lookups **re-keyed from order number to email** — no
   accounts of our own to store or enumerate. Supabase owns the credential store
   (its `auth.users`); the app never persists a user record. `requireCustomer`
   normalizes the token's email at the gate (`normalizeEmail`) so the Notion
   lookups key on the same canonical (lowercased) form the CRM dedupes on.

2. **Sign-in is Supabase-native and browser-driven.** `pages/account-login.tsx`
   calls supabase-js directly — **email+password** (`signInWithPassword` /
   `signUp`, with Supabase-managed hashing + email verification),
   **passwordless magic link** (`signInWithOtp`), **Google OAuth**
   (`signInWithOAuth`), and **forgot-password** (`resetPasswordForEmail` →
   `pages/account-reset.tsx` → `updateUser`). There is **no** server
   login/logout/verify route — the browser holds the session and logout is
   `supabase.auth.signOut()`. OAuth + magic-link redirects land on
   `pages/account-callback.tsx`, which lets supabase-js parse the token out of the
   URL (`detectSessionInUrl`, PKCE) and forwards to `/account`.

3. **Web session transport is a Bearer JWT, not a cookie.** supabase-js holds the
   session in the browser (localStorage, auto-refreshed) and the generated API
   client sends the access token via the **`setAuthTokenGetter` seam** in
   `custom-fetch.ts` (`Authorization: Bearer <jwt>`); `lib/auth-context.tsx`
   (`AuthProvider` / `useAuth`) wires that getter once and drops the cached
   overview query on any auth-state change so data can't leak across identities.
   Tradeoff vs the old httpOnly cookie: the token is now JS-readable (XSS-exposed)
   — accepted for the standard Bearer model. (`custom-fetch.ts` still passes
   `credentials: "include"` for any incidental same-origin cookie, but the portal
   authenticates by the Bearer header, not a cookie.)

4. **The server only verifies the JWT — it holds no session.**
   `middlewares/auth.ts` `requireCustomer` reads the Bearer token and verifies it
   with `getSupabaseClient().auth.getClaims(token)` (cached JWKS, local
   verification, no per-request round-trip; supports the ES256 asymmetric keys new
   projects default to), setting `res.locals.customer = { email, userId }` (the
   `sub` claim) or throwing `UnauthorizedError` (→ 401; the frontend redirects to
   sign-in). Adapter: `lib/supabase/client.ts` (lazy first-use env read,
   `supabaseConfigured()`, test seams `__setSupabaseClientForTests` /
   `__resetSupabaseClient`). Unset `SUPABASE_URL` / `SUPABASE_ANON_KEY` ⇒ the
   portal is inert (sign-in reports "unavailable", `/account/overview` 401s) —
   same env-gated-degrade pattern as the optional integrations. The one remaining
   `/account/overview` route still carries the `accountRateLimiter`
   (`middlewares/rate-limit.ts`, `express-rate-limit`, in-memory/per-instance) as
   a cheap brake on the authorization surface.

5. **`SESSION_SECRET` is NOT retired — but it no longer signs any sign-in token.**
   `lib/auth/tokens.ts` still HMAC-signs/verifies the **`appointment`**-purpose
   manage-link token (its only remaining purpose; the old `magic` / `session`
   purposes, `lib/auth/cookies.ts`, `routes/account-verify.ts`, and `magicLinkEmail`
   were all deleted). Supabase sends the branded verify / magic-link / reset emails
   itself over **custom SMTP = Resend** (configured in the Supabase dashboard, not
   `lib/resend/emails.ts`) — the version-controlled source for that copy lives in
   `.agents/memory/supabase-auth-emails.md`.

6. **Contract.** `/account/overview` is the only account operation left in
   `openapi.yaml` (generated hook `useGetAccountOverview`), now secured with a
   `bearerAuth` (JWT) scheme; the `/account/login` + `/account/logout` ops and
   `MagicLinkRequest` were removed. `getAccountOverview` is unchanged — still
   email-keyed.

7. **Notion queries: by email.** The order/shop-order lookups are keyed by email
   via `findOrdersByEmail` (orders) and `findShopOrdersByEmail` (shop orders) —
   filtered on the `Email` / `Customer Email` property, paginated, returning
   lightweight summaries (no per-order milestone/invoice fan-out; the cards link
   out to `/track` and `/invoice/:n`). Caveat: Notion's email `equals` is
   **exact** (hence the gate-side `normalizeEmail`), and orders predating the
   `Email` property are invisible here — the customer can still track those by
   number. (The provisioned Postgres `order_index` table is the intended future
   discovery index for this, but is **not wired yet** — the overview reads Notion
   directly. See "Postgres".)

8. **Scope.** Orders + shop orders + invoices (invoices ride along the order
   detail pages) + a **referral** card (from `ensureReferralCode`, best-effort),
   plus — added in Phase 2 — **upcoming appointments** and **measurement
   history**:
   - **Appointments.** `getAccountOverview` also runs `listUpcomingAppointmentsByEmail`
     (`lib/google/calendar.repository.ts`): one `events.list` per staff calendar,
     filtered by the **`aptEmail` private extended property** stamped on every
     booking — the read-by-customer path that used to be missing (there's still no
     appointments DB; the calendar event is the record). The event→DTO mapping is the
     shared `lib/appointments/event-details.ts`, reused by the manage service so they
     can't drift. Each summary carries a freshly-signed `manageToken` (the same
     `appointment`-purpose token the confirmation email uses), so the portal's inline
     reschedule/cancel drive the **existing** `/appointments/reschedule|cancel`
     endpoints — no new mutation routes. Frontend controls are the shared
     `components/appointment-manage-panel.tsx` (also used by `pages/appointment-manage.tsx`),
     mounted by the portal's `AppointmentCard`; success invalidates the overview
     query. Best-effort: a calendar failure degrades to `appointments: []` and never
     fails the orders view. Caveat: bookings predating the `aptEmail` stamp won't list.
   - **Measurement history (display-only).** Resolved the `TODO(measurements-b)`
     migration — measurements are now written as typed Notion **properties** (five
     `number`s + a `Measurement Unit` select) in `buildOrderProperties`, alongside the
     page-body blocks the atelier reads (both from the one intake payload, so no
     drift). `extractMeasurements` reads them into `OrderSummary.measurements`, shown
     read-only under each custom order (`MeasurementsBlock`). Editing still goes
     through the measurement-change request (Approach A). Caveat: only orders placed
     **after** the migration have readable measurements; earlier ones show none.
     **Still deferred:** in-place measurement _editing_ (Approach B PATCH).

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

## Postgres (payment idempotency + a provisioned read-model)

The other half of the Phase-3 "Supabase: accounts + **a real database**" work is a
small **Postgres integrity layer**, provided by the same Supabase project. Notion
stays the record for the order lifecycle; Postgres holds only **app-owned,
integrity-bearing facts** that Notion can't enforce. It's **optional and
degrade-safe**: unset `POSTGRES_URL` ⇒ `postgresConfigured()` is false and every
caller falls back to the pre-Postgres behavior. Adapter: `lib/db/client.ts` (lazy
first-use env read, the narrow injectable `DbClient` seam — `query` + `end` — so
repos are driver-agnostic and fakeable like `NotionClient`; test seams
`__setDbForTests` / `__resetDb`). Load-bearing points:

1. **Three tables are wired today.** The single migration
   (`supabase/migrations/0001_init.sql`) provisions four tables —
   `schema_migrations`, `clients`, `order_index`, `processed_payments`. All three
   data tables have a repository and callers: `processed_payments` for Stripe
   idempotency (below), and `clients` + `order_index` as the email-keyed
   customer/order discovery index for the account portal — written **best-effort**
   on order/checkout (`upsertClientIndex` / `writeOrderIndex`, from
   `orders.service` + `checkout.service`) and read by the overview
   (`findOrderRefsByEmail`, `account.service`). When Postgres is unset the index
   no-ops and the portal falls back to reading Notion directly. A one-off
   `backfill-order-index.ts` (`pnpm db:backfill`) seeds the index from existing
   Notion orders.

2. **`processed_payments` is atomic Stripe idempotency for shop orders.**
   `lib/db/processed-payments.repository.ts` — `claimPayment` (`insert … on
conflict (stripe_session_id) do nothing`, returning `claimed` / `done` /
   `in_progress`, with a `STALE_CLAIM_MINUTES = 10` reclaim window so a crash
   between claim and confirm can't swallow a payment forever), `confirmPayment`,
   `releasePayment`. `checkout.service.ts` `recordPaidOrder` claims → writes the
   Notion order → confirms, releasing + rethrowing on failure so a Stripe
   redelivery reprocesses, and throwing on a live `in_progress` claim so a
   concurrent delivery can't race a duplicate. The Notion `findOrderBySessionId`
   guard is retained as a reclaim-only backstop, and a DB error is caught and
   logged, falling back to that Notion dedup — so a Postgres outage never blocks
   recording a paid order. **Custom-order payments don't use it** (their
   `recordPayment` is idempotent via the Notion invoice write alone).

3. **Pooled at runtime, direct for migrations; never in the deploy path.** The
   running app reads the **pooled** `POSTGRES_URL` (Supabase PgBouncer, transaction
   mode) with `prepare: false, max: 1, idle_timeout: 20` (each warm serverless
   instance holds its own tiny pool feeding the shared pooler). Migrations run
   **out-of-band** via `pnpm --filter @workspace/api-server db:migrate`
   (`src/scripts/migrate.ts`, applies `supabase/migrations/*.sql` in filename order,
   each in a transaction with its `schema_migrations` insert) on the **non-pooled**
   `POSTGRES_URL_NON_POOLING` (direct connection — DDL can't traverse PgBouncer).
   That's a manual `workflow_dispatch` job (`.github/workflows/migrate.yml`),
   deliberately kept out of `build:vercel` and cold starts. `postgres` (porsager)
   is a prod dependency.

The atelier's one-time setup (all optional — unset ⇒ the layer no-ops): on Vercel
the Supabase integration provides `POSTGRES_URL` + `POSTGRES_URL_NON_POOLING`; run
`db:migrate` once against the non-pooled URL to create the tables. Tests:
`test/unit/db.client.test.ts`, `test/unit/processed-payments.repository.test.ts`,
and the `checkout.service` dedup-branch tests, all over `test/support/fake-db.ts`.

## Web analytics & cookie consent

The site collects **privacy-friendly web analytics** (pageviews + client-side
navigations) via **Vercel Web Analytics** (`@vercel/analytics/react`), gated
behind an explicit **opt-in cookie-consent banner**. It's a purely client-side
feature — **no backend, no data model, no new env var** — that builds on the
existing Vercel deployment (enable _Web Analytics_ in the Vercel project
dashboard for data to flow; nothing else deploy-side). Frontend only:
`lib/consent.tsx` (the consent context), `components/analytics.tsx` (the gated
`<Analytics />`), `components/cookie-consent-banner.tsx` (the banner), all wired
in `App.tsx`, plus a "Cookies and analytics" section + "Manage cookie
preferences" control on `pages/privacy.tsx`. Load-bearing decisions:

1. **Consent is opt-IN, and analytics is the only thing it gates.**
   `ConsentProvider` holds one status — `"granted" | "denied" | "unset"` —
   persisted to `localStorage` under `aa-cookie-consent`. Until the visitor
   chooses, status is `"unset"`, the banner shows, and **nothing non-essential
   loads**. `ConsentedAnalytics` renders Vercel's `<Analytics />` (which injects
   the insights script) **only** when status is `"granted"`, so no analytics
   request is made otherwise. The banner and analytics are mounted once in
   `App.tsx` inside the router.

2. **Essential storage is never gated here.** The Supabase session (the customer's
   auth token, held in browser localStorage) is strictly necessary and out of scope
   for the banner — there's deliberately no "reject essential" path. Vercel Web
   Analytics is itself **cookieless** and
   doesn't track across sites; the opt-in gate is kept anyway for compliance and
   so the gate is already in place if analytics ever moves to a cookie-based
   provider.

3. **The choice is revisitable.** The privacy page's "Manage cookie
   preferences" control (`ManageCookiePreferences`) calls the context's
   `reset()`, which clears the stored choice so the banner reappears — letting a
   visitor withdraw consent as easily as they gave it. This is why
   `pages/privacy.tsx` now consumes `useConsent()` and its test wraps it in
   `ConsentProvider`.

Tests: `test/consent.test.tsx` (the context), `test/cookie-consent-banner.test.tsx`
(banner show/hide + persistence), and `test/analytics.test.tsx` (the gate, with
`@vercel/analytics/react` mocked). No E2E/smoke changes — the mocked e2e run
never loads the real script, and the smoke suite is read-only.

## Invisible anti-spam (honeypot + timing + submission rate limit)

The public, anonymous submission forms — **contact** (`POST /api/contact`),
**back-in-stock notify** (`POST /api/notify`), and **newsletter**
(`POST /api/newsletter`) — carry a **zero-friction, no-third-party** anti-spam
layer so a bot can't cheaply pollute the Notion contact database (+ Resend mail /
marketing audience). Nothing is customer-visible; there is no CAPTCHA. Three
signals, all invisible:

1. **Honeypot** — a hidden `website` field a real visitor never sees or fills
   (off-screen + `aria-hidden` + `tabIndex=-1`, not `display:none`). Any non-empty
   value marks the submission as a bot.
2. **Timing** — an `elapsedMs` field (how long the visitor spent on the form). A
   submit faster than a human plausibly could (`< SPAM_MIN_FILL_MS`, default
   **2000**, `0` disables) is a bot. **Absent ⇒ treated as human (fail open)**, so a
   client that can't measure it still works.
3. **Rate limit** — a shared per-IP `submissionRateLimiter` (5 / 10 min, same
   in-memory/per-instance `express-rate-limit` as the account limiter — a
   best-effort brake, not a hard wall).

Load-bearing decisions:

- **Contract-first.** `website` + `elapsedMs` are **optional** fields on
  `NewContactRequest` / `NewNotifyRequest` / `NewNewsletterRequest` in
  `openapi.yaml` (regenerate the libs after editing). Optional ⇒ a legacy client
  that omits them keeps working.
- **Silent success-looking drop, never a 4xx.** `spamFilter(success)`
  (`middlewares/spam-filter.ts`) runs **after** `validate` (reads
  `res.locals.body`); a flagged request gets the exact success response the
  endpoint would return (`{ status: 201, body: { success: true } }`) with **no**
  Notion write / email, so a bot gets no signal it was caught and never learns to
  evade. The pure `isLikelySpam` predicate is unit-testable without HTTP.
- **No service / Notion-blocks change.** The two fields are never read by the
  blocks builders — the middleware short-circuits before the service, and on a
  clean request the extra props are ignored downstream.
- **`SPAM_MIN_FILL_MS` is read fresh from env per call** (mirrors
  `lib/resend/config.ts`); unset ⇒ default, so it's inert-safe in dev/test (tests
  omit the timing field and fail open). It is **not** a Studio-Settings key.
- **Frontend reuse.** `web-app/src/lib/anti-spam.tsx` exports the shared
  `HoneypotField`, `honeypotSchema` (spread into each form's local zod schema), and
  `useSubmitTimer()`. Wired into `pages/contact.tsx`,
  `components/notify-dialog.tsx`, `components/newsletter-signup.tsx`, and the
  order-form newsletter path (`pages/order-form.tsx`).

Tests: `test/unit/spam-filter.test.ts` (predicate + middleware),
`test/integration/contact.routes.test.ts` (honeypot silently dropped, no write),
`test/integration/submission-rate-limit.routes.test.ts` (429 past the window), and
the frontend form tests assert the hidden field + `elapsedMs` in the payload. **No
new env var is required** (`SPAM_MIN_FILL_MS` is the one optional knob). This
covers the fully-anonymous forms only; the order/appointment/order-scoped
endpoints are out of scope for this layer.

## Development workflow

### Prerequisites

- **pnpm is required** (the `preinstall` hook fails the install for npm/yarn).
- Node with the versions implied by `@types/node` ^26.
- Copy `.env.example` → `.env` and fill in `NOTION_API_KEY` +
  `NOTION_ORDERS_DATABASE_ID`.

### Install & run

```bash
pnpm install

# Run backend (:3000) and frontend (Vite) together in parallel:
pnpm dev
```

`pnpm dev` runs the `@workspace/api-server` and `@workspace/web-app` dev
scripts in parallel. The frontend proxies `/api` to the backend. The
api-server `dev` script builds with esbuild and runs the bundled output; it
reads env from the repo-root `.env` via `DOTENV_CONFIG_PATH`.

### Build

```bash
pnpm build          # typecheck everything, then build all packages
pnpm build:vercel   # what Vercel runs: build api-server (esbuild) + frontend (vite)
```

### Typecheck

```bash
pnpm typecheck      # tsc --build across project references + per-package typechecks
```

TypeScript uses **project references** (`tsconfig.json` → `lib/*`,
`tsconfig.base.json` for shared compiler options). The `customConditions:
["workspace"]` setting lets packages resolve each other from **source** during
typecheck. Config highlights: `strict` null checks on, `module: esnext`,
`moduleResolution: bundler`, `noEmitOnError`, ESM everywhere (`"type":
"module"`).

### Tests

```bash
pnpm test          # all unit + integration tests (Vitest, no network)
pnpm test:e2e      # Playwright e2e (tests/e2e/*.spec.ts)
```

**Layout convention.** Every package with Vitest tests keeps them in `test/` at
the package root (never co-located in `src/`, so they stay out of the _build_
graph), with `test/support/` holding the setup file plus package-local helpers.
Shared domain fixtures come from `@workspace/test-fixtures` (see below).

**`.test.ts` vs `.spec.ts` is load-bearing, not an accident.** Vitest files are
`*.test.ts(x)`, Playwright files are `*.spec.ts`. The extension tracks the
runner: Vitest's `include` glob can then never match an e2e spec, and
Playwright's default `testMatch` (which _does_ match `.test.ts`) can never pick
up a Vitest suite. Don't "unify" these.

**Shared fixtures — `lib/test-fixtures`.** `@workspace/test-fixtures` holds the
domain fixtures used by all three suites (`createOrderInput()`, `orderRecord()`,
`contactInput()`, `STAGES`, `GENERIC_ERROR`), typed against the generated
`@workspace/api-zod` contract so a fixture can't silently drift from the API.
Two rules, both explained in that package's header comment:

1. **A fixture is only ever a _stub input_** — a request body, a mocked repo
   return, a stubbed hook result, a mocked HTTP response. Never the _expected
   output_ of the mapper that consumes it, or a bug in the fixture cancels a bug
   in the mapper. Where a test both stubs and asserts (e.g.
   `orders.routes.test.ts`), the stub uses the fixture and the expectation stays
   written out by hand.
2. **Notion-wire-shaped fakes stay local** to
   `artifacts/api-server/test/support/fake-notion.ts` (`orderPage()`,
   `databaseSchemaWithStages()`). Those are raw Notion page JSON — a different
   layer from the DTOs above, and keeping them apart is what lets `schema.test.ts`
   take its input from one place and write its expectation in another.

**Tests are typechecked.** Each package has a `tsconfig.test.json` (and `tests/`
a `tsconfig.json`) that covers the test dir without adding it to the build/emit
graph; `pnpm typecheck` runs them. `tests/tsconfig.json` also carries a `paths`
mapping for `@workspace/test-fixtures` — Playwright won't transpile TypeScript
inside `node_modules` and ignores Vite's `customConditions`, so mapping the
package to source is what makes the import resolve from an e2e spec.

**Backend unit / integration (Vitest).** The `@workspace/api-server` suite in
`artifacts/api-server/test/` — `unit/` (pure-function tests for the Notion schema
mapping and block builders, repository tests driving the **injected**
`NotionClient` with a fake, service logic) and `integration/` (supertest route
tests over the real Express stack with the Notion repository mocked). No server,
no network, no Notion. `vitest run test/unit` is the fast loop. A vitest-config
plugin maps the source's `.js` import specifiers to the on-disk `.ts` files so
tests run with no build step.

**Frontend component (Vitest + Testing Library).** The `@workspace/web-app`
suite in `artifacts/web-app/test/` (jsdom) — the status-timeline
completed/active/future logic and render states, the shop's render states and
category filter, and the order-form validation + submit-payload mapping
(asserting empty optional fields are omitted). Each file mocks the generated
react-query hook it needs (`vi.mock("@workspace/api-client-react")`) and drives
the page through its states via `test/support/mock-hook.ts`. `pnpm test` runs
both Vitest suites; each package also has its own `test` / `test:watch`.

Both Vitest configs set `clearMocks: true`, so tests don't hand-roll a
`beforeEach(() => vi.clearAllMocks())`.

**Coverage.** `pnpm test:coverage` runs both Vitest suites with v8 coverage
(`@vitest/coverage-v8`), printing a table and writing a browsable HTML report to
each package's `coverage/` dir. It's **report-only** — no thresholds, so it never
fails CI; the goal is visibility, not a gate. CI runs it in place of `pnpm test`
and uploads the reports as an artifact.

Note `pnpm test` filters on `./artifacts/**` rather than using `-r`: the
`@workspace/tests` package's `test` script is `playwright test`, and `-r` would
drag Playwright into the unit-test run (which CI executes _before_ it installs a
browser).

**End-to-end (Playwright).** By default the e2e run is self-contained: Playwright
starts the frontend dev server itself (`webServer` in `playwright.config.ts`) and
every spec intercepts `/api/*` in the browser (`tests/e2e/support/mock-api.ts`),
so no api-server or Notion is required and the runs are deterministic. Set
`PLAYWRIGHT_BASE_URL` to point at an already-running app instead (Playwright then
won't spawn its own server). `order-form.spec.ts` also carries an **opt-in**
live-Notion smoke test guarded by `E2E_LIVE_NOTION=1` — that's the only path that
writes to the real Notion database.

**Production smoke tests (Playwright).** A separate, deliberately **non-mocking**
suite in `tests/smoke/*.smoke.ts` with its own config
(`playwright.smoke.config.ts`, `pnpm test:smoke`) drives the **real deployed
site** (`PLAYWRIGHT_BASE_URL`, default the apex `https://a3iceanddance.com`) to
catch production breakage the mocked run can't see — a bad deploy, a Notion/Google
outage, an unshared database. Two rules make it distinct from the `e2e/` suite and
must hold: (1) it **never** intercepts `/api/*` — every request hits the live
backend, and it does **not** import `e2e/support/test.ts` (whose fixture fails any
unmocked call); (2) every spec is **read-only** — it exercises `GET` read paths
(health, shop inventory, the appointment catalog), an order lookup for a
nonexistent number (the real Notion 404 path), and client-side form validation,
but **never** creates an order/checkout/booking/contact message or sends an email,
so it's safe to run against production forever. The `.smoke.ts` extension +
`testMatch` keep it out of the `e2e` run (and Vitest) and vice versa, same
extension-tracks-the-runner convention as `.test.ts`/`.spec.ts`. It runs **weekly**
(not on every push) via `.github/workflows/smoke.yml` (`schedule` cron +
`workflow_dispatch`); after every scheduled run it **emails a pass/fail report** to
the atelier (`tests/scripts/email-smoke-report.mjs`, sent through the app's Resend
mailer — needs the `RESEND_API_KEY` + `RESEND_FROM_EMAIL` repo secrets, recipient
`SMOKE_REPORT_TO` defaulting to the atelier inbox; the script self-gates and never
fails the job if Resend is unset), built from the run's `json` reporter output. On a
scheduled failure the workflow **also** opens or updates a single GitHub issue so a
regression is visible rather than buried.

**CI.** `.github/workflows/ci.yml` runs on every pull request and push to `main`:
install → `pnpm typecheck` → `pnpm test` (both Vitest suites) → `pnpm test:e2e`
(Playwright installs its own Chromium; the mocked specs need no backend). The
Playwright config prefers `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, then a NixOS
system Chromium, then Playwright's managed browser — so it runs in CI, locally,
and in the maintainer's env without edits.

## Conventions & gotchas

- **Surface customer-facing copy for review.** When adding or changing any text a
  customer will see — email subjects/bodies (`lib/resend/emails.ts`), on-site strings,
  confirmation pages, SMS, etc. — show the exact copy in the reply so the atelier can
  approve the wording before it ships. Don't quietly bury new customer-visible wording
  in a diff.
- **ESM only.** Server-side relative imports use explicit `.js` extensions
  (e.g. `import router from "./routes/index.js"`) even though the source is
  `.ts` — this is required so `@vercel/node`/Node ESM can resolve the compiled
  output. Don't drop the extensions. Frontend imports use the `@/` alias
  (`@/components/...`) resolving to `artifacts/web-app/src`.
- **Shared dependency versions** live in the `catalog:` section of
  `pnpm-workspace.yaml`. Reference them as `"react": "catalog:"` rather than
  pinning per package.
- **`minimumReleaseAge: 1440`** — pnpm won't install package versions younger
  than 24h (supply-chain hardening). Expect this if adding a brand-new release.
- **Frontend stack:** React 19, Vite 7, Tailwind **v4** (via
  `@tailwindcss/vite`, no `tailwind.config` — config lives in `src/index.css`),
  wouter for routing, TanStack Query for data, shadcn/ui ("new-york" style) in
  `src/components/ui`, react-hook-form + zod for forms. The design is an
  intentionally minimal editorial/serif aesthetic — match it.
- **Navigation & page shell.** Routes are declared with wouter in
  `src/App.tsx`; add a `<Route>` there for each new page (before the `NotFound`
  fallback). The header is a single global `components/navbar.tsx` rendered once
  in `App.tsx` — its `NAV_LINKS` array is the **one place** to add/rename nav
  links (it drives both the desktop bar and the mobile `Sheet` menu, and
  `data-testid`s are auto-derived from each label). Pages wrap their content in
  `components/page-shell.tsx` (`<PageShell>`), which supplies the background,
  navbar clearance, and optional centering — follow `pages/home.tsx` as the
  scaffold.
- **Prettier** is the formatter (root devDependency).
- **Order reference-image upload goes to Notion, not object storage.** The old
  GCS/Replit-sidecar upload path was deleted during the Vercel migration; the
  order form's optional **reference / inspiration images** were reintroduced on
  top of **Notion's File Upload API** instead of reviving object storage, so
  there is _no new service or env var_ — it reuses `NOTION_API_KEY`, and the
  images land as inline image blocks on the order's own Notion page. The flow:
  the browser downscales each chosen image on a canvas
  (`web-app/src/lib/reference-images.ts`), then POSTs the bytes **one at a time**
  to `POST /api/orders/reference-images` (`web-app/src/components/reference-image-upload.tsx`);
  the server (`api-server/src/routes/order-images.ts` →
  `lib/notion/file-uploads.repository.ts`) relays each to Notion (create →
  send) and returns a `file_upload` id; the form collects the ids and sends them
  as the order body's `referenceImageIds`, which `orders.blocks.ts` attaches as
  image blocks. Two load-bearing points: (1) the upload endpoint is a **raw-bytes
  route deliberately outside the OpenAPI contract** (like the Stripe webhook /
  cron routes) — it's hand-mounted in `app.ts` with `express.raw()` ahead of the
  JSON parser, and the frontend calls it with a plain `fetch`, not the generated
  client; only the `referenceImageIds` array is in the contract. (2) Client-side
  downscaling + a **4 MB cap** keep each request under Vercel's ~4.5 MB
  serverless body limit — the one-image-per-request design is what avoids
  multipart parsing and stays under that limit. Notion single-part uploads are
  ≤ 20 MB and must be attached within an hour (the order-create call does that).
- **Notion is the system of record; Postgres is a thin integrity layer.** Orders,
  inventory, invoices, and the like all live in Notion — there is no ORM and no
  Drizzle (an early `drizzle-orm` scaffold was removed). The one relational store
  is the optional Supabase Postgres layer (`lib/db/`, the porsager `postgres`
  driver, raw SQL via the narrow `DbClient` seam), which holds only app-owned
  integrity facts (today: `processed_payments` for Stripe idempotency) and
  degrades to no-op when unconfigured. See "Postgres".
- **Dependencies are pruned — keep them that way.** The repo shipped an unpruned
  shadcn/Replit scaffold: 43 of 55 `ui/` components and 32 frontend deps were dead
  weight (`react-icons` alone was 85M). They were deleted. When you add a shadcn
  component, add only the one you use; don't bulk-import the set. A few deps look
  unused but are **load-bearing** — don't "clean" them up: `pino-pretty` (a _string_
  transport target in `logger.ts`), `thread-stream` (version pin for
  `esbuild-plugin-pino`), `@testing-library/dom` (required peer;
  `autoInstallPeers: false`), `tw-animate-css` / `@tailwindcss/typography` (pulled in
  by `src/index.css`, not by JS), and root `prettier` (orval's codegen calls it).
- **Reclaiming disk.** `pnpm clean` removes regenerable build output; `pnpm clean:deep`
  also prunes stale Playwright browser builds (the shared cache never evicts old ones
  and runs ~540M).

## Git & deployment

- Default branch: **`main`**. Feature work happens on branches; changes reach
  `main` via pull requests.
- Do **not** open a pull request unless explicitly asked.
- Vercel deploys from the repo using `vercel.json`:
  `installCommand: pnpm install`, `buildCommand: pnpm run build:vercel`,
  output `artifacts/web-app/dist/public`.
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
  sends to `GET /api/cron/generate-milestones`; unset ⇒ that endpoint 401s). The
  same secret doubles as the `?secret=` query token for the on-demand Notion
  button (`GET /api/cron/generate-milestones/run`).
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
  Tracking Pipeline database. **Appointment scheduling** instead uses Google: `GOOGLE_SERVICE_ACCOUNT_KEY` (the full
  service-account JSON key, with domain-wide delegation authorized for the
  Calendar scope) and `APPOINTMENT_SHEET_ID` (the working-hours Google Sheet,
  shared with the service-account email; optional `APPOINTMENT_SHEET_RANGE`,
  default `A2:F`). Enable both the Calendar and Sheets APIs. Checkout also
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
    email). Optionally, the **Supabase Postgres** integrity layer: `POSTGRES_URL`
    (pooled, runtime) + `POSTGRES_URL_NON_POOLING` (direct, migrations only) — also
    from the Supabase integration; unset ⇒ the layer no-ops (Stripe idempotency falls
    back to the Notion read-before-write dedup). Run `pnpm --filter
@workspace/api-server db:migrate` once to create its tables (see "Postgres").
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
  `APPOINTMENT_MIN_LEAD_HOURS` (24), `APPOINTMENT_MAX_ADVANCE_DAYS` (45), and
  `APPOINTMENT_SLOT_STEP_MINUTES` (15). All have defaults.
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
  `MEASUREMENT_LOCK_FROM_STAGE`, the four `APPOINTMENT_*` policy vars, `COLOR_PALETTE`
  (the intake color picker's palette), and the notification inboxes
  (`ATELIER_INBOX_EMAIL`, `ATELIER_CONTACT_INBOX_EMAIL`,
  `ATELIER_APPOINTMENTS_INBOX_EMAIL`, `ALERT_INBOX_EMAIL`) — in Notion instead of
  Vercel; each still falls back to its env var, then the built-in default. Unset ⇒
  env-only, exactly as before. Secrets, database ids, and email **senders** stay in
  Vercel by design (see "Studio Settings").
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

## Relate requests & orders to their sources (Phase-2 workspace cards)

Four Phase-2 "Workspace" roadmap cards give the Notion rows a real **relation** to the
thing they concern, so the atelier can click through and totals roll up — instead of
only naming them in free text. All the new relation **writes** are gated behind
`NOTION_RELATION_LINKS` (above); the relation **properties** are added to the Notion
databases out-of-band (done — see "Atelier setup" below).

1. **Requests → their order** (measurement-change / cancellation / return / review).
   Each writer now threads the order's Notion page id (the verification lookups
   `findOrderVerification` / `findShopOrderVerification` return `pageId`; the shop
   cancellation already had it) and, when enabled, sets a relation: a **custom**-order
   request links `Order` → Custom Orders, a **shop**-order request links `Shop Order`
   → shop orders (both on the shared "Website Contact Messages" db), and a **review**
   links `Order` → Custom Orders on the Reviews db. Helpers: `contactOrderRelation`
   (`lib/notion/contact.blocks.ts`, mirrors `contactClientRelation`) and the inline
   `Order` write in `reviews.blocks.ts`. Custom Orders carries an **Open Requests**
   rollup over the back-relation.
2. **Shop orders → inventory rows.** `checkout.service.ts` stamps each cart line's
   `variantId` (= the inventory Notion page id) onto the Stripe line's
   `price_data.product_data.metadata` (always on — harmless); the webhook retrieves the
   session with `expand: ["line_items.data.price.product"]`, recovers the deduped
   inventory ids, and (when enabled) writes them to the shop order's **`Inventory
Items`** relation (`SHOP_ORDER_ITEMS_PROPERTY`, additive alongside the existing
   text bullets). inventory carries a **Times Ordered** rollup (best-seller signal).
3. **Prune the redundant invoice link.** Generated invoice line items no longer write
   the `Order` relation (it was redundant with the invoice's own `Order`, and nothing
   read it) — see `invoice-line-items.blocks.ts` / `invoice-generator.service.ts`. The
   stale `Order` property on the **Invoice Line Items** database should be deleted in
   Notion **only after this ships** (deleting it before deploy would 404 the currently
   deployed invoice generator, which still writes it).
4. **Backfill legacy rows.** `src/scripts/backfill-legacy-fields.ts`
   (`pnpm --filter @workspace/api-server db:backfill-legacy [-- --dry-run]`) is a
   one-time, idempotent backfill: it recovers a legacy custom order's `Email` +
   measurements from its page **body** blocks and stamps the typed properties, and
   stamps a deterministic `SHP-LEGACY-…` `Order Number` on legacy shop orders that
   lack one (so they surface in the email-keyed account portal). Needs
   `NOTION_API_KEY` + the order/shop-order database ids in env; run it where those
   live (it is out-of-band, not in the deploy path, like `db:backfill`).

**Atelier setup (done in Notion; enable with `NOTION_RELATION_LINKS=1`):** an `Order`
(→ Custom Orders) + `Shop Order` (→ shop orders) relation on Website Contact Messages;
an `Order` (→ Custom Orders) relation on Reviews; an `Inventory Items` (→ inventory)
relation on shop orders; the five measurement number properties (`Waist`, `Chest`,
`Hips`, `Height`, `Body Girth`) + `Measurement Unit` select on Custom Orders (the
targets the app + backfill write); plus the `Open Requests` (Custom Orders) and
`Times Ordered` (inventory) count rollups.

## Workspace record hygiene (Phase-2 cards — CRM, archiving, markers, templates)

Four more Phase-2 "Workspace" cards, all **additive Notion configuration the app
never reads** — so they need no code and are invisible to the deployed app (which
keys on exact property names). Recorded here only because two facts are
**load-bearing / a foot-gun to get wrong**; full detail in
`.agents/memory/phase2-workspace-crm-archive-markers.md`.

- **Order archiving is a `checkbox`, NEVER a `Stage` option.** Custom Orders and
  shop orders carry an `Archived` checkbox + `Active Orders` / `Archived` views.
  Archived must stay a separate property because the app reads `Stage`
  **positionally** — `services/delivery.ts` `orderDelivered()` treats the **last**
  live stage as "delivered" (review gate, schedule, portal). An "Archived" **Stage**
  after "Delivered" would silently become the delivered position and break all
  three. Nothing in the app filters on `Archived`; it's a pure view-cleanliness
  convention (no cron re-touches an archived order).
- **The Custom Orders template pre-fills `Stage` + `Measurement Unit`.**
  `buildOrderProperties` (`orders.blocks.ts`) deliberately **omits `Stage`** on
  create (a new page inherits Notion's Stage status default) and writes
  `Measurement Unit` **only when measurements are supplied** — so a hand-keyed order
  can miss the unit the account portal reads back. The database template
  ("✨ Your Custom Dress — [Client Name]") now defaults `Stage = Consultation` and
  `Measurement Unit = inches` so manual entry matches what the code expects. Don't
  rely on this in code — it's an atelier convenience, not an app guarantee.
- **Client CRM reads as a customer record.** Rollups over the order relations:
  `Order Count` + `Lifetime Value` (custom invoice balances) + `Paid to Date`
  (pre-existing), plus new `First Order Date` / `Last Order Date` (over a `Created`
  created_time added to Custom Orders), `Shop Order Count` / `Shop Revenue`, and two
  blended formulas `Total Orders` / `Total Lifetime Value` (custom + shop). The
  app reads **none** of these (`clients.repository.ts` reads only email / status /
  last-contact / reward fields), so they're safe to retune or extend.
- **App-owned markers are corralled out of the working views** (Last Notified
  Stage, Milestones Generated, Stage Index Sys, Reminder Sent, the reward flags,
  Stripe session ids). The curated views hide them; a collapsed "🔧 System" property
  group on each database's page detail is a UI-only runbook step (property groups
  aren't API-reachable).

## Quick reference — where things live

| I want to…                                             | Go to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change an API request/response shape                   | `lib/api-spec/openapi.yaml` → run codegen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Change order use-case logic                            | `artifacts/api-server/src/services/orders.service.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Change Notion I/O                                      | `artifacts/api-server/src/lib/notion/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Change a customer email / template                     | `artifacts/api-server/src/lib/resend/*` (`emails.ts` copy, `send.ts` transport, `client.ts` config)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Add/modify an API route                                | `artifacts/api-server/src/routes/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Add request validation / error mapping                 | `artifacts/api-server/src/middlewares/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Change the order-tracking UI (custom + shop)           | `artifacts/web-app/src/pages/track.tsx` (unified lookup) + `components/custom-order-result.tsx` + `components/shop-order-result.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Change the order intake form                           | `artifacts/web-app/src/pages/order-form.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Change the color selector (intake)                     | `artifacts/web-app/src/components/color-picker.tsx` + `pages/order-form.tsx` (frontend, step 2 of the two-step flow); `api-server/src/services/colors.ts` (`intakeColorPalette`/`parseColorPalette` + the built-in default) + `routes/colors.ts` (`GET /api/colors`, the `COLOR_PALETTE` Studio Settings value); `lib/notion/orders.{schema,blocks}.ts` (write-back to the order's `Colors` + `Color Usage`)                                                                                                                                                                                                                                                                                  |
| Change the rush order surcharge                        | `artifacts/web-app/src/lib/rush.ts` (window + disclosure) + `pages/order-form.tsx` (detect/acknowledge/send); `api-server/src/lib/notion/orders.blocks.ts` + `orders.schema.ts` (`Rush Order` record); `api-server/src/services/rush.ts` + `services/invoice-generator.service.ts` (server-priced "Surcharge" line); `web-app/src/lib/invoice-format.ts` ("Surcharge" line display)                                                                                                                                                                                                                                                                                                           |
| Change referral & returning-skater rewards             | `api-server/src/services/rewards.service.ts` (engine + amount getters) + `lib/stripe/promotions.ts` (`createDiscountCode`) + `lib/notion/clients.repository.ts` (reward reads + `patchClientProperties`); wired from `submitOrder` (capture) + `recordPaidOrder` / `recordPayment` (issue); reward emails in `lib/resend/emails.ts`; `services/account.service.ts` + `web-app/src/pages/account.tsx` (referral card) + `pages/order-form.tsx` (`referralCode` field)                                                                                                                                                                                                                          |
| Add/read an atelier-editable live setting              | `api-server/src/lib/settings/store.ts` (`SETTING_KEYS` + `settingValue`) + `lib/notion/settings.{schema,repository}.ts` (Notion read); consume with `settingValue(KEY) ?? process.env[KEY] ?? default` (see `services/rush.ts`); primed by the middleware in `app.ts`. Notion "Studio Settings" DB, `NOTION_SETTINGS_DATABASE_ID`                                                                                                                                                                                                                                                                                                                                                             |
| Change the measurement-change request                  | `artifacts/web-app/src/components/measurement-change-dialog.tsx` (opened from `components/custom-order-result.tsx`); `api-server/src/services/measurement-change.service.ts` + `routes/orders.ts` + `lib/notion/measurement-change.{blocks,repository}.ts` (writes to the **contact** database)                                                                                                                                                                                                                                                                                                                                                                                               |
| Change post-delivery review capture                    | `artifacts/web-app/src/components/review-dialog.tsx` (opened from `components/custom-order-result.tsx` for delivered orders); `api-server/src/services/review.service.ts` + `services/delivery.ts` + `routes/orders.ts` + `lib/notion/reviews.{blocks,repository}.ts` (writes to the **Reviews** database)                                                                                                                                                                                                                                                                                                                                                                                    |
| Change order cancellation & refunds                    | `artifacts/web-app/src/components/cancellation-request-dialog.tsx` (rendered by `components/custom-order-result.tsx` + `shop-order-result.tsx`); customer request in `api-server/src/services/cancellation.service.ts` + `routes/orders.ts` + `routes/shop-orders.ts` + `lib/notion/cancellation.{blocks,repository}.ts` (writes to the **contact** database); atelier refund in `services/order-cancellation.service.ts` + `routes/order-cancellation.ts` (button, `?order=`) + the `Cancelled`/`setOrderCancelled`/`setShopOrderCancelled` writers                                                                                                                                          |
| Change the landing page                                | `artifacts/web-app/src/pages/home.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Change the shop (live Notion inventory)                | `artifacts/web-app/src/pages/shop.tsx` + `services/products.service.ts` + `lib/notion/products.*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Change the back-in-stock notify dialog                 | `artifacts/web-app/src/components/notify-dialog.tsx` + `services/notify.service.ts` + `lib/notion/notify.*` (writes to the **contact** database — see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Change shop checkout / payments                        | `artifacts/web-app/src/lib/cart.tsx` + `components/cart-drawer.tsx` + `components/add-to-cart.tsx` (frontend); `api-server/src/services/checkout.service.ts` + `routes/checkout.ts` + `routes/stripe-webhook.ts` + `lib/stripe/*` + `lib/notion/shop-orders.*` (backend)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Change shop-order tracking                             | `artifacts/web-app/src/components/shop-order-result.tsx` (rendered by `pages/track.tsx`; + order number on `pages/shop-success.tsx`); `api-server/src/services/shop-orders.service.ts` + `routes/shop-orders.ts` + `lib/notion/shop-orders.{blocks,repository}.ts` + `services/checkout.service.ts` (mints the number)                                                                                                                                                                                                                                                                                                                                                                        |
| Change the return / exchange request                   | `artifacts/web-app/src/components/return-exchange-dialog.tsx` (opened from `components/shop-order-result.tsx`); `api-server/src/services/return-request.service.ts` + `routes/shop-orders.ts` (`POST /shop-orders/:n/return-requests`) + `lib/notion/return-request.{blocks,repository}.ts` (writes to the **contact** database) + `findShopOrderVerification` in `lib/notion/shop-orders.repository.ts`; policy copy in `pages/shipping-returns.tsx`                                                                                                                                                                                                                                         |
| Change the footer / legal pages                        | `artifacts/web-app/src/components/footer.tsx` (global, in `App.tsx`) + `pages/{privacy,terms,shipping-returns}.tsx` + `components/legal-page.tsx`; shared studio contact details in `lib/contact-info.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Change custom-order payments (deposits + balance)      | `artifacts/web-app/src/components/custom-order-result.tsx` (`DepositsSection`, rendered by `pages/track.tsx`) + `pages/invoice.tsx`; `api-server/src/services/invoice.service.ts` (`createPaymentCheckout`/`recordPayment`) + `routes/orders.ts` (`POST /orders/:n/payments/:stage`) + `lib/notion/invoice.{schema,repository}.ts` + `routes/stripe-webhook.ts`                                                                                                                                                                                                                                                                                                                               |
| Change invoice line-item generation (from costing)     | `api-server/src/services/invoice-generator.service.ts` + `routes/invoice-generator.ts` (button, `?order=`) + `lib/notion/costing.{schema,repository}.ts` + `lib/notion/invoice-line-items.blocks.ts` + `createInvoiceLineItem`/`setInvoiceTitle` in `lib/notion/invoice.repository.ts`                                                                                                                                                                                                                                                                                                                                                                                                        |
| Change production-schedule milestones                  | `api-server/src/services/schedule.service.ts` + `routes/cron.ts` + `lib/notion/production-schedule.{blocks,repository}.ts` + `lib/notion/orders.repository.ts` (`findOrdersNeedingMilestones`/`markMilestonesGenerated`); cron in `vercel.json`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Change order status-change emails (+ pipeline graphic) | `api-server/src/lib/resend/emails.ts` (`orderStageChangeEmail`) + `services/order-notification.service.ts` + `routes/order-notification.ts` + `lib/notion/orders.repository.ts` (`findOrderForStageNotification`); Notion automation → `POST /api/webhooks/notion-stage-change`                                                                                                                                                                                                                                                                                                                                                                                                               |
| Change automated fitting reminders                     | `api-server/src/services/schedule.service.ts` (`sendDueFittingReminders`) + `services/fitting-reminder.ts` (env business rule) + `lib/notion/production-schedule.{blocks,repository}.ts` (`findMilestonesNeedingFittingReminder`/`markFittingReminderSent`, `Reminder Sent` prop) + `fittingReminderEmail` in `lib/resend/emails.ts`; runs in the milestone cron                                                                                                                                                                                                                                                                                                                              |
| Change payment & deposit due reminders                 | `api-server/src/services/schedule.service.ts` (`sendDuePaymentReminders`) + `services/payment-reminder.ts` (env business rule) + `lib/notion/invoice.repository.ts` (`findInvoicesNeedingPaymentReminder`/`markPaymentStageReminded`) + `extractPaymentReminderInvoice` + `PAYMENT_STAGE_REMINDER_FIELDS` in `lib/notion/invoice.schema.ts` + `paymentReminderEmail` in `lib/resend/emails.ts`; runs in the milestone cron                                                                                                                                                                                                                                                                    |
| Change appointment booking (UI)                        | `artifacts/web-app/src/pages/appointments.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Change appointment reschedule / cancel                 | `artifacts/web-app/src/pages/appointment-manage.tsx` (+ shared `lib/appointment-format.ts`); `api-server/src/services/appointment-manage.service.ts` + `routes/appointments.ts` (`/appointments/manage`, `/reschedule`, `/cancel`) + `lib/google/calendar.repository.ts` (`getCalendarEvent`/`updateCalendarEvent`/`cancelCalendarEvent`) + the reschedule/cancel builders in `lib/resend/emails.ts`; token `"appointment"` purpose in `lib/auth/tokens.ts`                                                                                                                                                                                                                                   |
| Change appointment types / routing rules               | `api-server/src/lib/appointments/catalog.ts` (targeted business rule — durations, which staff, which locations)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Change staff working hours / calendars                 | The working-hours **Google Sheet** (`APPOINTMENT_SHEET_ID`); read in `api-server/src/lib/google/sheets.repository.ts`, parsed by `lib/appointments/staff.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Change appointment slot logic / policy                 | `api-server/src/lib/appointments/availability.ts` (`computeSlots`) + `time.ts` + `settings.ts`; `services/appointments.service.ts` + `routes/appointments.ts` + `lib/google/*` (Calendar free/busy + event insert)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Change the customer account portal (Supabase Auth)     | `artifacts/web-app/src/pages/account.tsx` (+ `components/appointment-manage-panel.tsx`, shared with `pages/appointment-manage.tsx`) + `pages/account-login.tsx` / `account-callback.tsx` / `account-reset.tsx` + `lib/supabase.ts` + `lib/auth-context.tsx` (frontend); `api-server/src/services/account.service.ts` + `routes/account.ts` + `middlewares/auth.ts` + `lib/supabase/client.ts`; queries `findOrdersByEmail` / `findShopOrdersByEmail` + `listUpcomingAppointmentsByEmail` (`lib/google/calendar.repository.ts`, mapped via `lib/appointments/event-details.ts`) + `extractMeasurements` (`lib/notion/orders.schema.ts`). Auth emails: `.agents/memory/supabase-auth-emails.md` |
| Change the Postgres integrity layer / payment dedup    | `api-server/src/lib/db/client.ts` (`DbClient` seam + `postgresConfigured`) + `lib/db/processed-payments.repository.ts` (`claimPayment` / `confirmPayment` / `releasePayment`); consumed by `services/checkout.service.ts` (`recordPaidOrder`). Schema in `supabase/migrations/*.sql`, applied by `src/scripts/migrate.ts` (`pnpm db:migrate`, `.github/workflows/migrate.yml`)                                                                                                                                                                                                                                                                                                                |
| Change the newsletter opt-in                           | `artifacts/web-app/src/components/newsletter-signup.tsx` (footer field, in `footer.tsx`) + the intake checkbox in `pages/order-form.tsx`; `api-server/src/services/newsletter.service.ts` + `routes/newsletter.ts` + `lib/notion/newsletter.{blocks,repository}.ts` (writes to the **contact** database) + `newsletterWelcomeEmail` in `lib/resend/emails.ts`                                                                                                                                                                                                                                                                                                                                 |
| Change invisible anti-spam (honeypot/timing/limit)     | `api-server/src/middlewares/spam-filter.ts` (`isLikelySpam` + `spamFilter`) + `submissionRateLimiter` in `middlewares/rate-limit.ts`; applied in `routes/{contact,notify,newsletter}.ts`; frontend `web-app/src/lib/anti-spam.tsx` (`HoneypotField` / `honeypotSchema` / `useSubmitTimer`) wired into `pages/contact.tsx` + `components/{notify-dialog,newsletter-signup}.tsx` + `pages/order-form.tsx`. Fields `website` + `elapsedMs` on the contact/notify/newsletter request schemas in `openapi.yaml`                                                                                                                                                                                    |
| Change the mailing-list / Resend audience sync         | `api-server/src/lib/resend/audience.ts` (`upsertAudienceContact` → Resend Contacts API) + `audienceId()` in `lib/resend/config.ts`; wired best-effort from `services/newsletter.service.ts`. Campaigns are sent as Resend **Broadcasts** from the dashboard (no in-app sender). Marketing-email disclosure in `pages/privacy.tsx`                                                                                                                                                                                                                                                                                                                                                             |
| Add a page / route                                     | new `src/pages/*.tsx` + `<Route>` in `src/App.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Add or rename a nav link                               | `NAV_LINKS` in `artifacts/web-app/src/components/navbar.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Add a shared UI component                              | `artifacts/web-app/src/components/ui/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Add/change a shared test fixture                       | `lib/test-fixtures/src/index.ts` (read its guardrail first)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Understand a past decision / gotcha                    | `.agents/memory/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Adjust the Vercel serverless entrypoint                | `api/index.ts` + `vercel.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

```

```
