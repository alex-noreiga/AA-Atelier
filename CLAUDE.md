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
Notion-backed product grid, and Contact is a working enquiry form.

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
    src/pages/       one component per route (home landing, status, order-form,
                     services, about, shop, shop-success, shop-order-status,
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
api/
  index.ts           Vercel serverless entrypoint — re-exports the built Express app
lib/
  api-spec/          OpenAPI spec (openapi.yaml) + orval codegen config — SOURCE OF TRUTH
  api-zod/           GENERATED zod schemas from the spec (server-side validation)
  api-client-react/  GENERATED react-query hooks + typed fetch client (frontend)
  test-fixtures/     Shared domain fixtures for all three test suites
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
                                    └──►  Resend REST API (customer emails)
  │
  ├─ GET  /api/healthz             → { status: "ok" }
  ├─ GET  /api/orders/:orderNumber → order status + stage list
  ├─ POST /api/orders              → creates a Notion page, returns order number
  │                                  + sends an order-confirmation email
  │                                  + (best-effort) upserts a Client CRM record
  │                                  by email and links the order to it
  ├─ POST /api/orders/:n/deposit   → creates a Stripe Checkout session for the
  │                                  deposit the atelier set on custom order :n
  │                                  in Notion; the webhook marks it paid
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
  ├─ POST /api/orders/:n/invoice   → creates a Stripe Checkout session for the
  │                                  outstanding balance on custom order :n's
  │                                  invoice (itemized materials + labor from the
  │                                  Notion "invoices & payments" system, minus
  │                                  deposits paid); the webhook marks it paid
  ├─ POST /api/contact             → saves a contact message to the Notion
  │                                  "Website Contact Messages" database
  │                                  + sends an acknowledgement email
  ├─ GET  /api/products            → shop inventory + the live category list,
  │                                  from the Notion "inventory" database
  ├─ GET  /api/shop-orders/:orderNumber
  │                                → a ready-to-wear shop order's current
  │                                  fulfillment Status + the live status list
  │                                  (for a tracking timeline), by the order
  │                                  number issued at checkout
  ├─ POST /api/notify              → files a back-in-stock request (email + item
  │                                  + optional size) in that SAME contact
  │                                  database, tagged Request type = "Back in
  │                                  stock" + sends a request-confirmation email
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
  │                                  emails a confirmation
  ├─ POST /api/webhooks/stripe     → Stripe → server webhook (raw body, signed).
  │                                  On checkout.session.completed, records the
  │                                  paid order in the Notion "Shop Orders"
  │                                  database. NOT part of the OpenAPI contract.
  └─ GET  /api/cron/generate-milestones
                                   → Vercel Cron reconciliation (CRON_SECRET-
                                     guarded). Finds orders with a "Due Date" but
                                     no milestones and writes one per-stage
                                     milestone row to the Notion "Production
                                     Schedule" database. NOT part of the OpenAPI
                                     contract.
```

The customer-notification POST endpoints (`/api/orders`, `/api/contact`,
`/api/notify`, `/api/appointments`, `/api/orders/:n/measurement-change-requests`)
each send a customer email via **Resend** as
a **best-effort** side effect after the Notion write: the send is logged-and-swallowed
on failure and never changes the response status (see the Resend adapter in
`artifacts/api-server/src/lib/resend/` and the notification-email note in
`.agents/memory/vercel-migration.md`). This replaced the old Notion automations
that used to send these emails. Order **status-change** emails are intentionally
_not_ handled here — stage changes happen inside Notion and there is no Notion→app
trigger.

Each of those also sends an **internal atelier notification** to
`ATELIER_INBOX_EMAIL` (with **Reply-To** set to the customer) — but only when that
env var is set; unset means the notification is skipped and only the customer email
goes out. So the atelier gets an email nudge on top of the Notion row. The
customer-facing and atelier-facing builders live side by side in
`lib/resend/emails.ts`.

Emails are grouped into three **categories** (`lib/resend/config.ts`): **orders**
(order + back-in-stock mail), **contact** (contact-form mail), and
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

Both frontend flows go through the generated client: the status page
(`pages/status.tsx`) uses `useGetOrderStatus`, and the intake form
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
   Two places read their options live from `GET /v1/databases/{id}` with a 60s
   in-memory TTL cache, falling back to the cached list on error:
   `fetchLiveOrderStages()` (order **Stage**, in `notion/orders.repository.ts`)
   and `listCategories()` (shop **Item Type** → the shop's filter chips, in
   `notion/products.repository.ts`). Don't reintroduce a hardcoded constant for
   either. (The per-stage _description text_ in `lib/stage-descriptions.ts` is
   cosmetic flavor only.)

   The deliberate exceptions are _targeted business rules_ naming specific
   option values — `STATUS_IN_STOCK` ("In Stock" is the only sellable status),
   `SIZED_CATEGORIES` in `pages/shop.tsx` (only Dress / Ready to Wear show
   the size chart), and the `MEASUREMENT_LOCK_FROM_STAGE` stage
   (`services/measurement-change.service.ts`, default `Cutting/Pinning`, env-
   overridable) at/after which measurements freeze. These name values, not the
   list; rename those options in Notion and you must update them here too.

3. **The contact database has three writers.** "Website Contact Messages" holds
   contact-form messages (`contact.blocks.ts`), the shop's back-in-stock requests
   (`notify.blocks.ts`), and order measurement-change requests
   (`measurement-change.blocks.ts`), separated by the **Request type** select
   (`Inquiry` / `Back in stock` / `Measurement update`). A restock request carries
   **Item** and **Size** as real properties, and a measurement-change request
   carries the order number + requested measurements, so the atelier can filter the
   inbox by request type rather than reading it out of free text. The property names
   these writers share are exported from `contact.blocks.ts` and imported by
   `notify.blocks.ts` / `measurement-change.blocks.ts` — keep it that way so they
   can't drift.

Auth: the server reads `NOTION_API_KEY` and `NOTION_ORDERS_DATABASE_ID` from
environment variables (via `createNotionClient` in `notion/client.ts`, read at
first use rather than module load). On Replit these came from a sidecar; that
path is gone.

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
   non-2xx. `recordPaidOrder` dedupes on the Stripe session id (stored as a
   property and looked up before insert), so replays don't create duplicate orders.

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
   the final balance, not the deposit), so `deposit.service` sets no
   `automatic_tax`.

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
   tracks the order at `pages/shop-order-status.tsx` (`GET /shop-orders/:orderNumber`
   → `services/shop-orders.service.ts` → `findShopOrderByNumber` /
   `fetchLiveShopOrderStatuses`), which reports the live Notion `Status` workflow
   as a timeline (the status option list is read live, never hardcoded — same rule
   as order stages). The number is surfaced to the customer on the success page
   **and** in the shop confirmation email (`sendShopOrderConfirmation` in
   `checkout.service.ts` passes `metadata.orderNumber` into `ShopOrderEmailDetails`,
   which `shopOrderConfirmationEmail` renders), plus the atelier notification. The
   lookup only serves orders placed after this shipped (older ones have no
   `Order Number`).

The atelier must create the "Shop Orders" Notion database (properties in
`shop-orders.blocks.ts`, including the `Order Number` rich_text property) and
share the integration with it. Local testing uses Stripe test-mode keys +
`stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

### Custom-order deposits

Custom (bespoke) orders are quoted offline, so a deposit rides on the **orders**
database, not a purchasable cart. After quoting, the atelier sets a `Deposit
Amount` (number) on the order in Notion; the customer pays it from the
order-status page (`pages/status.tsx` → `POST /orders/:n/deposit`), which prices
the deposit server-side from that property (never trusting the client) and
creates a Checkout session tagged `metadata.kind = "deposit"`. The **one** webhook
handler routes on that tag: a deposit session calls `recordDepositPayment`
(which sets `Deposit Paid` + `Deposit Session Id` on the order page —
idempotently), everything else is a shop-cart order. The atelier must add
`Deposit Amount` (number), `Deposit Paid` (checkbox), and `Deposit Session Id`
(rich_text) to the orders database — property names live in `orders.schema.ts`. Code:
`services/deposit.service.ts`, `lib/notion/orders.repository.ts`
(`findDepositTarget`/`markDepositPaid`), and the status page's `DepositSection`.

### Custom-order invoices (reads the atelier's Notion finance system)

The final bill is an **invoice**: itemized materials + labor, minus the deposits
paid, = the balance the customer pays online. The atelier already models all of
this in Notion (under the "finances" page) — the app **reads** it, it does not
recreate or recompute the costing:

- **`invoices & payments`** (`NOTION_INVOICES_DATABASE_ID`): one invoice per order
  (`Order` relation, limit 1), with `Final Balance` (rollup), `Line Items`
  relation, and the app-added `Invoice Ready` / `Balance Paid` /
  `Balance Payment Session Id`.
- **`Invoice Line Items`** (`NOTION_INVOICE_LINE_ITEMS_DATABASE_ID`): each line has
  a `Line Type` (Garment / Material / Labor / Deposit / Adjustment) and a
  `Line Total` (formula). Each material is its own `Material` row (main fabric,
  crystal/rhinestones, appliqué…), so the invoice breaks materials out per item.

Five things are load-bearing:

1. **Balance is computed from the line items, not `Final Balance`.**
   `balanceDue = Σ(non-deposit Line Totals) − Σ(deposits paid on the order)`,
   floored at 0 (`buildInvoiceView` in `services/invoice.service.ts`). `Line Type
= Deposit` rows are **excluded** from the subtotal — deposits are credited from
   the order's paid-deposit amounts instead, so they can't be double-counted. This
   avoids depending on how the `Final Balance` rollup treats deposit lines.

2. **Only the balance is collected online.** Deposits are collected however the
   atelier does today and tracked on the **order** (`Deposit Amount`/`Deposit
Paid` = deposit 1; `Deposit 2 Amount`/`Deposit 2 Paid` = deposit 2, both in
   `schema.ts`). The existing deposit-1 flow + `DepositSection` are untouched;
   only **paid** deposits credit the balance.

3. **Tax on the balance only.** The invoice checkout sets `automatic_tax`,
   `tax_behavior: "exclusive"`, and `billing_address_collection: "required"` (no
   shipping step). Deposits stay untaxed.

4. **`Invoice Ready` gates it.** `getOrderStatus` attaches the `invoice` object —
   and the status page shows a **"View Invoice"** button → `pages/invoice.tsx`
   (`/invoice/:orderNumber`) — only once the atelier ticks `Invoice Ready`.
   `createInvoiceCheckout` 400s until then.

5. **Write-back is order + invoice, idempotent.** The one webhook routes
   `metadata.kind = "invoice"` to `recordInvoicePayment` → `markBalancePaid`,
   which sets `Invoice Paid` + `Invoice Session Id` on the order and `Balance
Paid` + `Balance Payment Session Id` on the invoice. Only those plain
   checkbox/text fields are written (never the costing formulas); `Balance Paid`
   is the "already paid" guard.

The atelier must, one time: add `Deposit 2 Amount` (number), `Deposit 2 Paid`
(checkbox), `Invoice Paid` (checkbox), `Invoice Session Id` (rich_text) to the
Order Tracking Pipeline; add `Invoice Ready` (checkbox), `Balance Paid`
(checkbox), `Balance Payment Session Id` (rich_text) to invoices & payments;
share the Notion integration with **invoices & payments** and **Invoice Line
Items**; and set the two env vars. Code: `services/invoice.service.ts`,
`routes/orders.ts` (`POST /orders/:n/invoice`), `routes/stripe-webhook.ts`,
`lib/notion/invoice.{schema,repository}.ts`, and `pages/invoice.tsx`.

## Production schedule (auto-generated stage milestones)

The atelier plans work in the **"📅 Production Schedule"** Notion database
(`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`), which has ready-made Timeline and
Calendar views keyed on `Target Completion Date`. To fill it, the app
**auto-generates one dated milestone row per remaining stage** for any custom
order that has a firm due date. See `.agents/memory/production-schedule-milestones.md`
for the full design; the load-bearing points:

1. **Trigger is a reconciliation cron, not a Notion push.** There is no Notion→app
   trigger (see the deposits/status notes), so the atelier sets a `Due Date` on the
   order in the Order Tracking Pipeline and a **Vercel Cron** job
   (`GET /api/cron/generate-milestones`, in `vercel.json` `crons`) later scans for
   orders that have a due date but whose `Milestones Generated` checkbox is unset,
   and generates their milestones. The endpoint is CRON_SECRET-guarded and, like the
   Stripe webhook, is **deliberately outside the OpenAPI contract** (mounted in
   `app.ts`, not the `/api` router). Code: `routes/cron.ts` →
   `services/schedule.service.ts` → `lib/notion/orders.repository.ts`
   (`findOrdersNeedingMilestones`/`markMilestonesGenerated`) +
   `lib/notion/production-schedule.{blocks,repository}.ts`.

2. **Scheduling is even-split over the live stage list — don't hardcode stages.**
   `computeMilestoneSchedule` spreads the stages from the order's current stage
   forward evenly across `[today, dueDate]` (the final stage lands on the due date;
   a past-due date clamps all to the due date). The stage list comes live from
   Notion via `fetchLiveOrderStages`, so the schedule adapts when the atelier edits
   stages. The milestone's `Stage` is written to a **select** property, which Notion
   auto-creates options for, so no stage constant is baked in either.

3. **Idempotent.** The `Milestones Generated` checkbox plus an
   existing-milestones lookup (`orderHasMilestones`, by the `Order` relation) stop a
   re-run from duplicating rows; the checkbox is only flipped after every row for an
   order is written, and one order's failure is logged-and-skipped (retried next run)
   rather than aborting the batch. To **reschedule** after changing a due date, uncheck
   `Milestones Generated` (and delete the stale rows); the next run regenerates.

The atelier must, one time: add `Due Date` (date) + `Milestones Generated`
(checkbox) to the Order Tracking Pipeline; add `Stage` (select) + `Order`
(relation → Order Tracking Pipeline) to the Production Schedule; share the Notion
integration with the Production Schedule database; and set
`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID` + `CRON_SECRET`. Property names live in
`orders.schema.ts` (orders) and `production-schedule.blocks.ts` (schedule).

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
   routing rules (Alayna takes consultations + design reviews; Alexandra takes
   everything; fittings are in-person only). Like `STATUS_IN_STOCK` /
   `SIZED_CATEGORIES`, these are values coupled to code (duration drives slot
   math; staff/locations drive UI + validation). Retune a duration or rename a
   staff member here; the staff names must match the `Staff` column in the
   working-hours sheet (below).

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

**CI.** `.github/workflows/ci.yml` runs on every pull request and push to `main`:
install → `pnpm typecheck` → `pnpm test` (both Vitest suites) → `pnpm test:e2e`
(Playwright installs its own Chromium; the mocked specs need no backend). The
Playwright config prefers `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, then a NixOS
system Chromium, then Playwright's managed browser — so it runs in CI, locally,
and in the maintainer's env without edits.

## Conventions & gotchas

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
- **Image upload is not supported.** The GCS/Replit-sidecar upload path was
  deleted during the Vercel migration, and the `/storage/*` endpoints,
  `imageUrls` field, and the `lib/object-storage-web` widget have since been
  removed from the spec and workspace. If upload is ever reintroduced, add it
  to `openapi.yaml` first and regenerate.
- **No relational database.** Orders live in Notion; there is no Postgres/Drizzle
  package. (An empty `lib/db` scaffold used to exist but was removed, along with
  its stale `drizzle-orm` catalog entry.)
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
  shop's `/products` endpoint reads), `NOTION_SHOP_ORDERS_DATABASE_ID` (the
  "Shop Orders" database the checkout webhook writes paid orders to — it needs an
  `Order Number` rich_text property so the shop-order-tracking lookup works), and
  `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID` (the "Production Schedule" database the
  milestone-reconciliation cron writes per-stage milestones to),
  `NOTION_INVOICES_DATABASE_ID` (the "invoices & payments" database) and
  `NOTION_INVOICE_LINE_ITEMS_DATABASE_ID` (the "Invoice Line Items" database) —
  the two the custom-order invoice flow reads to show a customer their balance.
  The Notion integration must be shared with each database or queries 404. The
  production-schedule cron also needs `CRON_SECRET` (the bearer token Vercel Cron
  sends to `GET /api/cron/generate-milestones`; unset ⇒ that endpoint 401s).
  Optionally `NOTION_CLIENT_CRM_DATABASE_ID` (the "Client CRM" database): when set,
  a new custom order **best-effort** upserts a client record there (deduped by
  email) and links the order via the `Client ⇄ Orders` relation; unset ⇒ CRM
  linking is skipped and orders are unchanged. Code:
  `artifacts/api-server/src/lib/notion/clients.repository.ts`
  (`upsertClientByEmail`), wired from `orders.service.ts`; the order's `Client`
  relation is written by `orders.blocks.ts`. **Appointment scheduling** instead uses Google: `GOOGLE_SERVICE_ACCOUNT_KEY` (the full
  service-account JSON key, with domain-wide delegation authorized for the
  Calendar scope) and `APPOINTMENT_SHEET_ID` (the working-hours Google Sheet,
  shared with the service-account email; optional `APPOINTMENT_SHEET_RANGE`,
  default `A2:F`). Enable both the Calendar and Sheets APIs. Checkout also
  needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (the signing secret of the
  Stripe webhook endpoint), and `PUBLIC_BASE_URL` (the site origin Stripe
  redirects back to after payment). Optionally, `STRIPE_SHIPPING_RATE_IDS` — a
  comma-separated list of Stripe Shipping Rate ids (`shr_…`) to offer at shop
  checkout (unset ⇒ no shipping charged, i.e. no shipping options appear at
  checkout at all). **Mode-scoped:** the ids must be created in the same Stripe
  mode as `STRIPE_SECRET_KEY`, so map Vercel environments to modes — **Production**
  gets your **live** `shr_…` ids, **Preview/Development** get your **test** ids
  (a test-mode rate won't work with a live key, and vice-versa). The rate's
  currency must be USD to match the checkout session, or Stripe silently drops
  it. The atelier reprices by editing the rate's amount in the Dashboard (no
  redeploy); a redeploy is only needed when the ids themselves change. Customer
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
- **Optional appointment-booking policy env vars:** `APPOINTMENT_TIMEZONE`
  (IANA zone for working hours/slots, default `America/Chicago`),
  `APPOINTMENT_MIN_LEAD_HOURS` (24), `APPOINTMENT_MAX_ADVANCE_DAYS` (45), and
  `APPOINTMENT_SLOT_STEP_MINUTES` (15). All have defaults.
- **Optional measurement-change env var:** `MEASUREMENT_LOCK_FROM_STAGE` (default
  `Cutting/Pinning`) — the live **Stage** option at/after which an order's
  measurements are frozen and `POST /orders/:n/measurement-change-requests` is
  rejected. Like `STATUS_IN_STOCK`, this names a specific option value (a targeted
  business rule), so if the atelier renames that stage in Notion, set this override.
  See `services/measurement-change.service.ts`.

## Quick reference — where things live

| I want to…                               | Go to                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change an API request/response shape     | `lib/api-spec/openapi.yaml` → run codegen                                                                                                                                                                                                                                          |
| Change order use-case logic              | `artifacts/api-server/src/services/orders.service.ts`                                                                                                                                                                                                                              |
| Change Notion I/O                        | `artifacts/api-server/src/lib/notion/*`                                                                                                                                                                                                                                            |
| Change a customer email / template       | `artifacts/api-server/src/lib/resend/*` (`emails.ts` copy, `send.ts` transport, `client.ts` config)                                                                                                                                                                                |
| Add/modify an API route                  | `artifacts/api-server/src/routes/*`                                                                                                                                                                                                                                                |
| Add request validation / error mapping   | `artifacts/api-server/src/middlewares/*`                                                                                                                                                                                                                                           |
| Change the status-lookup UI              | `artifacts/web-app/src/pages/status.tsx`                                                                                                                                                                                                                                           |
| Change the order intake form             | `artifacts/web-app/src/pages/order-form.tsx`                                                                                                                                                                                                                                       |
| Change the measurement-change request    | `artifacts/web-app/src/components/measurement-change-dialog.tsx` (opened from `pages/status.tsx`); `api-server/src/services/measurement-change.service.ts` + `routes/orders.ts` + `lib/notion/measurement-change.{blocks,repository}.ts` (writes to the **contact** database)      |
| Change the landing page                  | `artifacts/web-app/src/pages/home.tsx`                                                                                                                                                                                                                                             |
| Change the shop (live Notion inventory)  | `artifacts/web-app/src/pages/shop.tsx` + `services/products.service.ts` + `lib/notion/products.*`                                                                                                                                                                                  |
| Change the back-in-stock notify dialog   | `artifacts/web-app/src/components/notify-dialog.tsx` + `services/notify.service.ts` + `lib/notion/notify.*` (writes to the **contact** database — see below)                                                                                                                       |
| Change shop checkout / payments          | `artifacts/web-app/src/lib/cart.tsx` + `components/cart-drawer.tsx` + `components/add-to-cart.tsx` (frontend); `api-server/src/services/checkout.service.ts` + `routes/checkout.ts` + `routes/stripe-webhook.ts` + `lib/stripe/*` + `lib/notion/shop-orders.*` (backend)           |
| Change shop-order tracking               | `artifacts/web-app/src/pages/shop-order-status.tsx` (+ order number on `pages/shop-success.tsx`); `api-server/src/services/shop-orders.service.ts` + `routes/shop-orders.ts` + `lib/notion/shop-orders.{blocks,repository}.ts` + `services/checkout.service.ts` (mints the number) |
| Change the footer / legal pages          | `artifacts/web-app/src/components/footer.tsx` (global, in `App.tsx`) + `pages/{privacy,terms,shipping-returns}.tsx` + `components/legal-page.tsx`; shared studio contact details in `lib/contact-info.ts`                                                                          |
| Change custom-order deposits             | `artifacts/web-app/src/pages/status.tsx` (`DepositSection`); `api-server/src/services/deposit.service.ts` + `routes/orders.ts` + `lib/notion/orders.repository.ts` (`findDepositTarget`/`markDepositPaid`) + `routes/stripe-webhook.ts`                                            |
| Change custom-order invoice / balance    | `artifacts/web-app/src/pages/invoice.tsx` + status page's "View Invoice" card; `api-server/src/services/invoice.service.ts` + `routes/orders.ts` (`POST /orders/:n/invoice`) + `lib/notion/invoice.{schema,repository}.ts` + `routes/stripe-webhook.ts`                            |
| Change production-schedule milestones    | `api-server/src/services/schedule.service.ts` + `routes/cron.ts` + `lib/notion/production-schedule.{blocks,repository}.ts` + `lib/notion/orders.repository.ts` (`findOrdersNeedingMilestones`/`markMilestonesGenerated`); cron in `vercel.json`                                    |
| Change appointment booking (UI)          | `artifacts/web-app/src/pages/appointments.tsx`                                                                                                                                                                                                                                     |
| Change appointment types / routing rules | `api-server/src/lib/appointments/catalog.ts` (targeted business rule — durations, which staff, which locations)                                                                                                                                                                    |
| Change staff working hours / calendars   | The working-hours **Google Sheet** (`APPOINTMENT_SHEET_ID`); read in `api-server/src/lib/google/sheets.repository.ts`, parsed by `lib/appointments/staff.ts`                                                                                                                       |
| Change appointment slot logic / policy   | `api-server/src/lib/appointments/availability.ts` (`computeSlots`) + `time.ts` + `settings.ts`; `services/appointments.service.ts` + `routes/appointments.ts` + `lib/google/*` (Calendar free/busy + event insert)                                                                 |
| Add a page / route                       | new `src/pages/*.tsx` + `<Route>` in `src/App.tsx`                                                                                                                                                                                                                                 |
| Add or rename a nav link                 | `NAV_LINKS` in `artifacts/web-app/src/components/navbar.tsx`                                                                                                                                                                                                                       |
| Add a shared UI component                | `artifacts/web-app/src/components/ui/`                                                                                                                                                                                                                                             |
| Add/change a shared test fixture         | `lib/test-fixtures/src/index.ts` (read its guardrail first)                                                                                                                                                                                                                        |
| Understand a past decision / gotcha      | `.agents/memory/`                                                                                                                                                                                                                                                                  |
| Adjust the Vercel serverless entrypoint  | `api/index.ts` + `vercel.json`                                                                                                                                                                                                                                                     |

```

```
