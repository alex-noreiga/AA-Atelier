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
global navbar. The informational pages are currently styled placeholders
("coming soon") awaiting real content.

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
  order-status/      Frontend SPA (Vite + React 19 + Tailwind v4 + shadcn/ui)
    src/App.tsx      wouter routes + a global <Navbar />
    src/pages/       one component per route (home landing, status, order-form,
                     services, about, shop, contact, not-found)
    src/components/  navbar.tsx (global nav), page-shell.tsx (page wrapper),
                     ui/ (shadcn primitives — pruned to only the 12 actually
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
Browser (order-status SPA)
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
  ├─ POST /api/contact             → saves a contact message to the Notion
  │                                  "Website Contact Messages" database
  │                                  + sends an acknowledgement email
  ├─ GET  /api/products            → shop inventory + the live category list,
  │                                  from the Notion "inventory" database
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
  └─ POST /api/webhooks/stripe     → Stripe → server webhook (raw body, signed).
                                     On checkout.session.completed, records the
                                     paid order in the Notion "Shop Orders"
                                     database. NOT part of the OpenAPI contract.
```

The customer-notification POST endpoints (`/api/orders`, `/api/contact`,
`/api/notify`) each send a customer email via **Resend** as a
**best-effort** side effect after the Notion write: the send is logged-and-swallowed
on failure and never changes the response status (see the Resend adapter in
`artifacts/api-server/src/lib/resend/` and the notification-email note in
`.agents/memory/vercel-migration.md`). This replaced the old Notion automations
that used to send these emails. Order **status-change** emails are intentionally
_not_ handled here — stage changes happen inside Notion and there is no Notion→app
trigger.

Each of those three also sends an **internal atelier notification** to
`ATELIER_INBOX_EMAIL` (with **Reply-To** set to the customer) — but only when that
env var is set; unset means the notification is skipped and only the customer email
goes out. So the atelier gets an email nudge on top of the Notion row. The
customer-facing and atelier-facing builders live side by side in
`lib/resend/emails.ts`.

Emails are grouped into two **categories** (`lib/resend/config.ts`): **orders**
(order + back-in-stock mail) and **contact** (contact-form mail). Each category
resolves a **sender** and a **notification inbox** from env, with the contact
overrides falling back to the base vars when unset (so unset ⇒ identical to a
single-address setup): sender `RESEND_CONTACT_FROM_EMAIL` → `RESEND_FROM_EMAIL`,
inbox `ATELIER_CONTACT_INBOX_EMAIL` → `ATELIER_INBOX_EMAIL`. The service resolves
the pair via `fromAddress(category)`/`atelierInbox(category)` and spreads the `from`
onto the message; the client uses a per-message `from` over its base. This lets,
e.g., order mail send from `orders@` and contact mail from `hello@`.

- **Locally:** the Vite dev server proxies `/api` to the Express server on
  `localhost:3000` (see `artifacts/order-status/vite.config.ts`).
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
(`client.ts` for the REST client, `schema.ts` for property-name constants +
extraction helpers, `blocks.ts` for the order page-body builder, and
`orders.repository.ts` for create/lookup). It encodes two hard-won lessons
captured in `.agents/memory/`:

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

   The one deliberate exception is a _targeted business rule_ naming specific
   option values — `STATUS_IN_STOCK` ("In Stock" is the only sellable status)
   and `SIZED_CATEGORIES` in `pages/shop.tsx` (only Dress / Ready to Wear show
   the size chart). These name values, not the list; rename those options in
   Notion and you must update them here too.

3. **The contact database has two writers.** "Website Contact Messages" holds
   both contact-form messages (`contact.blocks.ts`) and the shop's back-in-stock
   requests (`notify.blocks.ts`), separated by the **Request type** select
   (`Inquiry` / `Back in stock`). A restock request carries **Item** and **Size**
   as real properties, so the atelier can filter the inbox to everyone waiting on
   a piece rather than reading it out of free text. The property names the two
   writers share are exported from `contact.blocks.ts` and imported by
   `notify.blocks.ts` — keep it that way so they can't drift.

Auth: the server reads `NOTION_API_KEY` and `NOTION_ORDERS_DATABASE_ID` from
environment variables (via `createNotionClient` in `notion/client.ts`, read at
first use rather than module load). On Replit these came from a sidecar; that
path is gone.

## Working with Stripe (shop checkout)

The shop sells ready-to-ship items through **Stripe Checkout (hosted)**. The
flow: the client-side cart (`order-status/src/lib/cart.tsx`, persisted to
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
   reconcile with it.

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

The atelier must create the "Shop Orders" Notion database (properties in
`shop-orders.blocks.ts`) and share the integration with it. Local testing uses
Stripe test-mode keys + `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

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
(rich_text) to the orders database — property names live in `schema.ts`. Code:
`services/deposit.service.ts`, `lib/notion/orders.repository.ts`
(`findDepositTarget`/`markDepositPaid`), and the status page's `DepositSection`.

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

`pnpm dev` runs the `@workspace/api-server` and `@workspace/order-status` dev
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

**Frontend component (Vitest + Testing Library).** The `@workspace/order-status`
suite in `artifacts/order-status/test/` (jsdom) — the status-timeline
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
  (`@/components/...`) resolving to `artifacts/order-status/src`.
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
  output `artifacts/order-status/dist/public`.
- **Required Vercel env vars:** `NOTION_API_KEY`, `NOTION_ORDERS_DATABASE_ID`,
  `NOTION_CONTACT_DATABASE_ID` (the "Website Contact Messages" database that the
  `/contact` form **and** the shop's `/notify` dialog both write to),
  `NOTION_INVENTORY_DATABASE_ID` (the finished-goods "inventory" database the
  shop's `/products` endpoint reads), and `NOTION_SHOP_ORDERS_DATABASE_ID` (the
  "Shop Orders" database the checkout webhook writes paid orders to). The Notion
  integration must be shared with each database or queries 404. Optionally
  `NOTION_CLIENT_CRM_DATABASE_ID` (the "Client CRM" database): when set, a new
  custom order **best-effort** upserts a client record there (deduped by email)
  and links the order via the `Client ⇄ Orders` relation; unset ⇒ CRM linking is
  skipped and orders are unchanged. Code:
  `artifacts/api-server/src/lib/notion/clients.repository.ts` (`upsertClientByEmail`),
  wired from `orders.service.ts`; the order's `Client` relation is written by
  `blocks.ts`. Checkout also
  needs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (the signing secret of the
  Stripe webhook endpoint), and `PUBLIC_BASE_URL` (the site origin Stripe
  redirects back to after payment). Optionally, `STRIPE_SHIPPING_RATE_IDS` — a
  comma-separated list of Stripe Shipping Rate ids to offer at shop checkout
  (unset ⇒ no shipping charged). Customer notification emails also require
  `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (the verified sender, e.g.
  `A.A Atelier <orders@yourdomain>`). The sending domain must be verified in
  Resend (SPF/DKIM) or mail won't deliver. A missing/failed mailer is
  non-fatal: the send is best-effort and the endpoints still succeed.
  Optionally `ATELIER_INBOX_EMAIL` (e.g. `orders@yourdomain`) to also receive an
  internal notification for each new order / contact message / back-in-stock
  request; leave it unset to skip those. Optionally `RESEND_CONTACT_FROM_EMAIL` and
  `ATELIER_CONTACT_INBOX_EMAIL` (e.g. `hello@yourdomain`) to send/receive
  contact-form mail from a separate address; each falls back to the base
  `RESEND_FROM_EMAIL` / `ATELIER_INBOX_EMAIL` when unset (same verified domain, no
  extra Resend setup).

## Quick reference — where things live

| I want to…                              | Go to                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change an API request/response shape    | `lib/api-spec/openapi.yaml` → run codegen                                                                                                                                                                                                                                     |
| Change order use-case logic             | `artifacts/api-server/src/services/orders.service.ts`                                                                                                                                                                                                                         |
| Change Notion I/O                       | `artifacts/api-server/src/lib/notion/*`                                                                                                                                                                                                                                       |
| Change a customer email / template      | `artifacts/api-server/src/lib/resend/*` (`emails.ts` copy, `send.ts` transport, `client.ts` config)                                                                                                                                                                           |
| Add/modify an API route                 | `artifacts/api-server/src/routes/*`                                                                                                                                                                                                                                           |
| Add request validation / error mapping  | `artifacts/api-server/src/middlewares/*`                                                                                                                                                                                                                                      |
| Change the status-lookup UI             | `artifacts/order-status/src/pages/status.tsx`                                                                                                                                                                                                                                 |
| Change the order intake form            | `artifacts/order-status/src/pages/order-form.tsx`                                                                                                                                                                                                                             |
| Change the landing page                 | `artifacts/order-status/src/pages/home.tsx`                                                                                                                                                                                                                                   |
| Change the shop (live Notion inventory) | `artifacts/order-status/src/pages/shop.tsx` + `services/products.service.ts` + `lib/notion/products.*`                                                                                                                                                                        |
| Change the back-in-stock notify dialog  | `artifacts/order-status/src/components/notify-dialog.tsx` + `services/notify.service.ts` + `lib/notion/notify.*` (writes to the **contact** database — see below)                                                                                                             |
| Change shop checkout / payments         | `artifacts/order-status/src/lib/cart.tsx` + `components/cart-drawer.tsx` + `components/add-to-cart.tsx` (frontend); `api-server/src/services/checkout.service.ts` + `routes/checkout.ts` + `routes/stripe-webhook.ts` + `lib/stripe/*` + `lib/notion/shop-orders.*` (backend) |
| Change custom-order deposits            | `artifacts/order-status/src/pages/status.tsx` (`DepositSection`); `api-server/src/services/deposit.service.ts` + `routes/orders.ts` + `lib/notion/orders.repository.ts` (`findDepositTarget`/`markDepositPaid`) + `routes/stripe-webhook.ts`                                  |
| Add a page / route                      | new `src/pages/*.tsx` + `<Route>` in `src/App.tsx`                                                                                                                                                                                                                            |
| Add or rename a nav link                | `NAV_LINKS` in `artifacts/order-status/src/components/navbar.tsx`                                                                                                                                                                                                             |
| Add a shared UI component               | `artifacts/order-status/src/components/ui/`                                                                                                                                                                                                                                   |
| Add/change a shared test fixture        | `lib/test-fixtures/src/index.ts` (read its guardrail first)                                                                                                                                                                                                                   |
| Understand a past decision / gotcha     | `.agents/memory/`                                                                                                                                                                                                                                                             |
| Adjust the Vercel serverless entrypoint | `api/index.ts` + `vercel.json`                                                                                                                                                                                                                                                |

```

```
