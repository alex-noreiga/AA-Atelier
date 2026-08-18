# Customer account portal (Supabase Auth)

A signed-in home base gathering a customer's custom orders + shop orders in one
place, keyed by their email instead of an order-number-per-garment. It's an
**identity layer over the existing lookups**, not new order/invoice logic —
Phase-1 roadmap item #2.

## Phase 3 — auth on Supabase (shipped; the "Supabase accounts" card, auth half)

The original passwordless-magic-link auth (stateless HMAC `SESSION_SECRET`
tokens + an httpOnly `aa_session` cookie) was **replaced by Supabase Auth** —
the customer-facing half of the Phase-3 "Supabase: accounts + a real database"
card. Notion + Google Calendar stay the system of record, still matched by
**email**. This is an authentication-vendor swap, not new order/invoice logic.

The **"real database" half shipped narrowly**: a small optional Postgres
integrity layer (same Supabase project) now backs **Stripe payment idempotency**
(`processed_payments`) — see `postgres-integrity-layer.md`. The broader
**data migration is still deferred**: the `clients` / `order_index` tables are
provisioned in the migration but not yet wired, so the account overview still
reads orders live from Notion by email (`findOrdersByEmail`).

- **Sign-in methods:** email+password (Supabase-managed hashing + email
  verification + forgot-password), Google OAuth, and passwordless magic link —
  all Supabase-native. The frontend calls supabase-js directly
  (`signInWithPassword` / `signUp` / `signInWithOtp` / `signInWithOAuth` /
  `resetPasswordForEmail` / `updateUser`); there is **no** server login/verify/
  logout route anymore.
- **Web session transport = Bearer, not cookie.** supabase-js holds the session
  in the browser (localStorage, auto-refreshed) and the generated API client
  sends the access token via the **existing `setAuthTokenGetter` seam** in
  `custom-fetch.ts` (was reserved for mobile). Tradeoff: the token is now
  JS-readable (XSS-exposed) vs the old httpOnly cookie — accepted for the
  standard Bearer model.
- **Server verifies the JWT locally.** `middlewares/auth.ts` `requireCustomer`
  reads the Bearer token and verifies it with `getSupabaseClient().auth
.getClaims(token)` (cached JWKS, no per-request round-trip; supports the ES256
  asymmetric keys new projects default to). It sets `res.locals.customer =
{ email: normalizeEmail(claims.email), userId: claims.sub }` — **normalizing
  at the gate** so Notion lookups match. Adapter: `lib/supabase/client.ts`
  (factory + memoized getter + `supabaseConfigured()`, first-use env read, test
  seams `__setSupabaseClientForTests` / `__resetSupabaseClient`).
- **`SESSION_SECRET` is NOT retired.** `lib/auth/tokens.ts` still signs/verifies
  the **`appointment`**-purpose manage-link token (the only remaining purpose;
  `magic`/`session` are gone). `lib/auth/cookies.ts` and `routes/account-verify.ts`
  were deleted; `magicLinkEmail` was removed (Supabase sends branded auth mail via
  **custom SMTP = Resend**, configured in the dashboard, not code).
- **Contract:** `/account/login` + `/account/logout` ops and `MagicLinkRequest`
  were removed from `openapi.yaml`; `/account/overview` gained a `bearerAuth`
  security scheme. Only `getAccountOverview` survives (unchanged — still
  email-keyed). Frontend: `lib/supabase.ts` (browser client), `lib/auth-context.tsx`
  (`AuthProvider` + `useAuth`, wires the token getter once), `pages/account-login.tsx`
  (tabbed sign-in/create + Google + magic-link + forgot), `pages/account-callback.tsx`
  (OAuth/magic-link redirect target), `pages/account-reset.tsx` (password reset).
- **New env:** `SUPABASE_URL` + `SUPABASE_ANON_KEY` (backend) and
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (frontend). Unset ⇒ portal
  inert (login shows "unavailable", overview 401s), same degrade pattern as
  before. One-time Supabase setup: create the project, enable Email+password
  (confirm-email) + Magic Link + Google, custom SMTP = Resend, Site URL +
  redirect allow-list (`${PUBLIC_BASE_URL}/account/callback`, `/account/reset`).

