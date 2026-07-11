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
