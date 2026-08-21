# The customer-request queue on the studio dashboard

Roadmap card ②: "The six kinds of customer request are written to Notion and never
read back, so actioning one means reading it there and hand-typing its order number
into a dashboard tool. List the open requests instead, each handing its own order
number to the tool that actions it."

Shipped as a **Customer requests** panel on `/studio`, fed by `GET /api/studio/requests`

- `PUT /api/studio/requests/:id/state`. **No new database, no new env var, and nothing
  added in Notion** — it reads and writes the "Website Contact Messages" rows the six
  capture writers already produce.

## Files

| Layer          | File                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| Contract       | `lib/api-spec/openapi.yaml` (`StudioRequest*`, `RequestStateRequest`)  |
| Notion mapping | `api-server/src/lib/notion/requests.schema.ts`                         |
| Notion I/O     | `api-server/src/lib/notion/requests.repository.ts`                     |
| Use-case       | `api-server/src/services/studio-requests.service.ts`                   |
| Routes         | `api-server/src/routes/studio.ts`                                      |
| Panel          | `web-app/src/components/studio-requests.tsx`                           |
| Hand-off       | `web-app/src/lib/studio-handoff.ts`                                    |
| Receiving end  | `web-app/src/components/studio-tools.tsx` (`handoff` prop on ToolCard) |

## Why it looks the way it does

1. **The hand-off prepares a run; it never starts one.** Pressing a request's action
   fills the matching tool card, scrolls to it, focuses the field — and stops. The two
   refunds keep their confirmation step (the order number echoed back), because that
   is what makes a mis-typed number impossible rather than merely unlikely. Running
   the tool straight from the request row would have duplicated that confirm logic or,
   worse, skipped it. One place moves money, and it still asks.

2. **`ToolHandoff` carries a nonce.** Without it, two requests naming the same order
   — or one request pressed twice — produce an identical object, and the `useEffect`
   keyed on it does nothing: no re-scroll, and no re-arming of a confirmation the
   atelier had dismissed. The nonce is a module counter in `studio-handoff.ts`.

3. **There is no order-number PROPERTY on the contact database.** The order-scoped
   writers put it in the row **title** (`Cancellation: ORD-000002`) and in the message
   body's first line. `extractOrderNumber` reads the title first, then the body, and
   matches only `ORD-…` / `SHP-…` — a bare `000002` is deliberately rejected. When it
   can't be recovered the action is **withheld**, not offered blank: the refund tools
   act on whatever is in the field. Parsing is skipped entirely for the kinds that
   concern no order, so an inquiry quoting an order number never grows a refund button.

   Note the `Order` / `Shop Order` **relations** were not used for this: they hold a
   page id, not an order number (resolving one would be a Notion request per row), and
   they're gated off behind `NOTION_RELATION_LINKS` by default.

4. **Kind and state are DERIVED, and both fail toward "show it".** Unrecognized
   `Request type` ⇒ `other` (shown, with the raw value named); unrecognized or blank
   `Stage` ⇒ `new` (open). Same direction as `reviewModeration`, and the same as the
   inbox's own "Open — all types" view, which filters `Stage != Closed` rather than
   `Stage in (New, Replied)` precisely so a row nobody triaged still appears
   (`studio-operations-page.md`, point 7). `Replied` / `Closed` are targeted business
   rules naming live option values — rename `Closed` and every closed request reopens.

5. **Newsletter opt-ins are excluded**, in the Notion filter _and_ the pure extractor.
   Same call the ops page made: a consent record nobody answers makes a queue that
   never empties. The panel's empty state says so, so "six kinds, five listed" isn't
   left unexplained.

6. **Two bounded queries, not `scanDatabase`.** The contact inbox is the largest
   database the app reads (every inquiry and opt-in ever filed), so a full scan would
   be up to 100 Notion requests per dashboard load to surface a handful of open rows.
   The open rows are asked for directly — `Stage != Closed` AND `Request type !=
Newsletter`, one page, `created_time` ascending, `truncated` when cut short — and
   the closed rows are a second short read. **`does_not_equal` matches an empty select
   too**, which is what keeps an untyped/unstaged row in the queue; this was already
   verified live for the identical Notion view filter.

7. **Failure directions.** The open read throws (a staff work queue that renders empty
   because of a misconfiguration is indistinguishable from "nothing to do" — the worst
   way for a queue to be wrong). The closed read is best-effort: losing the undo
   history for one page load must not cost the atelier its queue.

8. **`Stage` is the only thing written.** The request row itself is never edited — the
   same contract the capture endpoints keep with the orders they concern — and `new`
   writes `CONTACT_DEFAULT_STAGE`, so reopening leaves the row exactly as a freshly
   filed one.

## What a Notion rename breaks

The five `Request type` values (`Inquiry`, `Back in stock`, `Measurement update`,
`Cancellation`, `Return / exchange`) and `Newsletter`; and the `Stage` values `New`,
`Replied`, `Closed`. All of them already existed as constants in the writers, which is
why this module imports rather than restates them — a rename stays a one-line change.
A renamed `Request type` degrades to `other` (the row is still shown, and named); a
renamed `Closed` reopens every closed request. Neither errors.

## Deliberately not built

- **Running a tool straight from the request row.** See point 1.
- **A measurement-change "apply" button.** The app has never edited an order's
  measurements (Approach A, `measurement-change.blocks.ts`), and this card was not the
  place to change that — the roadmap has "in-place measurement editing" of its own.
- **Marking a request closed automatically when its tool succeeds.** Tempting, but a
  refund that ran is not the same fact as a request the atelier considers answered
  (a partial return refund is the obvious case), and inferring one from the other
  would close rows that still need work.
