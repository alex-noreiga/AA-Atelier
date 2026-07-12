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
`pnpm-workspace.yaml`: `artifacts/*`, `lib/*`, `scripts`, `tests`. Every
workspace package is named `@workspace/<name>`.

```
artifacts/
  order-status/      Frontend SPA (Vite + React 19 + Tailwind v4 + shadcn/ui)
    src/App.tsx      wouter routes + a global <Navbar />
    src/pages/       one component per route (home landing, status, order-form,
                     services, about, shop, contact, not-found)
    src/components/  navbar.tsx (global nav), page-shell.tsx (page wrapper),
                     ui/ (shadcn primitives)
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
scripts/             One-off tsx scripts + post-merge git hook
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
  │
  ├─ GET  /api/healthz             → { status: "ok" }
  ├─ GET  /api/orders/:orderNumber → order status + stage list
  ├─ POST /api/orders              → creates a Notion page, returns order number
  ├─ POST /api/contact             → saves a contact message to the Notion
  │                                  "Website Contact Messages" database
  └─ GET  /api/products            → shop inventory (published in-stock items)
                                     from the Notion "inventory" database
```

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

2. **Never hardcode the stage/status option list.** The atelier team edits the
   "Stage" status options directly in Notion and expects changes to appear
   without a redeploy. `fetchLiveOrderStages()` (in `notion/orders.repository.ts`)
   reads the options live from `GET /v1/databases/{id}` with a 60s in-memory TTL
   cache, and falls back to the cached list on error. Don't reintroduce a
   hardcoded stage constant. (The per-stage *description text* in
   `lib/stage-descriptions.ts` is cosmetic flavor only.)

Auth: the server reads `NOTION_API_KEY` and `NOTION_ORDERS_DATABASE_ID` from
environment variables (via `createNotionClient` in `notion/client.ts`, read at
first use rather than module load). On Replit these came from a sidecar; that
path is gone.

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

**Backend unit / integration (Vitest).** The `@workspace/api-server` suite in
`artifacts/api-server/test/` — pure-function tests for the Notion schema mapping
and block builders, repository tests driving the **injected** `NotionClient` with
a fake (`test/support/fake-notion.ts`), service-logic tests, and supertest route
tests over the real Express stack with the Notion repository mocked. No server,
no network, no Notion. A vitest-config plugin maps the source's `.js` import
specifiers to the on-disk `.ts` files so tests run with no build step.

**Frontend component (Vitest + Testing Library).** The `@workspace/order-status`
suite in `artifacts/order-status/test/` (jsdom) — the status-timeline
completed/active/future logic and render states (the generated react-query hook
is mocked to drive each state), and the order-form validation + submit-payload
mapping (asserting empty optional fields are omitted). `pnpm test` runs both
Vitest suites; each package also has its own `test` / `test:watch`.

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
  package. (An empty `lib/db` scaffold used to exist but was removed.)

## Git & deployment

- Default branch: **`main`**. Feature work happens on branches; changes reach
  `main` via pull requests.
- Do **not** open a pull request unless explicitly asked.
- Vercel deploys from the repo using `vercel.json`:
  `installCommand: pnpm install`, `buildCommand: pnpm run build:vercel`,
  output `artifacts/order-status/dist/public`.
- **Required Vercel env vars:** `NOTION_API_KEY`, `NOTION_ORDERS_DATABASE_ID`,
  `NOTION_CONTACT_DATABASE_ID` (the "Website Contact Messages" database that the
  `/contact` form writes to), and `NOTION_INVENTORY_DATABASE_ID` (the finished-
  goods "inventory" database the shop's `/products` endpoint reads). The Notion
  integration must be shared with each database or queries 404.

## Quick reference — where things live

| I want to…                              | Go to                                                     |
|-----------------------------------------|-----------------------------------------------------------|
| Change an API request/response shape    | `lib/api-spec/openapi.yaml` → run codegen                 |
| Change order use-case logic             | `artifacts/api-server/src/services/orders.service.ts`     |
| Change Notion I/O                       | `artifacts/api-server/src/lib/notion/*`                   |
| Add/modify an API route                 | `artifacts/api-server/src/routes/*`                       |
| Add request validation / error mapping  | `artifacts/api-server/src/middlewares/*`                  |
| Change the status-lookup UI             | `artifacts/order-status/src/pages/status.tsx`             |
| Change the order intake form            | `artifacts/order-status/src/pages/order-form.tsx`         |
| Change the landing page                 | `artifacts/order-status/src/pages/home.tsx`               |
| Change the shop (live Notion inventory) | `artifacts/order-status/src/pages/shop.tsx` + `services/products.service.ts` + `lib/notion/products.*` |
| Add a page / route                      | new `src/pages/*.tsx` + `<Route>` in `src/App.tsx`        |
| Add or rename a nav link                | `NAV_LINKS` in `artifacts/order-status/src/components/navbar.tsx` |
| Add a shared UI component               | `artifacts/order-status/src/components/ui/`               |
| Understand a past decision / gotcha     | `.agents/memory/`                                         |
| Adjust the Vercel serverless entrypoint | `api/index.ts` + `vercel.json`                            |
```