## Why it's shaped this way

- **No user table, no session store.** Identity IS the email (the CRM already
  dedupes on it); Supabase owns the credential store (`auth.users`), the app
  persists no user record. `requireCustomer` (`middlewares/auth.ts`) verifies the
  Bearer JWT with `auth.getClaims` and **normalizes the email at the gate**
  (`normalizeEmail`) so the Notion lookups key on the same canonical form.
- **The web session is a Bearer JWT, not a cookie.** supabase-js holds the session
  in browser localStorage (auto-refreshed) and the generated client attaches the
  access token via the `setAuthTokenGetter` seam in `custom-fetch.ts`. Tradeoff vs
  the deleted httpOnly cookie: the token is JS-readable (XSS-exposed) — accepted for
  the standard Bearer model.
- **Notion reads: by email.** `findOrdersByEmail` (orders `Email` prop) and
  `findShopOrdersByEmail` (shop `Customer Email` prop), paginated, returning
  lightweight summaries; cards link out to the existing `/track` + `/invoice/:n`
  pages (no per-order milestone/invoice fan-out). **Caveat:** Notion email
  `equals` is case-exact (hence the gate-side `normalizeEmail`), and orders
  predating the `Email`/`Customer Email` property are invisible — those are still
  trackable by number.

### History (the deleted magic-link design)

Before Supabase, auth was **hand-rolled stateless HMAC tokens**: `lib/auth/tokens.ts`
signed a `magic` (15 min) and `session` (30 day) token with `SESSION_SECRET`, the
session rode in an httpOnly `aa_session` cookie (`lib/auth/cookies.ts`, `parseCookies`
returning a `Map` to dodge CodeQL prototype-pollution), and the flow was
`POST /account/login` → `GET /api/account/verify` (hand-mounted, set-cookie + 302) →
`POST /account/logout`, all four routes rate-limited. **All of that is gone**:
`cookies.ts`, `routes/account-verify.ts`, `magicLinkEmail`, the `magic`/`session`
token purposes, and the login/logout/verify ops were deleted. Only `SESSION_SECRET`
(now appointment-token-only), `findOrdersByEmail`/`findShopOrdersByEmail`, and the
`accountRateLimiter` (now on `/account/overview` alone) survive.

## Scope and follow-ons

Shipped (v1): orders + shop orders + invoices (invoices ride the order detail
pages).

**Phase 2 — appointments + measurements (shipped).** Both deferred fast-follows
now land in the overview:

- **Upcoming appointments.** `getAccountOverview` also runs
  `listUpcomingAppointmentsByEmail` (`lib/google/calendar.repository.ts`): one
  `events.list` per staff calendar (from `getStaffSchedule().calendars`,
  impersonated) filtered by the **`aptEmail` private extended property** stamped on
  every booking — the read-by-customer path that didn't exist before (there's still
  no appointments DB; the calendar event is the record). The event→DTO mapping is
  the shared `lib/appointments/event-details.ts` (`eventToDetailsOrNull` /
  `mapEventToDetails`), reused by the manage service so the two can't drift. Each
  summary carries a freshly-signed **`manageToken`** (the same `appointment`-purpose
  token the confirmation email uses), so the portal's inline reschedule/cancel drive
  the **existing** `/appointments/reschedule|cancel` endpoints — **no new mutation
  routes**. The frontend controls are the shared
  `components/appointment-manage-panel.tsx`, mounted by both `pages/appointment-manage.tsx`
  and the portal's `AppointmentCard`; a reschedule/cancel invalidates the overview
  query to refresh in place. **Best-effort:** any calendar failure (unconfigured,
  outage) degrades to `appointments: []` and never fails the orders view. **Caveat:**
  bookings made before the `aptEmail` stamp existed won't list.
