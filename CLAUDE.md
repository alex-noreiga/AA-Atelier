# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**AA-Atelier** is the order-management web app for a custom figure skating/dance
costume business. Two core customer flows: **order status lookup** (order
number → vertical timeline of stages) and **new order intake** (contact +
measurements + dress notes → custom order). These sit inside a small marketing
site — landing page (`pages/home.tsx`) + Services/About/Shop/Contact, all fully
built out, reachable from a global navbar.

There is **no traditional database for orders** — orders live in a **Notion
database** the team manages directly through the Notion UI; the API server
talks to the Notion REST API. Deployed on **Vercel** (migrated off Replit —
see `.agents/memory/vercel-migration.md`).

## Repository layout

**pnpm workspace monorepo** (globs in `pnpm-workspace.yaml`: `artifacts/*`,
`lib/*`, `tests`). Every workspace package is `@workspace/<name>`. `scripts/`
is plain bash tooling, deliberately not a workspace package.

```
artifacts/
  web-app/           Frontend SPA (Vite + React 19 + Tailwind v4 + shadcn/ui)
    src/App.tsx      wouter routes + global <Navbar />
    src/pages/       one component per route
    src/components/  navbar.tsx, page-shell.tsx, footer.tsx, legal-page.tsx,
                     ui/ (shadcn primitives, pruned — re-add with `npx shadcn add <name>`)
  api-server/        Backend (Express 5) — talks to Notion, bundled by esbuild
    src/routes/      thin HTTP handlers (validate → service → respond)
    src/services/    HTTP-agnostic use-cases
    src/middlewares/ zod validation + central error handler
    src/lib/notion/  Notion adapter: client, schema mapping, block builder, repository
api/
  index.ts           Vercel serverless entrypoint — re-exports the built Express app
lib/
  api-spec/          OpenAPI spec (openapi.yaml) + orval codegen config — SOURCE OF TRUTH
  api-zod/           GENERATED zod schemas (server-side validation)
  api-client-react/  GENERATED react-query hooks + typed fetch client (frontend)
  test-fixtures/     Shared domain fixtures for all three test suites
scripts/             Bash tooling: cleanup.sh, install-hooks.sh, pre-push/post-merge hooks
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
  ├─ GET  /api/healthz                       → { status: "ok" }
  ├─ GET  /api/orders/:orderNumber           → order status + stage list
  ├─ POST /api/orders                        → creates a Notion page, returns order number;
  │                                            confirmation email; best-effort CRM upsert+link
  ├─ POST /api/orders/:n/payments/:stage     → Stripe Checkout session for one payment stage
  │                                            (first/second deposit, balance), priced
  │                                            server-side from the order's invoice; webhook marks paid
  ├─ POST /api/orders/:n/measurement-change-requests
  │                                          → files a change request in "Website Contact
  │                                            Messages" (Request type = Measurement update).
  │                                            Gated: values-or-appointment, email must match
  │                                            order, rejected once in production
  │                                            (MEASUREMENT_LOCK_FROM_STAGE). Never edits the
  │                                            order directly — atelier applies by hand
  ├─ POST /api/contact                       → saves to "Website Contact Messages" + ack email
  ├─ GET  /api/products                      → shop inventory + live category list (Notion "inventory")
  ├─ GET  /api/shop-orders/:orderNumber      → shop order fulfillment status + live status list
  ├─ POST /api/notify                        → back-in-stock request in the contact database
  │                                            (Request type = Back in stock) + confirmation email
  ├─ POST /api/checkout                      → prices items from live Notion inventory,
  │                                            creates Stripe Checkout session, returns URL
  ├─ GET  /api/checkout/session/:id          → session status + itemized receipt for success page
  ├─ GET  /api/appointments/options          → bookable types, staff/locations, timezone
  ├─ GET  /api/appointments/availability     → open slots (working hours minus Google free/busy)
  ├─ POST /api/appointments                  → books a slot (re-checked server-side), writes a
  │                                            Google Calendar event (+ Meet for virtual) + email
  ├─ POST /api/webhooks/stripe               → Stripe webhook (raw body, signed). On
  │                                            checkout.session.completed, records paid order in
  │                                            Notion "Shop Orders". NOT in the OpenAPI contract.
  ├─ GET  /api/cron/generate-milestones      → Vercel Cron reconciliation (CRON_SECRET Bearer).
  │                                            Writes per-stage milestone rows to "Production
  │                                            Schedule" for orders with a Due Date. NOT in spec.
  └─ GET  /api/cron/generate-milestones/run  → same reconciliation, on demand via a Notion
                                               "Open link" button (`?secret=<CRON_SECRET>`,
                                               returns HTML). NOT in spec.
```

