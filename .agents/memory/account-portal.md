# Customer account portal (passwordless magic-link)

A signed-in home base gathering a customer's custom orders + shop orders in one
place, keyed by their email instead of an order-number-per-garment. It's an
**identity layer over the existing lookups**, not new order/invoice logic —
Phase-1 roadmap item #2.

## Why it's shaped this way

- **No user table, no session store.** Identity IS the email (the CRM already
  dedupes on it). The app has no relational DB and runs on serverless, so auth is
  **stateless signed tokens**, not server sessions:
  - `lib/auth/tokens.ts` — `base64url(payload).base64url(HMAC-SHA256)` signed with
    `SESSION_SECRET` (Node `crypto`, **no new dep**). Payload `{ email, purpose,
exp }`; purposes `magic` (15 min) / `session` (30 days). `verifyToken` never
    throws (bad sig / wrong purpose / expiry ⇒ null). Unset secret ⇒ portal inert.
  - `lib/auth/cookies.ts` — httpOnly `aa_session` cookie (`secure` outside dev,
    `sameSite:"lax"` so it survives the magic-link navigation). Set via Express's
    native `res.cookie`; read by hand-parsing the header (no `cookie-parser`).
  - `middlewares/auth.ts` `requireCustomer` → `res.locals.customer={email}` or
    `UnauthorizedError` (→ 401, added to `middlewares/error.ts`).
  - `custom-fetch.ts` now sends `credentials:"include"` (the intended web-app auth
    path — the bearer getter stays for the mobile bundle).
  - **Rate limiting** (`middlewares/rate-limit.ts`, `express-rate-limit`) on all
    four auth routes — the one justified new dep, because CodeQL's rate-limit query
    only recognises known limiter libraries (a hand-rolled one wouldn't clear the
    alert). Default in-memory store ⇒ per serverless instance/best-effort (same
    caveat as the alert de-dupe); brakes sign-in email-spam + token guessing.
  - `parseCookies` returns a **`Map`** (not a plain object) — the attacker-
    controlled cookie name is a Map key, so it can't pollute a prototype or clobber
    object properties. Fixes CodeQL remote-property-injection (a Set-based guard +
    null-proto object did **not** satisfy the query; a Map does).

- **Flow.** `POST /account/login` (contract) emails a magic link →
  `GET /api/account/verify?token=` (**outside the contract**, hand-mounted in
  `app.ts` like the Stripe webhook / cron buttons, because it's a browser
  navigation that sets a cookie + 302s to `/account`, not a JSON call) →
  `GET /account/overview` (contract, `requireCustomer`) → `POST /account/logout`.
  Login always 200s (identity is the email — nothing to enumerate). Invalid/expired
  verify → `/account/login?error=expired`.

- **New Notion reads: by email.** `findOrdersByEmail` (orders `Email` prop) and
  `findShopOrdersByEmail` (shop `Customer Email` prop), paginated, returning
  lightweight summaries; cards link out to the existing `/track` + `/invoice/:n`
  pages (no per-order milestone/invoice fan-out). **Caveat:** Notion email
  `equals` is case-exact, and orders predating the `Email`/`Customer Email`
  property are invisible — those are still trackable by number.

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

`SESSION_SECRET` (long random string) + `PUBLIC_BASE_URL` (already set for Stripe —
the magic-link origin) + the Resend vars for the sign-in email. **No new database.**
Magic-link copy: `lib/resend/emails.ts` `magicLinkEmail`, sent from the `orders`
sender.

For Phase 2, no new env var. Appointments reuse the existing Google Calendar
integration (`GOOGLE_SERVICE_ACCOUNT_KEY` + `APPOINTMENT_SHEET_ID`) — unset ⇒
appointments just don't appear. Measurements need five `number` properties (`Waist`,
`Chest`, `Hips`, `Height`, `Body Girth`) + a `Measurement Unit` `select`
(`inches`/`cm`) added to the Order Tracking Pipeline database (property-name
constants in `orders.schema.ts`); until added, new orders simply won't have
readable measurements.

## Files

Frontend: `pages/account-login.tsx`, `pages/account.tsx` (with `AppointmentCard` +
`MeasurementsBlock`), `components/appointment-manage-panel.tsx` (shared with
`pages/appointment-manage.tsx`), route in `App.tsx`, `Account` in `navbar.tsx`
`NAV_LINKS`, noindex entries in `lib/seo-routes.ts`.
Backend: `services/account.service.ts` (`upcomingAppointments`), `routes/account.ts`,
`routes/account-verify.ts`, `middlewares/auth.ts`, `lib/auth/*`,
`findOrdersByEmail` / `findShopOrdersByEmail` in the order/shop-order repos,
`extractMeasurements` + `OrderSummary` in `orders.schema.ts`,
`listUpcomingAppointmentsByEmail` in `lib/google/calendar.repository.ts`, the shared
`lib/appointments/event-details.ts`. Contract: three ops + `MagicLinkRequest` /
`AccountOverview` (now with `appointments`) / `AccountOrderSummary` (now with
`measurements`) / `AccountShopOrderSummary` / `AccountAppointmentSummary` /
`AccountMeasurements` / `MessageResponse` schemas in `lib/api-spec/openapi.yaml`.
