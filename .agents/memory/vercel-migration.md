---
name: Vercel migration decisions
description: Key decisions made when migrating this project from Replit deployment to Vercel.
---

## Architecture

- Frontend (`artifacts/order-status`): Vite static build → `artifacts/order-status/dist/public`
- API (`artifacts/api-server`): Express app wrapped in `api/index.ts` at the repo root, deployed as a Vercel serverless function
- Routing: `vercel.json` rewrites `/api/:path*` → `/api/index`
- Build command: `pnpm run build:vercel` (builds only the frontend; Vercel bundles the serverless function itself)

## Notion auth change

**Why:** Replit provided Notion credentials through `@replit/connectors-sdk` (a sidecar proxy at `http://127.0.0.1:1106`). This sidecar doesn't exist outside Replit.

**How to apply:** On Vercel (and any non-Replit environment), set `NOTION_API_KEY` as an environment variable. The `notionFetch()` helper in `artifacts/api-server/src/lib/notion.ts` reads it directly.

## Image upload removed

Object storage (GCS) also used the Replit sidecar for credentials and signed URLs. Since that sidecar is gone, all image upload code was removed: `objectStorage.ts`, `objectAcl.ts`, `storage.ts` routes, and the image upload UI in `order-form.tsx`.

## Required env vars on Vercel

- `NOTION_API_KEY` — from https://www.notion.so/my-integrations
- `NOTION_ORDERS_DATABASE_ID` — the Notion DB ID (was `72ab2818-7cc8-4479-a685-41ebc4c368e8`)
- `NOTION_CONTACT_DATABASE_ID` — the "Website Contact Messages" DB the `/contact` form writes to
- `NOTION_INVENTORY_DATABASE_ID` — the finished-goods "inventory" DB the shop's `/products` endpoint reads
- `RESEND_API_KEY` — from https://resend.com/api-keys (customer notification emails)
- `RESEND_FROM_EMAIL` — the verified sender, e.g. `A.A Atelier <orders@a3iceanddance.com>`
- `ATELIER_INBOX_EMAIL` — _optional_; the atelier's own inbox for internal
  new-submission notifications. Unset = skip them.
- `RESEND_CONTACT_FROM_EMAIL` / `ATELIER_CONTACT_INBOX_EMAIL` — _optional_;
  per-function overrides for **contact-form** mail (sender + notification inbox).
  Each falls back to the base `RESEND_FROM_EMAIL` / `ATELIER_INBOX_EMAIL`.

The Notion integration must be shared with each of these databases (Notion → database → ••• → Connections) or queries return 404.

## Notification emails moved from Notion to the website (Resend)

**Why:** Customer emails used to be sent by Notion automations. The website now
owns them so the atelier can use its own domain, branding, and the site's voice.

**What the app sends** (all send-on-write, in `artifacts/api-server/src/lib/resend/`):

- **Order confirmation** — on `POST /orders`
- **Contact acknowledgement** — on `POST /contact`
- **Back-in-stock request confirmation** — on `POST /notify` (the "we'll tell you
  when it's back" receipt, **not** the restock alert)

Each is a **best-effort** side effect fired after the Notion write via
`sendEmailBestEffort`: a Resend failure is logged and swallowed and never changes
the request's HTTP status (the Notion write stays the source of truth). The
Resend client mirrors the Notion client's lazy env-at-first-use pattern.

**Internal atelier notifications.** In addition to the customer email, each of the
three flows sends an internal notification to `ATELIER_INBOX_EMAIL` (with
**Reply-To** the customer) — but only when that env var is set; unset skips it and
only the customer email goes out. The contact form was intentionally never an
atelier-notification-by-email before this: contact messages land in the Notion
"Website Contact Messages" database and the customer gets an acknowledgement, so if
someone reports "contact messages aren't emailing me," the answer is either read
them in Notion or set `ATELIER_INBOX_EMAIL`. The atelier-facing builders live
alongside the customer ones in `lib/resend/emails.ts` and HTML-escape free-text
customer fields.

**Per-function sender addresses.** Emails are grouped into two categories in
`lib/resend/config.ts` — **orders** (order + back-in-stock) and **contact** — each
resolving a sender (`fromAddress`) and notification inbox (`atelierInbox`) from env.
The contact overrides (`RESEND_CONTACT_FROM_EMAIL` / `ATELIER_CONTACT_INBOX_EMAIL`)
fall back to the base `RESEND_FROM_EMAIL` / `ATELIER_INBOX_EMAIL`, so unset ⇒ the
old single-address behavior. Builders stay content-only; the service spreads the
category `from` onto the message and the client honors a per-message `from` over its
base. Adding a second sender needs no new Resend/DNS setup (same verified domain) —
only a mailbox/alias to _receive_ at the new address.

**Deliberately not migrated:** order status/stage-change emails and the actual
restock alert — both need a Notion→app trigger (webhook or cron) that doesn't
exist yet.

**Ops prerequisites:** verify the sending domain in Resend (SPF/DKIM DNS) before
`RESEND_FROM_EMAIL` will deliver, and once the website sends reliably, **turn off
the corresponding Notion automations** so customers don't get duplicate emails.

**Troubleshooting — "order/contact emails aren't arriving" (customer receipt or
atelier notification):** the send is best-effort and swallowed, so the Notion
write still succeeds while no mail goes out. It's almost always config, not code.
Check, in order:

1. **Vercel env (Production):** `RESEND_API_KEY` and `RESEND_FROM_EMAIL` must be
   set. `RESEND_FROM_EMAIL` must be a verified-domain sender, e.g.
   `A.A Atelier <orders@a3iceanddance.com>`. For the internal atelier
   notification, `ATELIER_INBOX_EMAIL` must also be set (unset ⇒ only the
   customer email goes out, by design). **Redeploy after changing env vars.**
2. **Resend domain:** the sending domain must be **verified** (SPF/DKIM) or every
   send is rejected (403/422).
3. **Vercel runtime logs:** `sendEmailBestEffort` now logs failures at `error`
   with a distinct, actionable message — "mailer is not configured …" (missing
   env var) vs. "Resend rejected the request" (includes the HTTP status + Resend
   response body). Grep the function logs for `Email NOT sent` / `Email send
   failed`.

Gate detail: `sendEmail` requires an API key **and** a resolved sender
(`message.from || client.baseFrom`), so a per-category override
(`RESEND_CONTACT_FROM_EMAIL`) can send even when the base `RESEND_FROM_EMAIL` is
unset — but the **orders** category always uses the base var, so orders mail
needs `RESEND_FROM_EMAIL` set.