- **Measurement history (display-only).** Resolved the `TODO(measurements-b)`
  migration: measurements are now written as typed Notion **properties** (five
  `number`s + a `Measurement Unit` select) in `buildOrderProperties`, ALSO kept as
  the page-body blocks for the atelier's view (both from the one intake payload, so
  no drift). `extractMeasurements` (`orders.schema.ts`) reads them back into
  `OrderSummary.measurements`, surfaced on `AccountOrderSummary.measurements` and
  rendered read-only under each custom order (`MeasurementsBlock`). Editing still
  goes through the measurement-change request (Approach A). **Caveat:** only orders
  placed **after** the migration have readable measurements — earlier orders' values
  remain only in the (unread) body blocks, so they show none.

**Still deferred:** in-place measurement _editing_ (Approach B PATCH), and any
appointment history beyond the upcoming window.

## One-time setup

Create a Supabase project; set `SUPABASE_URL` + `SUPABASE_ANON_KEY` (backend) and
`VITE_PUBLIC_SUPABASE_URL` + `VITE_PUBLIC_SUPABASE_ANON_KEY` (frontend) — on Vercel
these come from the Supabase integration. In the Supabase Auth dashboard: enable
Email+password (confirm-email) + Magic Link + Google, point custom SMTP at Resend
(it sends the branded auth mail — copy in `supabase-auth-emails.md`), and add
`${PUBLIC_BASE_URL}/account/callback` + `/account/reset` to the redirect allow-list.
`SESSION_SECRET` + `PUBLIC_BASE_URL` are still needed (now only for the appointment
manage-link). **No database of our own for the portal** — it reads the customer's
existing Notion orders by email.

For Phase 2, no new env var. Appointments reuse the existing Google Calendar
integration (`GOOGLE_SERVICE_ACCOUNT_KEY` + `APPOINTMENT_SHEET_ID`) — unset ⇒
appointments just don't appear. Measurements need five `number` properties (`Waist`,
`Chest`, `Hips`, `Height`, `Body Girth`) + a `Measurement Unit` `select`
(`inches`/`cm`) added to the Order Tracking Pipeline database (property-name
constants in `orders.schema.ts`); until added, new orders simply won't have
readable measurements.

## Files

Frontend: `pages/account-login.tsx` (tabbed sign-in/create + Google + magic-link +
forgot), `pages/account-callback.tsx` (OAuth/magic-link redirect landing),
`pages/account-reset.tsx` (password reset), `pages/account.tsx` (with
`AppointmentCard` + `MeasurementsBlock`), `lib/supabase.ts` (browser client),
`lib/auth-context.tsx` (`AuthProvider`/`useAuth`, wires the Bearer token getter
once), `components/appointment-manage-panel.tsx` (shared with
`pages/appointment-manage.tsx`), route in `App.tsx`, `Account` in `navbar.tsx`
`NAV_LINKS`, noindex entries in `lib/seo-routes.ts`.
Backend: `services/account.service.ts` (`getAccountOverview` + `upcomingAppointments`),
`routes/account.ts` (only `GET /account/overview` now), `middlewares/auth.ts`
(`requireCustomer` verifies the Supabase JWT), `lib/supabase/client.ts`,
`lib/auth/tokens.ts` (appointment purpose only), `findOrdersByEmail` /
`findShopOrdersByEmail` in the order/shop-order repos, `extractMeasurements` +
`OrderSummary` in `orders.schema.ts`, `listUpcomingAppointmentsByEmail` in
`lib/google/calendar.repository.ts`, the shared `lib/appointments/event-details.ts`.
Contract: one op (`getAccountOverview`, `bearerAuth`) + `AccountOverview` (email +
`customOrders` + `shopOrders` + `appointments` + optional `referral`) /
`AccountOrderSummary` (with `measurements`) / `AccountShopOrderSummary` /
`AccountAppointmentSummary` / `AccountMeasurements` / `AccountReferral` schemas in
`lib/api-spec/openapi.yaml` (`MagicLinkRequest` + the login/logout ops removed).