The customer-notification POSTs (`/api/orders`, `/api/contact`, `/api/notify`,
`/api/appointments`, `/api/orders/:n/measurement-change-requests`) each send a
customer email via **Resend** as a **best-effort** side effect after the
Notion write — logged-and-swallowed on failure, never changes the response
status (adapter in `artifacts/api-server/src/lib/resend/`; see
`.agents/memory/vercel-migration.md`). This replaced old Notion automations.
Order **status-change** emails are intentionally not handled here — stage
changes happen inside Notion and there's no Notion→app trigger.

Each also sends an **internal atelier notification** to `ATELIER_INBOX_EMAIL`
(Reply-To = customer) — skipped if unset. Customer/atelier builders live
side by side in `lib/resend/emails.ts`.

Emails are grouped into three **categories** (`lib/resend/config.ts`): orders,
contact, appointments. Each resolves a sender + notification inbox from env,
with per-category overrides falling back to the base vars when unset:
`RESEND_CONTACT_FROM_EMAIL`/`RESEND_APPOINTMENTS_FROM_EMAIL` → `RESEND_FROM_EMAIL`,
`ATELIER_CONTACT_INBOX_EMAIL`/`ATELIER_APPOINTMENTS_INBOX_EMAIL` →
`ATELIER_INBOX_EMAIL` (via `fromAddress(category)`/`atelierInbox(category)`).
Lets e.g. order mail send from `orders@` and contact mail from `hello@`.

**Production error alerting.** The app also emails `ALERT_INBOX_EMAIL` (default
`alexandra@a3iceanddance.com`) on error-level conditions that would otherwise be
invisible: unhandled 500s, failed Stripe-webhook records, failed milestone
cron, or a Resend-rejected customer email (`services/alert.service.ts`:
`reportError`/`reportEmailFailure`, reusing the Resend adapter — chosen over a
Vercel Log Drain since Log Drains need Pro and an in-process **awaited** send
flushes reliably on serverless). Load-bearing: it sends via the **strict**
`sendEmail` and logs its own failures at `warn` without re-entering
`reportError` (loop guard); self-gates when `RESEND_API_KEY`/`RESEND_FROM_EMAIL`
are unset; a per-instance 5-minute de-dupe bounds repeats (can't throttle
across instances). Deliberately not wired to the CRM-upsert or shipping-rate
catches, to keep alerts high-signal.

- **Locally:** Vite dev server proxies `/api` to Express on `localhost:3000`
  (`artifacts/web-app/vite.config.ts`).
- **On Vercel:** `vercel.json` rewrites `/api/:path*` → `/api/index`
  (`api/index.ts`), which imports the **pre-bundled** Express app from
  `artifacts/api-server/dist/app.mjs` (esbuild, `build:vercel`) — deliberately
  not the TS source, so `@vercel/node` doesn't type-check the whole workspace.
  Don't "fix" this by importing source.

### The API is contract-first — the most important convention

