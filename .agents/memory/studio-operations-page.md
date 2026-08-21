# Studio Operations — the Notion home page of linked views

Roadmap card ① ("A studio operations home page"): _one Notion page of linked views
covering orders due, overdue milestones, new reviews, and open requests._ Notion
configuration only — **no code changed, no database changed, no new property, no
new env var**. Recorded here because the page is invisible from the repo and its
filters name live Notion option values that a rename would silently break.

Live ids (this workspace):

- **🧭 Studio Operations** page `3c3da6fa-c638-815e-94d5-f7c028d8672f`, a child of
  **{ A.A. Atelier }** (`359da6fa-c638-807a-b499-fb3bfb2bbe83`) and the **first
  entry in that page's 📌 Navigation callout**.

Sources (all pre-existing, all untouched):

| Section                     | Database                 | Data source                                         |
| --------------------------- | ------------------------ | --------------------------------------------------- |
| 1 · Orders due              | Custom Orders            | `collection://944a7e5a-b47f-40e4-87d2-f4743f08428f` |
| 2 · Milestones running late | Production Schedule      | `collection://1cf6166a-e1bc-4e36-8417-d6db98d5501e` |
| 3 · New reviews             | Reviews                  | `collection://4e8a7e79-e556-4f78-b511-3fa246712294` |
| 4 · Open requests           | Website Contact Messages | `collection://39ada6fa-c638-80f9-9a6c-000b86972989` |

## The four views

| View                          | Filter                                                         | Sort                           |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------ |
| **Orders due**                | `Archived` false AND `Cancelled` false AND `Stage` ≠ Delivered | `Due Date` ASC                 |
| **Milestones by target date** | none — see below                                               | `Target Completion Date` ASC   |
| **New reviews**               | `Status` ∉ { Published, Archived, Rejected }                   | `Rating` DESC                  |
| **Open requests**             | `Stage` ≠ Closed AND `Request type` ≠ Newsletter               | `Submitted` ASC (oldest first) |

All four are **linked views** created with `parent_page_id` (the UI's `/linked`
command), so they are blocks on the ops page and add **no view tab** to any source
database. The databases' own views — `Active Orders`, `The Truth`, the Reviews
curation set (`.agents/memory/reviews-curation-views.md`), the contact-inbox
triage views — are untouched and remain the per-database surface.

## Load-bearing decisions

1. **Every filter was verified against live rows, because a wrong filter here fails
   silently.** An ops page that renders empty reads as "nothing to do", which is the
   worst way to be wrong. Each view was queried back through
   `query_data_sources` in **view mode** (which applies the view's own filters and
   sorts) and the rows checked. The **New reviews** view returns nothing — that was
   confirmed to be a genuinely **empty Reviews database**, not a broken filter, by
   SQL-counting the data source separately. Do the same before trusting any filter
   added here later.

2. **A relative date filter is not available, and fails silently — this is the
   reason section 2 sorts instead of filtering.** The view DSL's date values are
   ISO dates only; writing `FILTER "Target Completion Date" < "today"` is **accepted
   without error** and stored as `{"type":"exact","value":"today"}`, which then
   matches **zero rows**. It was tried, returned an empty view against 30 live
   milestones, and was removed. An absolute ISO date works but goes stale the next
   day, so there is nothing to filter overdue-ness with. Section 2 therefore lists
   every milestone by target date ascending and the page copy tells the reader to
   stop at today.

3. **`Milestone Status` cannot be filtered on — same rollup-derived-formula wall as
   everywhere else.** `FILTER "Milestone Status" != "Completed"` is accepted, but the
   DSL compiles it to an `{"operator":"every","resultFilter":…}` shape (the tell that
   Notion can't type the formula), and the value is unreadable through the API
   (`formulaResult://…`), so it cannot be verified. Not shipped. This is the view-filter
   face of the API-query 400 recorded in `phase2-workspace-cards.md` and
   `materials-restock-alerts.md`: **reading the formula per row works, filtering on it
   does not.** The column is therefore **displayed** and read by eye.

4. **Money and actions stay on `/studio`; this page reads and edits rows.** No figures,
   no revenue, no refunds. The split is stated on the page itself so the two surfaces
   don't drift into competing dashboards — the website dashboard is the acting surface
   (it holds the five tools, the review queue, the analytics, the materials panel), and
   Notion is better at editing the rows themselves.

5. **Newsletter opt-ins are excluded from "open requests".** They land in the same
   contact database (`Request type = "Newsletter"`) but are a consent record, not a
   request anyone answers; leaving them in makes a queue that never empties. The other
   five request types are all present.

6. **Nothing filters on `Status` in Production Schedule.** That legacy status property
   still holds values on rows seeded before the sync cron was retired (`Completed` /
   `In Progress` / `Not Started`) and is **empty on every row the app has written since**
   — completion is the `Milestone Status` formula now. Filtering it would have quietly
   dropped every recent milestone.

7. **`Stage != "Closed"` rather than `Stage IN (New, Replied)`** on the requests view, so
   a row with **no** Stage still counts as open. The app writes `Stage = "New"`
   (`CONTACT_DEFAULT_STAGE`), but a hand-entered row might not, and the safe direction is
   for an untriaged request to appear rather than vanish.

8. **`Rejected` is filtered out before the option exists.** The Reviews `Status` select
   currently offers only New / Published / Archived; the dashboard's moderation write
   auto-creates `Rejected` on first use. The DSL accepts the unknown option name as an
   exact string, so the filter is already correct for that day and **no schema change was
   made** to the Reviews database.

## What a rename breaks

Six live option values are written into these filters: the order Stage **`Delivered`**;
the review statuses **`Published`** / **`Archived`** / **`Rejected`**; the request Stage
**`Closed`** and Request type **`Newsletter`**. Renaming any of them in Notion makes rows
silently appear or disappear from this page — no error anywhere. All six are also
targeted business rules in the app's code (`REVIEW_STATUS_PUBLISHED`,
`REVIEW_SET_ASIDE_STATUSES`, `CONTACT_DEFAULT_STAGE`, and the positional last-stage rule
in `services/delivery.ts`), so a rename is a two-place change regardless. The page's own
"About this page" section says so, for whoever is standing in Notion rather than here.

## Deliberately not built

- **A count / "N open" badge per section.** Notion has no page-level aggregate that
  updates outside a database view, and a hand-typed number would rot immediately.
- **A fifth section for payments due or materials to reorder.** Both already exist as
  answers on `/studio` (payment reminders ride the nightly cron; materials have their
  own panel and weekly digest), and the card scoped four.
- **Any change to the source databases.** No property added, no option added, no
  existing view edited — which is what makes this card reversible by deleting one page.
