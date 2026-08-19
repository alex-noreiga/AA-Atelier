# Reviews curation — saved views + the "On the Website" formula

Companion to shipping `GET /api/reviews` (the testimonial strip on the home and
about pages). The app decides what is public; this note records the **Notion
side** the atelier uses to sift reviews and pick which ones show.

Live ids (this workspace):

- **Reviews** database `6d90c1d3-89f5-4ec8-9eb4-c73ababdccca`,
  data source `collection://4e8a7e79-e556-4f78-b511-3fa246712294`
  (lives under **{ A.A. Atelier } → orders**)

## A second "Reviews" database used to exist — deleted 2026-08-19

There were **two**. A stale **`⭐ Reviews`** database sat inline under
**{ A.A. Atelier } → website** (`83e71f14-f33f-489a-a4b7-f5c921d35a6b`,
data source `collection://6a859f4a-5960-4da9-a2ee-59d9ba46415a`) — an abandoned
earlier design with a different schema (a `Published` **checkbox** rather than a
`Status` select, plus `Verified` and a `Name` title) that **nothing in the app ever
read or wrote**. Curating there (ticking `Published`) did nothing to the website,
and nothing surfaced that it was inert.

**It was moved to Notion's trash on 2026-08-19**, at the atelier's request, after
confirming it held **0 rows** and that its id appeared nowhere in the repo. It is
recoverable from Notion's trash for ~30 days; after that it is gone. Because it was
an _inline_ database on the `website` page, that page lost the embedded block.

Why this is recorded rather than dropped: if a `⭐ Reviews` database reappears under
`website` — restored from trash, or recreated from an old template — it is **not**
the app's database and curating in it will silently do nothing. The live one is
`orders → Reviews` above, and `NOTION_REVIEWS_DATABASE_ID` points at it. Check the
id before configuring anything named "Reviews".

## What makes a review public (unchanged by this note)

Both gates, ANDed, in `reviews.schema.ts` / `listPublishedReviews`:

1. `Status` **select** = `"Published"` (`REVIEW_STATUS_PUBLISHED`), and
2. `Consent to Publish` **checkbox** ticked.

`Status` has a third option, **`Archived`** (gray), that predates the app. It is
not `"Published"`, so an archived review is simply not public — no code change was
needed for it, and it doubles as the "retire a testimonial" move.

`Email Verified` is deliberately **not** a gate — see CLAUDE.md for why.

## Added: an "On the Website" formula (nothing in the app reads it)

A formula property mirroring the app's rule, so a row says why it is or isn't
live instead of the atelier having to remember the two-gate rule:

```
if(and(format(prop("Status")) == "Published", prop("Consent to Publish")),
   "✅ Live on the site",
   if(format(prop("Status")) == "Published", "⛔ No consent — hidden",
      if(format(prop("Status")) == "New", "◽ Awaiting curation",
         "◽ Not published")))
```

`format(prop("Status"))` rather than a bare compare: a select in a formula isn't a
string, and `format()` is what reliably coerces it (same lesson as the rollup
gotcha in `phase2-workspace-cards.md`).

**It is a mirror, not the source.** Rename the `"Published"` option and you must
change `REVIEW_STATUS_PUBLISHED` **and** this formula, or they disagree — the code
wins and the formula lies.

## Added: five views (the "All reviews" default was the only one)

| View                          | Type  | Filter                                   |
| ----------------------------- | ----- | ---------------------------------------- |
| **All reviews** (was Default) | table | none — every row, `On the Website` first |
| **Curate**                    | board | none, grouped by `Status`                |
| **Live on the site**          | table | `Status` = Published AND consent = TRUE  |
| **Awaiting curation**         | table | `Status` = New                           |
| **Published but not showing** | table | `Status` = Published AND consent = FALSE |

- **Curate** is the selection surface: drag a card from **New** to **Published**
  to put it on the site. That drag is the whole "select which ones show up" action.
- **Live on the site** is the app's filter exactly, so it answers "what is on the
  website right now" without loading the site.
- **Published but not showing** exists because that state is otherwise **silent**:
  the atelier publishes a review, the customer never consented, nothing appears,
  and no error is raised anywhere. This view is the only place that surfaces it.
- All are sorted by `Rating` DESC. Sorting by created time was avoided — the
  built-in timestamp isn't a named property in the DSL, and rating is the more
  useful sift anyway. **The site's own order is newest-first regardless**
  (`sorts: created_time descending` in `listPublishedReviews`); the view sort is
  for the atelier only and does not influence the website.

## Ordering and count are deliberately NOT atelier-editable

Asked for and declined: a display-order field and a Notion-editable count. The
strip takes the newest 3 (`TESTIMONIAL_LIMIT` in `components/testimonials.tsx`,
API default 12). Adding either means a new property plus a read path, so it is a
real change, not a view.

## Propagation delay

A curation change reaches the site through two caches: the repository's 60s TTL
and the route's edge `Cache-Control` (`s-maxage=300, stale-while-revalidate=900`).
Worst case is a few minutes. That is expected, not a bug.

## State at time of writing

The Reviews database is **empty** — no customer has left a review yet, so the
testimonial strip renders nothing on both pages. First review requires a custom
order at its final (delivered) stage. The workspace now has exactly **one**
database named "Reviews" (plus an unrelated "Monthly Reviews").
