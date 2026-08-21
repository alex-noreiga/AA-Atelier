# How-to guides on the studio dashboard

_Roadmap card 02: "How-to guides on the studio dashboard"._

## The problem being solved

The studio procedures the code **can't** perform — how an invoice is actually
built, what the milestone reconciliation is for, how a refund is decided — were
written down in two places, neither of which is where the work happens:

- **`.agents/memory/*.md`**, written for whoever maintains the app. The atelier
  does not read them and should not have to.
- **Standalone HTML files the atelier writes for itself.** One already existed:
  `invoicing-guide.html`, attached to the Notion **finances** page — several
  clicks from the dashboard button it describes.

Meanwhile `/studio` had grown ten places where a procedure matters: six tools
and four panels. Pressing "Itemize an invoice" tells you nothing about the
double-charge trap the generator exists to avoid.

## What was built

`GET /api/studio/guides` — contract-first, behind the same `requireStaff` gate
as the rest of the studio surface. Each row of a Notion **"Studio Guides"**
database carries an uploaded HTML file and a `Section`; the dashboard renders
the file in a sandboxed frame beside whatever that section names.

| Piece                         | File                                       |
| ----------------------------- | ------------------------------------------ |
| Section vocabulary + resolver | `api-server/src/lib/guide-sections.ts`     |
| Notion read-side mapping      | `lib/notion/guides.schema.ts`              |
| Row query + file download     | `lib/notion/guides.repository.ts`          |
| Assembly, cache, HTML check   | `services/studio-guides.service.ts`        |
| Route                         | `routes/studio.ts`                         |
| Panel + per-section slots     | `web-app/src/components/studio-guides.tsx` |

## Load-bearing decisions

1. **The app stores no guide content, and has no editor.** A guide is a file
   attached to a Notion row; revising it is replacing the file. That is the
   whole justification for the feature — a procedure that needs an engineer to
   correct is a procedure that stays wrong. It is also why there is no
   "create guide" write path: adding one is adding a Notion row.

2. **The sandbox IS the sanitizer, and it is not optional.** The markup is a
   file somebody uploaded, rendered on an origin that holds a signed-in staff
   session — including the Supabase access token in `localStorage` that the
   whole studio surface is gated on. It goes into an `<iframe srcDoc>` whose
   `sandbox` grants neither `allow-scripts` nor `allow-same-origin`, so nothing
   in a guide can run and nothing could reach the page if it did.
   - **Never** render a guide with `dangerouslySetInnerHTML`. A `<script>` or an
     `onerror=` in an uploaded file would then hold the studio session.
   - **Never** add `allow-scripts` or `allow-same-origin` to that attribute.
     `allow-popups allow-popups-to-escape-sandbox` **is** granted, so a link in
     a guide opens in an ordinary new tab rather than being inert.
   - There is deliberately **no** server-side HTML sanitizer. It would buy no
     safety the sandbox doesn't already give, would silently mangle the
     atelier's own markup, and — worst — would make the sandbox look like
     defence-in-depth rather than the boundary it is.
   - `web-app/test/studio-guides.test.tsx` asserts the two absent tokens, so
     adding one fails CI rather than a review.

3. **Section resolution FAILS OPEN.** `resolveGuideSection` matches the row's
   `Section` against the served vocabulary — id or label, ignoring case, spacing
   and punctuation — and falls back to `general` for anything blank or
   unrecognized. A guide is something the atelier sat down and wrote; misfiling
   it should cost it its position on the page, never its existence. (Contrast
   `orderDelivered`, which fails closed: withholding a review invitation is
   recoverable, whereas a guide that silently isn't there is indistinguishable
   from one nobody wrote.)

4. **A tool id IS a section id.** The six section ids for tools are the same
   strings as `StudioToolName`, so `<GuidesFor section={spec.tool} />` inside
   the tool card needs no mapping table and can't drift from the tool list.

5. **The vocabulary is served, not duplicated.** Like `GET /services`, the
   catalog is code (it's coupled to what the page renders, so it can't be a live
   Notion read) but both sides need it — the atelier picks a `Section`, the
   dashboard decides where the guide goes. It rides on every response even when
   no guide is filed against it, because the accepted values are otherwise only
   discoverable by reading `lib/guide-sections.ts`.

