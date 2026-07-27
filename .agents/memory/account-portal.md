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

## Scope (v1) and deferred

Shipped: orders + shop orders + invoices (invoices ride the order detail pages).
**Deferred** (each a fast-follow, not free):

- **Appointments** — no read-by-customer path today (Google Calendar is write +
  free/busy only; needs a net-new `events.list`-by-attendee, or mirroring bookings
  to Notion at booking time).
- **Measurement history** — measurements live in the order page's **body blocks**,
  not readable properties. The `TODO(measurements-b)` migration (five `number`
  props + a unit `select` on the order) is the prerequisite; once done, they're
  readable/PATCHable and can be shown/edited in the portal.

## One-time setup

`SESSION_SECRET` (long random string) + `PUBLIC_BASE_URL` (already set for Stripe —
the magic-link origin) + the Resend vars for the sign-in email. **No new database.**
Magic-link copy: `lib/resend/emails.ts` `magicLinkEmail`, sent from the `orders`
sender.

## Files

Frontend: `pages/account-login.tsx`, `pages/account.tsx`, route in `App.tsx`,
`Account` in `navbar.tsx` `NAV_LINKS`, noindex entries in `lib/seo-routes.ts`.
Backend: `services/account.service.ts`, `routes/account.ts`,
`routes/account-verify.ts`, `middlewares/auth.ts`, `lib/auth/*`,
`findOrdersByEmail` / `findShopOrdersByEmail` in the order/shop-order repos,
`OrderSummary` in `orders.schema.ts`. Contract: three ops + `MagicLinkRequest` /
`AccountOverview` / `AccountOrderSummary` / `AccountShopOrderSummary` /
`MessageResponse` schemas in `lib/api-spec/openapi.yaml`.