`lib/api-spec/openapi.yaml` is the **single source of truth**. Two packages are
**generated from it** by [orval](https://orval.dev) and must never be
hand-edited: `lib/api-zod` (server-side zod schemas) and `lib/api-client-react`
(react-query hooks + typed fetch client). Files under `src/generated/` carry a
"Do not edit manually" header. To change the API: edit `openapi.yaml` → run
`pnpm --filter @workspace/api-spec run codegen` (orval + re-typecheck) →
update route handlers/frontend.

`lib/api-client-react/src/custom-fetch.ts` is the **mutator** (hand-written,
not generated) — safe to edit. Both frontend flows use the generated client:
`pages/status.tsx` (`useGetOrderStatus`), `pages/order-form.tsx`
(`useCreateOrder`, whose local zod schema is checked against the generated
`NewOrderRequest` so it can't silently drift).

## Working with Notion (read `.agents/memory/` first)

Lives in `artifacts/api-server/src/lib/notion/` (`client.ts` REST client,
`orders.schema.ts` property constants/extractors, `orders.blocks.ts` page-body
builder, `orders.repository.ts` create/lookup — each domain follows the same
`*.blocks.ts`/`*.schema.ts`/`*.repository.ts` prefix convention). Encodes two
hard-won lessons (full detail in `.agents/memory/`):

1. **Property types must match the live schema, not the name.** "Order
   Number" is `rich_text`, **not** `number` (leading zeros, `"000002"`) —
   filters must use `rich_text: { equals }`. Inspect the actual property
   `type` before writing any filter. See `notion-status-filters.md`.

2. **Never hardcode a Notion option list.** The atelier edits select/status
   options directly in Notion, expecting changes without a redeploy. Two
   places read options live from `GET /v1/databases/{id}` (60s TTL cache,
   fallback on error): `fetchLiveOrderStages()` (order Stage, in
   `orders.repository.ts`) and `listCategories()` (shop Item Type, in
   `products.repository.ts`). Don't reintroduce a hardcoded constant.
   (`lib/stage-descriptions.ts` per-stage text is cosmetic flavor only.)

   Deliberate exceptions — targeted business rules naming specific values:
   `STATUS_IN_STOCK` ("In Stock" is the only sellable status),
   `SIZED_CATEGORIES` in `pages/shop.tsx` (Dress/Ready to Wear show the size
   chart), and `MEASUREMENT_LOCK_FROM_STAGE`
   (`services/measurement-change.service.ts`, default `Cutting/Pinning`,
   env-overridable). These name values, not the list — rename the option in
   Notion and update these too.

3. **The contact database has three writers.** "Website Contact Messages"
   holds contact-form messages (`contact.blocks.ts`), back-in-stock requests
   (`notify.blocks.ts`), and measurement-change requests
   (`measurement-change.blocks.ts`), separated by **Request type**
   (Inquiry/Back in stock/Measurement update). Restock carries Item + Size as
   real properties; measurement-change carries order number + requested
   measurements. Shared property names are exported from `contact.blocks.ts`
   and imported by the other two — keep it that way so they can't drift.

Auth: `NOTION_API_KEY` + `NOTION_ORDERS_DATABASE_ID` env vars, read at first
use in `createNotionClient` (not module load). The Replit sidecar is gone.

## Working with Stripe (shop checkout)

Ready-to-ship items sell through **Stripe Checkout (hosted)**. Flow: cart
(`web-app/src/lib/cart.tsx`, localStorage) POSTs
`{ variantId, size?, quantity }[]` to `/api/checkout`; server prices from live
Notion inventory, creates a session, returns its URL; browser redirects;
Stripe calls `/api/webhooks/stripe`, which records the paid order in Notion.
Code: `checkout.service.ts`, `lib/stripe/client.ts`, `routes/checkout.ts`,
`routes/stripe-webhook.ts`, `lib/notion/shop-orders.*`. Load-bearing:

1. **Never trust client-sent money.** Cart sends only ids/sizes/quantities;
   `checkout.service` recomputes every price/availability from
   `listVariants()` (live Notion), converts dollars→cents
   (`Math.round(price * 100)`), rejects sold-out/unpriced/unknown items with a
   400. "Inquire for price" items (no `Listed Price`) aren't purchasable.

2. **The webhook needs the RAW body.** Mounted with `express.raw()` **before**
   `express.json()`, directly on the app (not the `/api` router). Deliberately
   **not** in `openapi.yaml` — a Stripe→server contract, not part of the
   browser API.

3. **Recording is idempotent.** `recordPaidOrder` dedupes on the Stripe
   session id (stored + looked up before insert) so retries don't duplicate.

4. **Inventory is manual for v1.** `Quantity Available` is a Notion formula
   (unwritable); a sale doesn't decrement stock — the atelier adjusts by hand.
   Auto-decrement needs a new writable count property + reservation logic.

5. **Shipping rates live in Stripe, not code.** `STRIPE_SHIPPING_RATE_IDS`
   (comma-separated `shr_…`) attach as `shipping_options`; unset ⇒ no
   shipping charged. Each id is validated at session-create time
   (`resolveShippingOptions`) and kept only if it exists, is active, and is
   USD-priced; an invalid id is dropped + logged at `error` (degrades, doesn't
   500) — watch for "Skipping shipping rate" in logs.

6. **Tax is Stripe Tax, shop cart only.** `automatic_tax: { enabled: true }`,
   `tax_behavior: "exclusive"` — needs an origin + default tax category
   configured in the Stripe Dashboard or it computes $0. Deposits are
   intentionally untaxed; `invoice.service` sets `automatic_tax` only on the
   `balance` stage.

7. **Receipts are Stripe's job; the success page mirrors them.** The emailed
   receipt is a Dashboard setting. `getCheckoutSession` returns an itemized
   view (line items, subtotal, shipping, tax, total) that `shop-success.tsx`
   renders — works for shop-cart orders and deposits.

8. **Each shop order gets an `SHP-…` tracking number.**
   `createCheckoutSession` mints it (`generateShopOrderNumber` in
   `shop-orders.blocks.ts`), stores it in `metadata.orderNumber`, which flows
   to the webhook session with no extra Stripe round-trip and is written to
   the Shop Orders `Order Number` property. Customer tracks it at
   `pages/shop-order-status.tsx` (`GET /shop-orders/:orderNumber` →
   `findShopOrderByNumber`/`fetchLiveShopOrderStatuses`, live Notion Status
   as a timeline — same live-list rule as order stages). Surfaced on the
   success page, in the confirmation email, and to the atelier. Only orders
   placed after this shipped have an `Order Number`.

The atelier must one-time create the "Shop Orders" database
(`shop-orders.blocks.ts` properties incl. `Order Number` rich_text) and share
the integration. Local testing: Stripe test keys +
`stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

### Custom-order payments (invoice = source of truth for all three stages)

Custom orders pay in **three staged payments**: first deposit (after sketch),
second deposit (first fitting), final balance (after delivery = itemized
materials + labor − both deposits). All three are owned by the order's
**invoice** in the atelier's Notion finance system — the app **reads** it,
never recreates the costing. The order row carries only the `Invoices`
relation (limit 1); no deposit fields on the order itself.

- **`invoices & payments`** (`NOTION_INVOICES_DATABASE_ID`): one invoice per
  order (`Order` relation), `Final Balance` (rollup), `Line Items` relation,
  `Invoice Ready`, plus `First/Second Deposit Amount` (number),
  `First/Second Deposit Paid` (checkbox), `First/Second Deposit Session Id`
  (rich_text), `Balance Paid` (checkbox), `Balance Payment Session Id`
  (rich_text), `Balance Due` formula. Names in `lib/notion/invoice.schema.ts`.
- **`Invoice Line Items`** (`NOTION_INVOICE_LINE_ITEMS_DATABASE_ID`): each
  line has `Line Type` (Garment/Material/Labor/Deposit/Adjustment) + `Line
Total` (formula); materials are broken out per item.

One endpoint serves all three: `POST /orders/:n/payments/:stage`
(`first_deposit`/`second_deposit`/`balance` → `createPaymentCheckout` in
`invoice.service.ts`). Load-bearing:

1. **Every amount priced server-side from the invoice.** Deposit amount =
   its `First/Second Deposit Amount`; balance =
   `Σ(non-deposit Line Totals) − Σ(paid deposits)`, floored at 0
   (`buildInvoiceView`). `Line Type = Deposit` rows are excluded from the
   subtotal (can't double-count). No amount set / already paid / (balance)
   invoice not ready → 400.

2. **Deposits are payable before the invoice is itemized.** `getOrderStatus`
   surfaces `deposits[]` as soon as an amount is set, independent of
   `Invoice Ready`; the itemized `invoice` object (and balance charge) is
   gated on `Invoice Ready` (`status.tsx` deposit cards + "View Invoice",
   `pages/invoice.tsx`).

3. **Tax on the balance only** — `automatic_tax`, `tax_behavior: "exclusive"`,
   `billing_address_collection: "required"`, no shipping step. Deposits
   untaxed.

4. **Write-back is invoice-only + idempotent.** The one webhook routes
   `metadata.kind = "custom_payment"` to `recordPayment` →
   `markInvoicePaid(invoice, stage, sessionId)` (ticks paid checkbox +
   session-id text, never the costing formulas). Paid checkbox is the guard;
   shop-success skips cart-clearing for `custom_payment`.

Atelier must one-time: add the payment fields above to invoices & payments
(order keeps only `Invoices` relation); share the integration with invoices &
payments + Invoice Line Items; set both env vars. Code:
`invoice.service.ts`, `routes/orders.ts`, `routes/stripe-webhook.ts`,
`lib/notion/invoice.{schema,repository}.ts`, `status.tsx`, `invoice.tsx`.

## Production schedule (auto-generated stage milestones)

The atelier plans work in **"📅 Production Schedule"**
(`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`, Timeline/Calendar views keyed on
`Target Completion Date`). The app **auto-generates one dated milestone row
per remaining stage** for custom orders with a firm due date. Full design in
`.agents/memory/production-schedule-milestones.md`; load-bearing:

1. **Trigger is a reconciliation cron (+ on-demand button), not a Notion
   push.** No Notion→app trigger exists, so the atelier sets `Due Date` and a
   reconciliation later scans for orders with a due date but unset
   `Milestones Generated`, generating their milestones via
   `generatePendingMilestones` — run nightly by **Vercel Cron**
   (`GET /api/cron/generate-milestones`, Bearer `CRON_SECRET`) and on demand
   by a Notion "Open link" button
   (`GET /api/cron/generate-milestones/run?secret=<CRON_SECRET>`, since a
   button can't send a Bearer header; the request logger strips the query
   token). Both endpoints are CRON_SECRET-guarded and, like the Stripe
   webhook, deliberately outside the OpenAPI contract. Code: `routes/cron.ts`
   → `schedule.service.ts` → `orders.repository.ts`
   (`findOrdersNeedingMilestones`/`markMilestonesGenerated`) +
   `production-schedule.{blocks,repository}.ts`.

2. **Scheduling is even-split over the live stage list — don't hardcode
   stages.** `computeMilestoneSchedule` spreads stages from the order's
   current stage forward evenly across `[today, dueDate]` (final stage lands
   on the due date; a past-due date clamps all to it). Stage list comes live
   via `fetchLiveOrderStages`. `Production Stage` is a select (Notion
   auto-creates options) — distinct from the milestone's `Status`
   (completion state).

3. **Idempotent.** `Milestones Generated` checkbox + an existing-milestones
   lookup (`orderHasMilestones`, by `Order` relation) prevent duplicate rows;
   the checkbox flips only after every row is written; one order's failure is
   logged-and-skipped, not batch-aborting. To reschedule after a due-date
   change, uncheck `Milestones Generated` (and delete stale rows).

Atelier must one-time: add `Due Date` (date) + `Milestones Generated`
(checkbox) to Order Tracking Pipeline; add `Production Stage` (select) +
`Order` (relation) to Production Schedule; share the integration; set
`NOTION_PRODUCTION_SCHEDULE_DATABASE_ID` + `CRON_SECRET`; optionally add a
Notion Button → "Open link" →
`https://<PUBLIC_BASE_URL>/api/cron/generate-milestones/run?secret=<CRON_SECRET>`.
Property names: `orders.schema.ts` + `production-schedule.blocks.ts`.

## Appointment scheduling (real-time slot booking)

Customers book appointments (consultations/fittings/design reviews/general)
from `pages/appointments.tsx` (purpose → format → time → details), via the
generated client (`useGetAppointmentOptions`, `useGetAppointmentAvailability`,
`useCreateAppointment`). Runs on **Google Calendar** (not Notion) — free/busy
is the conflict source, each booking is a calendar event. Code:
`api-server/src/lib/appointments/*`, `lib/google/*`,
`services/appointments.service.ts`, `routes/appointments.ts`. Load-bearing:

1. **The type catalog is a targeted business rule in code.**
   `lib/appointments/catalog.ts` names the four types, durations, and routing
   (Alayna: consultations + design reviews; Alexandra: everything; fittings
   in-person only) — like `STATUS_IN_STOCK`/`SIZED_CATEGORIES`, values coupled
   to code. Staff names here must match the `Staff` column in the
   working-hours sheet.

2. **Working hours are a Google Sheet; conflicts are Google free/busy.**
   `computeSlots` (`lib/appointments/availability.ts`, pure, heavily tested)
   needs a positive grid of open hours, which free/busy can't give. That grid
   is a **Google Sheet** the atelier edits live (`Staff | Email | Day | Start
   | End | Locations`), read by `lib/google/sheets.repository.ts`
   (`APPOINTMENT_SHEET_ID`, 60s cache + fallback) and parsed by
   `lib/appointments/staff.ts` (`parseScheduleRows`, `Mon-Fri` ranges, comma
   lists). The subtractive side — every busy interval, including bookings and
   any staff-added event (a day off is just a calendar event) — comes from
   FreeBusy (`lib/google/calendar.repository.ts`, `listBusyInRange`) fed in
   as `bookings`; `timeOff` is always empty. Wall-clock hours/slots use
   `APPOINTMENT_TIMEZONE` (DST-correct via `time.ts`, `Intl`-based); busy
   times are UTC instants.

3. **Never trust a client-sent slot.** `POST /appointments` re-derives the
   type and re-runs the same `computeSlots` (fresh free/busy) before writing;
   a stale/taken/off-grid/inside-lead-time `start` → 400. Availability and
   booking share one function, so they can't disagree — hence free/busy is
   read fresh, no cache.

4. **Booking writes a calendar event, as the staff member.** Auth is a
   Google Workspace service account with domain-wide delegation
   (`lib/google/client.ts`): impersonates each staff member to read free/busy
   and `events.insert` with `sendUpdates=all` (real invite) and, for virtual,
   a Meet link. Meet/calendar links flow to the response, email, and success
   screen. Calendar is the sole record — no Notion appointments database.

5. **Booking is free and slots aren't held.** No Stripe step, no
   pending-hold — a double-booked slot is an accepted small race. Policy is
   env-tuned: `APPOINTMENT_TIMEZONE`, `APPOINTMENT_MIN_LEAD_HOURS` (24),
   `APPOINTMENT_MAX_ADVANCE_DAYS` (45), `APPOINTMENT_SLOT_STEP_MINUTES` (15),
   read at call time in `settings.ts`.

6. **Google setup.** Enable Calendar API + Sheets API; create a service
   account (JSON key → `GOOGLE_SERVICE_ACCOUNT_KEY`); authorize its client id
   for the Calendar scope under Workspace Admin → Security → API controls →
   Domain-wide delegation. Share the working-hours Sheet with the
   service-account email (Viewer; no delegation needed for Sheets).
   `google-auth-library` mints tokens; rest is raw `fetch`, mirroring Notion.

## Development workflow

### Prerequisites

- **pnpm required** (`preinstall` hook fails npm/yarn installs).
- Node per `@types/node` ^26.
- Copy `.env.example` → `.env`, fill in `NOTION_API_KEY` +
  `NOTION_ORDERS_DATABASE_ID`.

### Install & run

```bash
pnpm install
pnpm dev   # backend (:3000) + frontend (Vite), in parallel
```

`pnpm dev` runs `@workspace/api-server` + `@workspace/web-app` dev scripts;
frontend proxies `/api` to backend. api-server's `dev` builds with esbuild and
runs the bundle, reading env from repo-root `.env` via `DOTENV_CONFIG_PATH`.

### Build & typecheck

```bash
pnpm build          # typecheck everything, then build all packages
pnpm build:vercel   # what Vercel runs: esbuild api-server + vite frontend
pnpm typecheck      # tsc --build across project references + per-package
```

TypeScript uses **project references** (`tsconfig.json` → `lib/*`,
`tsconfig.base.json` shared options). `customConditions: ["workspace"]` lets
packages resolve each other from **source** during typecheck. `strict` null
checks, `module: esnext`, `moduleResolution: bundler`, `noEmitOnError`, ESM
everywhere.

### Tests

```bash
pnpm test          # all unit + integration tests (Vitest, no network)
pnpm test:e2e      # Playwright e2e (tests/e2e/*.spec.ts)
```

- **Layout.** Every package keeps Vitest tests in `test/` at the package root
  (not co-located in `src/`, so they stay out of the build graph), with
  `test/support/` for setup + helpers. Shared fixtures from
  `@workspace/test-fixtures`.
- **`.test.ts` vs `.spec.ts` is load-bearing.** Vitest = `*.test.ts(x)`,
  Playwright = `*.spec.ts` — keeps each runner's glob from matching the
  other's files. Don't "unify" these.
- **Shared fixtures (`lib/test-fixtures`).** `@workspace/test-fixtures` holds
  fixtures used by all three suites (`createOrderInput()`, `orderRecord()`,
  `contactInput()`, `STAGES`, `GENERIC_ERROR`), typed against
  `@workspace/api-zod` so they can't drift from the API. Two rules (also in
  the package header): (1) a fixture is only ever a **stub input**, never the
  expected output of the mapper consuming it — where a test both stubs and
  asserts, the assertion stays hand-written; (2) Notion-wire-shaped fakes
  (`orderPage()`, `databaseSchemaWithStages()`) stay local to
  `api-server/test/support/fake-notion.ts`, a different layer from the DTOs.
- **Tests are typechecked** via each package's `tsconfig.test.json` (covers
  the test dir without adding it to build/emit); `pnpm typecheck` runs them.
  `tests/tsconfig.json` maps `@workspace/test-fixtures` to source since
  Playwright won't transpile TS inside `node_modules`.