6. **A guide is never dropped, only explained.** No file yet, a PDF filed as a
   guide, an oversized file, a failed download — each is returned with
   `unavailable` saying which, and listed. Same reasoning as the materials
   panel's untracked list: a guide that appears nowhere and raises nothing
   reads exactly like one nobody wrote.

7. **The size cap is a response cap.** The markup is returned inline in JSON
   from a serverless function, so an unbounded attachment is an unbounded
   response. `MAX_GUIDE_BYTES` is 512 KB, checked against `Content-Length`
   first (so an oversized file is refused without being pulled down) and again
   on what arrived (because a chunked response declares no length). An over-cap
   guide is reported, never truncated — half a procedure that stops mid-sentence
   is worse than one that says why it isn't here.

8. **HTML is decided on the file NAME.** Notion's storage host serves
   everything as a generic binary type, so there is no content type to trust. A
   `.pdf` would decode to mojibake and render as a page of noise; it is reported
   as `not-html` so the atelier can see it needs converting.

9. **The signed URL never leaves the server.** Notion file URLs expire in about
   an hour (same as the review photos). Handing one to the browser would mean a
   cached response rotting into a dead link, and a credential-bearing URL on the
   page. The server downloads the markup and serves that.

10. **Cached whole, for 60s.** Each guide costs a download on top of the Notion
    query, so the assembled result is cached rather than the rows — which is
    also how long after replacing a file the dashboard takes to show it. A later
    read that fails falls back to the cached result: stale guides are still the
    right procedures.

## OUTSTANDING — atelier steps the code can't do

The **"Studio Guides" database has been created** (2026-08-21), under the Notion
**website** page alongside Website Contact Messages, with all five properties
and the eleven `Section` options pre-filled. Database id:
`d9c893301efc480d9d8861d28e887c72`.

What is left cannot be done through the MCP connector, because it authenticates
as a different identity than the app's own integration:

- [ ] **1. Share the Notion integration with the Studio Guides database.**
      Open it → ••• → Connections → add the same integration
      `NOTION_API_KEY` belongs to. Without this the query 404s and every guide
      shows as unreadable.
- [ ] **2. Set `NOTION_STUDIO_GUIDES_DATABASE_ID=d9c893301efc480d9d8861d28e887c72`**
      in Vercel, and redeploy. Until then the panel reports it isn't connected,
      which is the intended unconfigured state rather than a fault.
- [ ] **3. Attach `invoicing-guide.html` to the seeded "Building an invoice"
      row** (`Section = Itemize an invoice`, already set). The file currently
      lives as an embed block at the bottom of the Notion **finances** page; it
      could not be copied automatically, because a file uploaded by one
      integration isn't readable by another. Once it renders on the dashboard,
      delete that embed.

The seeded row is the only one, deliberately: an empty row renders as "No file
attached yet", so pre-creating one per section would put ten placeholders across
the dashboard.

## NOT YET VERIFIED AGAINST LIVE NOTION

The suites mock Notion and the file download entirely, so what shipped is
verified as wiring. Two things are worth checking on the first real guide:

- **That the attachment downloads at all.** The `file.url` a database `files`
  property returns is signed for the integration; the download is a plain
  `fetch` with no Notion credential on it. If it 403s, every guide shows as
  `unreadable` and the `warn` in `studio-guides.service.ts` names which.
- **That a real guide renders legibly in the frame.** The frame is a fixed
  60vh with its own scrollbar — a sandboxed `srcdoc` document can't be measured
  from outside without scripts, and scripts are exactly what it doesn't get. A
  guide styled for a full page may want its own `max-width`.

## No new secret, and one new env var

`NOTION_STUDIO_GUIDES_DATABASE_ID` is the only addition, and it is optional —
unset behaves exactly as before the feature existed. Access reuses
`STUDIO_STAFF_EMAILS` (+ `STUDIO_REQUIRE_GOOGLE`), which the dashboard already
needed.
