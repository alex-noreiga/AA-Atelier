# TODO

Deferred features surfaced by a missing-features review of the site. These are
real gaps that were consciously parked, not bugs. Each note points at where the
work would land so it's actionable later.

## Web analytics

No analytics is wired into the SPA (`web-app/package.json` has no
`@vercel/analytics`, GA, Plausible, or PostHog), so there's no visibility into
the order-intake and shop-checkout funnels.

- **Where:** `artifacts/web-app` — add `@vercel/analytics` and mount its
  component once in `src/App.tsx` (the app already deploys on Vercel).
- **Note:** if a tracking/analytics vendor is added, revisit whether a
  cookie-consent banner is needed.

## Newsletter / email capture

There's no mailing-list signup anywhere (the footer is the natural home for it;
`/api/notify` is back-in-stock-only).

- **Where:** a signup field in `src/components/footer.tsx`, posting to a new
  endpoint that writes to the Notion "Website Contact Messages" database — reuse
  the existing `/api/notify` writer pattern with a new **Request type**
  (see the three-writer contact-DB note in `CLAUDE.md`). Add the endpoint to
  `lib/api-spec/openapi.yaml` first, then regenerate the client/zod packages.

## Shop search / sort

The shop filters by category chips only — no free-text search and no sort
(price / name). Fine at the current catalog size; a gap as inventory grows.

- **Where:** frontend-only, `artifacts/web-app/src/pages/shop.tsx` (filter the
  already-fetched product list client-side).

---

**Intentionally excluded:** customer reviews/testimonials (in progress on
`feature/reviews` and `claude/customer-reviews-display-*`) and a bespoke-work
portfolio/lookbook (parked pending more photography).
