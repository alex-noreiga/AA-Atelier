# TODO

Deferred features surfaced by a missing-features review of the site. These are
real gaps that were consciously parked, not bugs. Each note points at where the
work would land so it's actionable later.

## Shop search / sort

The shop filters by category chips only — no free-text search and no sort
(price / name). Fine at the current catalog size; a gap as inventory grows.

- **Where:** frontend-only, `artifacts/web-app/src/pages/shop.tsx` (filter the
  already-fetched product list client-side).

---

**Intentionally excluded:** a bespoke-work portfolio/lookbook (parked pending
more photography).