- **Backend unit/integration (Vitest).** `api-server/test/` —
  `unit/` (Notion schema/block-builder pure-function tests, repository tests
  against an injected fake `NotionClient`, service logic) and `integration/`
  (supertest over the real Express stack, Notion repo mocked). No server, no
  network. `vitest run test/unit` is the fast loop.
- **Frontend component (Vitest + Testing Library).** `web-app/test/` (jsdom)
  — status-timeline states, shop render/filter states, order-form validation
  + payload mapping. Each mocks the generated hook it needs
  (`vi.mock("@workspace/api-client-react")`) via `test/support/mock-hook.ts`.
  Both Vitest configs set `clearMocks: true`.
- **Coverage.** `pnpm test:coverage` runs both suites with v8 coverage —
  report-only (no thresholds, never fails CI); HTML report per package's
  `coverage/`. CI runs it in place of `pnpm test` and uploads it as an
  artifact.
- `pnpm test` filters on `./artifacts/**` (not `-r`) so `@workspace/tests`'s
  `playwright test` script isn't dragged into the unit-test run pre-browser-install.
- **End-to-end (Playwright).** Self-contained by default: Playwright starts
  its own dev server (`webServer` in `playwright.config.ts`) and every spec
  intercepts `/api/*` (`tests/e2e/support/mock-api.ts`) — no api-server or
  Notion needed. Set `PLAYWRIGHT_BASE_URL` to point at an already-running app
  instead. `order-form.spec.ts` has an opt-in live-Notion smoke test
  (`E2E_LIVE_NOTION=1`) — the only path writing to real Notion.
