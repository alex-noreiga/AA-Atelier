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
- `RESEND_FROM_EMAIL` — the verified sender, e.g. `AA-Atelier <orders@yourdomain>`
- `ATELIER_INBOX_EMAIL` — _optional_; the atelier's own inbox for internal
  new-submission notifications. Unset = skip them.

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

**Deliberately not migrated:** order status/stage-change emails and the actual
restock alert — both need a Notion→app trigger (webhook or cron) that doesn't
exist yet.

**Ops prerequisites:** verify the sending domain in Resend (SPF/DKIM DNS) before
`RESEND_FROM_EMAIL` will deliver, and once the website sends reliably, **turn off
the corresponding Notion automations** so customers don't get duplicate emails.
