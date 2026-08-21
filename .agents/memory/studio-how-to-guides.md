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

Two contract-first reads, behind the same `requireStaff` gate as the rest of the
studio surface. Each row of a Notion **"Studio Guides"** database carries an
uploaded HTML file and a `Section`; the dashboard renders the file in a
sandboxed frame beside whatever that section names.

- `GET /api/studio/guides` — what the guides are and where they go. No content.
- `GET /api/studio/guides/{guideId}` — one guide's markup, fetched on open.

| Piece                          | File                                       |
| ------------------------------ | ------------------------------------------ |
| Section vocabulary + resolver  | `api-server/src/lib/guide-sections.ts`     |
| Notion read-side mapping       | `lib/notion/guides.schema.ts`              |
| Row queries + bounded download | `lib/notion/guides.repository.ts`          |
| Assembly, cache, renderability | `services/studio-guides.service.ts`        |
| Routes                         | `routes/studio.ts`                         |
| Panel + per-section slots      | `web-app/src/components/studio-guides.tsx` |

## Load-bearing decisions

1. **The vocabulary tracks the dashboard's panels.** A section exists for each
   of the six tools and each panel — including `settings`, added when the studio
   settings editor landed on `main` mid-branch. A new panel that never gets a
   section is a panel no guide can be filed against, so adding one is part of
   adding a panel.

2. **Listing and content are separate operations — this was a correction.** The
   first cut inlined every guide's markup into the listing, so the dashboard
   downloaded the studio's entire manual on every load in order to render a
   column of collapsed one-line summaries. Three problems, one cause: the
   response had a per-file cap but no aggregate one, so about nine
   screenshot-heavy guides would pass Vercel's ~4.5 MB payload limit and **500
   the endpoint** — taking the small guides down with the large ones, with no
   partial degradation; a dashboard left open re-downloaded the lot on refocus;
   and one hung storage connection stalled a page nobody had asked to read a
   guide on. Fetching per guide on open fixes all three, and makes the per-file
   cap the only cap needed. Don't merge them back.

3. **The app stores no guide content, and has no editor.** A guide is a file
   attached to a Notion row; revising it is replacing the file. That is the
   whole justification for the feature — a procedure that needs an engineer to
   correct is a procedure that stays wrong. It is also why there is no
   "create guide" write path: adding one is adding a Notion row.

4. **The sandbox IS the sanitizer, and it is not optional.** The markup is a
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

5. **Section resolution FAILS OPEN.** `resolveGuideSection` matches the row's
   `Section` against the served vocabulary — id or label, ignoring case, spacing
   and punctuation — and falls back to `general` for anything blank or
   unrecognized. A guide is something the atelier sat down and wrote; misfiling
   it should cost it its position on the page, never its existence. (Contrast
   `orderDelivered`, which fails closed: withholding a review invitation is
   recoverable, whereas a guide that silently isn't there is indistinguishable
   from one nobody wrote.)

6. **A tool id IS a section id.** The six section ids for tools are the same
   strings as `StudioToolName`, so `<GuidesFor section={spec.tool} />` inside
   the tool card needs no mapping table and can't drift from the tool list.

7. **The vocabulary is served, not duplicated.** Like `GET /services`, the
   catalog is code (it's coupled to what the page renders, so it can't be a live
   Notion read) but both sides need it — the atelier picks a `Section`, the
   dashboard decides where the guide goes. It rides on every response even when
   no guide is filed against it, because the accepted values are otherwise only
   discoverable by reading `lib/guide-sections.ts`.

8. **A guide is never dropped, only explained.** No file yet, a pasted link
   where an upload was needed, a PDF filed as a guide, an oversized file, a
   failed download — each is reported with `unavailable` saying which, and
   listed. Same reasoning as the materials panel's untracked list: a guide that
   appears nowhere and raises nothing reads exactly like one nobody wrote. The
   three reasons visible without a download are decided in the **listing**
   (`staticUnavailability`, shared by both halves so they can't disagree), so a
   broken guide reads as broken before anyone opens it and is never requested.

9. **The download is bounded three ways.** `MAX_GUIDE_BYTES` is 2 MB — sized for
   the guide the atelier will actually write, an HTML export with its
   screenshots base64-inlined — checked against `Content-Length` first (so an
   oversized file is refused without being pulled down) **and as the body
   streams**. The stream check is the load-bearing one: `arrayBuffer()` then
   measure is an unbounded read wearing a cap, since a 300 MB file served
   without a declared length is fully materialized before rejection. There is
   also a 10s `AbortSignal`, because a hung storage connection would otherwise
   hold a worker until the platform kills the function — turning a slow file
   into a 500. Every other outbound read here that can hang carries an explicit
   bound (`lib/google/retry.ts`); this is that bound. An over-cap guide is
   reported, never truncated: half a procedure that stops mid-sentence is worse
   than one that says why it isn't here.

10. **Only an UPLOAD is fetched, never a pasted link.** A Notion `files` property
    holds either; the review-photo reader accepts both and this must not. The
    server returns what it downloads, so accepting `external` would let anyone
    with **edit access to the guides database** — a Notion permission, not
    membership of `STUDIO_STAFF_EMAILS` — aim a server-side GET at an address of
    their choosing and read the answer on the dashboard. The two groups mostly
    overlap; "mostly" is not a security boundary. `GuideAttachment` is a
    discriminated union, so the fetchable URL exists only on the `upload` variant
    and the compiler is what enforces it; a pasted link is reported as
    `not-uploaded` rather than silently ignored, and its URL never leaves
    `guides.schema.ts`.

11. **HTML is decided on the file NAME.** Notion's storage host serves
    everything as a generic binary type, so there is no content type to trust. A
    `.pdf` would decode to mojibake and render as a page of noise; it is reported
    as `not-html` so the atelier can see it needs converting.

12. **The signed URL never leaves the server.** Notion file URLs expire in about
    an hour (same as the review photos). Handing one to the browser would mean a
    cached response rotting into a dead link, and a credential-bearing URL on
    the page. The server downloads the markup and serves that — and re-reads the
    row on open rather than trusting a listing whose URLs may have expired
    since.

13. **The listing is cached 60s; markup is not.** The listing is one Notion
    query, cached like every other live read here — which is also how long after
    editing a row the dashboard takes to show it — falling back to the cached
    result on a later failure, because stale guides are still the right
    procedures. Markup is fetched on demand and held by the browser's query
    cache while the guide is open, so replacing a file shows on the next open.

14. **An unreachable database is reported, not thrown — and is its OWN state.**
    The id set but the integration never shared 404s every query. Left as a
    throw that is a permanent 500 **plus an alert email on every dashboard
    load**, for the single likeliest setup mistake and a configuration state
    only a human can clear. So it comes back as `unreachable: true` with
    `configured: true`, and the panel says what to fix. Deliberately **not**
    folded into `configured: false`: the two have different fixes (set the env
    var vs. share the database), and the panel names the right one. Every other
    failure still throws — a 502 from Notion IS an outage and clears itself.

    This uses the shared `lib/notion/errors.ts` (`notionRequestError` /
    `isNotionNotFound`), which landed on `main` for the materials panel while
    this branch was in flight and solves the identical problem. An earlier cut
    here carried its own `GuidesDatabaseUnreachableError` and conflated 404 with
    "not configured"; both were replaced rather than left to diverge.

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
  `fetch` with no Notion credential on it. If it 403s, an opened guide shows as
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