- **CI** (`.github/workflows/ci.yml`, every PR + push to `main`): install →
  typecheck → both Vitest suites → Playwright (installs its own Chromium).
  Chromium resolution order: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` → NixOS
  system Chromium → Playwright's managed browser.

## Conventions & gotchas

- **ESM only.** Server-side relative imports use explicit `.js` extensions
  (e.g. `./routes/index.js`) even though source is `.ts` — required for
  `@vercel/node`/Node ESM resolution of compiled output. Don't drop them.
  Frontend uses `@/` → `artifacts/web-app/src`.
- **Shared dep versions** live in `catalog:` in `pnpm-workspace.yaml`
  (`"react": "catalog:"`, not pinned per package).
- **`minimumReleaseAge: 1440`** — pnpm won't install package versions <24h
  old (supply-chain hardening). Expect this on brand-new releases.
- **Frontend stack:** React 19, Vite 7, Tailwind v4 (`@tailwindcss/vite`, no
  `tailwind.config` — config in `src/index.css`), wouter, TanStack Query,
  shadcn/ui ("new-york") in `src/components/ui`, react-hook-form + zod.
  Minimal editorial/serif aesthetic — match it.
- **Navigation & page shell.** Routes declared with wouter in `src/App.tsx`
  (add before the `NotFound` fallback). Global nav is `navbar.tsx` — its
  `NAV_LINKS` array is the one place to add/rename links (drives desktop +
  mobile menu; `data-testid`s auto-derive from labels). Pages wrap content in
  `<PageShell>` (`page-shell.tsx`) — follow `pages/home.tsx` as scaffold.
- **Prettier** is the formatter (root devDependency).
- **Image upload is not supported.** GCS/Replit-sidecar upload path was
  deleted in the Vercel migration; `/storage/*`, `imageUrls`, and
  `lib/object-storage-web` are gone. Reintroducing it starts with
  `openapi.yaml` + regenerate.
- **No relational database.** Orders live in Notion; no Postgres/Drizzle
  (the old `lib/db` scaffold + `drizzle-orm` catalog entry were removed).
- **Dependencies are pruned — keep them that way.** 43 of 55 `ui/` components
  and 32 frontend deps were dead scaffold weight and got deleted
  (`react-icons` alone was 85M). Add only the shadcn component you use. Some
  deps look unused but are load-bearing — don't remove: `pino-pretty`
  (string transport target in `logger.ts`), `thread-stream` (version pin for
  `esbuild-plugin-pino`), `@testing-library/dom` (required peer,
  `autoInstallPeers: false`), `tw-animate-css`/`@tailwindcss/typography`
  (pulled in by `src/index.css`), root `prettier` (orval's codegen calls it).
- **Reclaiming disk.** `pnpm clean` removes regenerable build output;
  `pnpm clean:deep` also prunes stale Playwright browser builds (~540M).

## Git & deployment

- Default branch **`main`**; feature work on branches, merged via PR.
- Do **not** open a pull request unless explicitly asked.
- Vercel: `installCommand: pnpm install`, `buildCommand: pnpm run build:vercel`,
  output `artifacts/web-app/dist/public`.
- **Required Vercel env vars:** `NOTION_API_KEY`, `NOTION_ORDERS_DATABASE_ID`,
  `NOTION_CONTACT_DATABASE_ID` (Website Contact Messages — contact form +
  shop notify dialog), `NOTION_INVENTORY_DATABASE_ID` (shop `/products`),
  `NOTION_SHOP_ORDERS_DATABASE_ID` (checkout webhook writes here — needs an
  `Order Number` rich_text property), `NOTION_PRODUCTION_SCHEDULE_DATABASE_ID`
  (milestone cron), `NOTION_INVOICES_DATABASE_ID` +
  `NOTION_INVOICE_LINE_ITEMS_DATABASE_ID` (custom-order invoice flow). Share
  the Notion integration with each database or queries 404.
  `CRON_SECRET` guards the milestone cron's Bearer header and doubles as the
  on-demand button's `?secret=` token.
  Optionally `NOTION_CLIENT_CRM_DATABASE_ID` (Client CRM): when set, a new
  custom order best-effort upserts + links a client record by email
  (`clients.repository.ts`, `upsertClientByEmail`, wired from
  `orders.service.ts`); unset ⇒ skipped, orders unaffected.
  **Appointments** use Google instead: `GOOGLE_SERVICE_ACCOUNT_KEY` (full JSON
  key, domain-wide delegation for Calendar) + `APPOINTMENT_SHEET_ID`
  (working-hours Sheet, shared with the SA email; optional
  `APPOINTMENT_SHEET_RANGE`, default `A2:F`); enable Calendar + Sheets APIs.
  **Checkout** needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `PUBLIC_BASE_URL`. Optional `STRIPE_SHIPPING_RATE_IDS` (comma-separated
  `shr_…`; unset ⇒ no shipping charged) — **mode-scoped** (live ids in
  Production, test ids in Preview/Development, matching `STRIPE_SECRET_KEY`'s
  mode) and must be USD-priced or Stripe silently drops them; the atelier
  reprices in the Dashboard, no redeploy needed unless the ids change.
  Customer email needs `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (verified
  sender domain, SPF/DKIM, or mail won't deliver) — best-effort, a
  missing/failed mailer never fails the endpoint. Optional
  `ATELIER_INBOX_EMAIL` for internal notifications (unset ⇒ skipped); optional
  per-category overrides `RESEND_CONTACT_FROM_EMAIL`/`ATELIER_CONTACT_INBOX_EMAIL`
  and `RESEND_APPOINTMENTS_FROM_EMAIL`/`ATELIER_APPOINTMENTS_INBOX_EMAIL`, each
  falling back to the base var when unset.
- **Optional appointment policy env vars:** `APPOINTMENT_TIMEZONE` (default
  `America/Chicago`), `APPOINTMENT_MIN_LEAD_HOURS` (24),
  `APPOINTMENT_MAX_ADVANCE_DAYS` (45), `APPOINTMENT_SLOT_STEP_MINUTES` (15).
- **Optional `MEASUREMENT_LOCK_FROM_STAGE`** (default `Cutting/Pinning`) —
  the live Stage at/after which measurements freeze and change requests are
  rejected. A targeted business rule (like `STATUS_IN_STOCK`) — rename the
  stage in Notion, update this too. See `measurement-change.service.ts`.

## Quick reference — where things live

| I want to… | Go to |
| --- | --- |
| Change an API request/response shape | `lib/api-spec/openapi.yaml` → run codegen |
| Change order use-case logic | `api-server/src/services/orders.service.ts` |
| Change Notion I/O | `api-server/src/lib/notion/*` |
| Change a customer email / template | `api-server/src/lib/resend/*` (`emails.ts` copy, `send.ts` transport, `client.ts` config) |
| Add/modify an API route | `api-server/src/routes/*` |
| Add request validation / error mapping | `api-server/src/middlewares/*` |
| Change the status-lookup UI | `web-app/src/pages/status.tsx` |
| Change the order intake form | `web-app/src/pages/order-form.tsx` |
| Change the measurement-change request | `web-app/src/components/measurement-change-dialog.tsx`; `api-server/src/services/measurement-change.service.ts` + `routes/orders.ts` + `lib/notion/measurement-change.{blocks,repository}.ts` |
| Change the landing page | `web-app/src/pages/home.tsx` |
| Change the shop (live Notion inventory) | `web-app/src/pages/shop.tsx` + `services/products.service.ts` + `lib/notion/products.*` |
| Change the back-in-stock notify dialog | `web-app/src/components/notify-dialog.tsx` + `services/notify.service.ts` + `lib/notion/notify.*` |
| Change shop checkout / payments | `web-app/src/lib/cart.tsx` + `components/cart-drawer.tsx` + `components/add-to-cart.tsx`; `api-server/src/services/checkout.service.ts` + `routes/checkout.ts` + `routes/stripe-webhook.ts` + `lib/stripe/*` + `lib/notion/shop-orders.*` |
| Change shop-order tracking | `web-app/src/pages/shop-order-status.tsx` (+ order number on `shop-success.tsx`); `api-server/src/services/shop-orders.service.ts` + `routes/shop-orders.ts` + `lib/notion/shop-orders.{blocks,repository}.ts` |
| Change the footer / legal pages | `web-app/src/components/footer.tsx` + `pages/{privacy,terms,shipping-returns}.tsx` + `components/legal-page.tsx`; `lib/contact-info.ts` |
| Change custom-order payments (deposits + balance) | `web-app/src/pages/status.tsx` (`DepositsSection`) + `pages/invoice.tsx`; `api-server/src/services/invoice.service.ts` + `routes/orders.ts` (`POST /orders/:n/payments/:stage`) + `lib/notion/invoice.{schema,repository}.ts` + `routes/stripe-webhook.ts` |
| Change production-schedule milestones | `api-server/src/services/schedule.service.ts` + `routes/cron.ts` + `lib/notion/production-schedule.{blocks,repository}.ts` + `lib/notion/orders.repository.ts` (`findOrdersNeedingMilestones`/`markMilestonesGenerated`); cron in `vercel.json` |
| Change appointment booking (UI) | `web-app/src/pages/appointments.tsx` |
| Change appointment types / routing rules | `api-server/src/lib/appointments/catalog.ts` |
| Change staff working hours / calendars | Working-hours Google Sheet (`APPOINTMENT_SHEET_ID`); read in `lib/google/sheets.repository.ts`, parsed by `lib/appointments/staff.ts` |
| Change appointment slot logic / policy | `api-server/src/lib/appointments/availability.ts` (`computeSlots`) + `time.ts` + `settings.ts`; `services/appointments.service.ts` + `routes/appointments.ts` + `lib/google/*` |
| Add a page / route | new `src/pages/*.tsx` + `<Route>` in `src/App.tsx` |
| Add or rename a nav link | `NAV_LINKS` in `web-app/src/components/navbar.tsx` |
| Add a shared UI component | `web-app/src/components/ui/` |
| Add/change a shared test fixture | `lib/test-fixtures/src/index.ts` (read its guardrail first) |
| Understand a past decision / gotcha | `.agents/memory/` |
| Adjust the Vercel serverless entrypoint | `api/index.ts` + `vercel.json` |
