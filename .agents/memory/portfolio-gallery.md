---
name: Portfolio & finished-work gallery
description: /portfolio reads the atelier's existing "Design Portfolio & Sketch Library" Notion database behind a fail-closed "Show on website" checkbox; the filter DIMENSIONS are code and the OPTIONS are derived live from the published rows, which is why the gallery works today with only Type and gains chips as the atelier fills properties in.
---

# Portfolio & finished-work gallery

Roadmap card ②, shipped on `feature/portfolio-gallery` (August 2026). The card
asked for "a curated showcase of completed costumes, filterable by discipline,
colorway, or competition, read from the Design Portfolio and Sketch Library the
atelier already keeps rather than assembled from nothing."

## What the database actually held

Worth writing down, because the card's wording implies more than exists. The
database (`🎨 Design Portfolio & Sketch Library`, under the `sketches & designs`
page) is a **single** database — not the two the card's phrasing suggests — with
**four** properties:

| Property                 | Type                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `Name`                   | title                                                                |
| `Image / Sketch`         | files                                                                |
| `Type`                   | select — `Completed Dress` / `Preliminary Sketch` / `Digital Mockup` |
| `Order Form Submissions` | relation → the orders database                                       |

There is **no** discipline, colorway, or competition property, and at build time
it held four rows — three preliminary sketches with images, one empty row, and
**zero** `Completed Dress`. So "filterable by discipline, colorway, or
competition" described data that did not exist yet.

The design answer was to make the filters **derived rather than declared**, so
the gallery is correct on day one with only `Type` and grows chips as the atelier
fills the other properties in. Nothing about that needs a deploy.

## Decisions worth not re-litigating

- **One publish gate, `Show on website`, failing closed.** Named to match the
  shop inventory's identical checkbox. Deliberately _not_ the reviews' two-gate
  (curated + customer-consented) model: a testimonial is the customer's words,
  while these are photographs of the atelier's own work. A row with **no image**
  is also unpublished, so the grid can never render a hole.
- **Facet dimensions in code, options read live.** `FACET_DEFINITIONS` in
  `portfolio.schema.ts` — a targeted business rule, because the UI has to mirror
  it. A dimension is offered only when the published work carries **two or more**
  distinct values for it; a chip that filters nothing is worse than no chip.
- **A facet property may be select, multi_select, or rich_text.** Three of the
  four properties don't exist yet, so the atelier picks their types. A reader
  insisting on `multi_select` would answer a `select` named `Discipline` with
  silence. Documented tolerance, not sloppiness — see CLAUDE.md.
- **Scan, don't filter.** A Notion `filter` naming a property the database lacks
  answers **400**. Pushing `Show on website` into the query would have made the
  gallery fail loudly until the atelier added the column. The gate is applied in
  the pure extractor, where a missing property reads as `false`.
- **404 degrades to an empty gallery and is NOT cached.** Same "a state only a
  human can clear" shape as the materials panel's unreachable database, but the
  empty result is left uncached so sharing the database takes effect at once
  rather than a minute later. Any other status still throws.
- **The edge cache is capped by Notion's signed image URLs** (~1h). 120s +
  600s SWR, the same numbers as `/products`; an integration test asserts the
  total stays under an hour.
- **`Competition` is a plain property, not a relation.** The `🏆 Competitions`
  database is the _marketing calendar_ (`Active`, `Push starts`, `Lead time
(weeks)`, `Season`) that roadmap card ③ (seasonal capacity & waitlist) will
  read. Relating a portfolio filter chip to a scheduling tool would couple two
  unrelated features and cost a second database share for a string.

## Atelier setup

Required: share the Notion integration with the database, set
**`NOTION_PORTFOLIO_DATABASE_ID`**, and add a **`Show on website`** checkbox —
until that property exists, every row reads as unpublished and the gallery is
empty by design.

Optional and additive, each unlocking a chip row once two published pieces
differ along it: **`Discipline`** (multi_select), **`Colorway`** (multi_select),
**`Competition`** (select).

Also worth doing once pieces are live: set the repo variable
**`SMOKE_EXPECT_PORTFOLIO=1`**, which stops `portfolio.smoke.ts` accepting an
empty gallery. Until then a 200 with `pieces: []` is genuinely ambiguous between
"nothing published" and "the read is broken" — the same gate, for the same
reason, as `SMOKE_EXPECT_REVIEWS`.

## Known limits

- One flat list: no pagination and no per-piece page, so a piece can't be deep
  linked or shared the way `/shop/:productId` can. Fine at sketchbook scale;
  revisit past a few hundred rows.
- The `Order Form Submissions` relation is read by nothing. Surfacing "made for
  a skater competing at X" would need the customer's consent, which is a
  different feature from the atelier publishing its own photographs.
- Images are Notion-hosted, so they inherit that dependency (and the roadmap's
  "object storage for order images & photos" card would move them).
