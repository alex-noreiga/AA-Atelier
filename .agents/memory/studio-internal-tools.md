# Internal tools moved from `?secret=` links to the studio dashboard

_Roadmap: "Staff authentication for internal tools" + "Retire the copy-a-secret buttons"._

## The problem being solved

Five atelier actions were each reachable as a `GET` link authenticating with
`?secret=<CRON_SECRET>` in its query string, built by a **Notion formula
property** on the row and opened in a browser tab that rendered an HTML
confirmation page:

| Action                      | Retired route                                 |
| --------------------------- | --------------------------------------------- |
| Milestone reconciliation    | `GET /api/cron/generate-milestones/run`       |
| Invoice line-item generator | `GET /api/invoices/generate-line-items[/run]` |
| Order status-change email   | `GET /api/webhooks/notion-stage-change/run`   |
| Cancellation refund         | `GET /api/orders/process-cancellation[/run]`  |
| Return / exchange refund    | `GET /api/shop-orders/process-return[/run]`   |

One shared secret, in four Notion formula fields, in every browser history that
ever opened one — and two of those links **move real money**. Each new atelier
button added another copy. The `/studio` dashboard had already established a real
staff gate (Supabase session + `STUDIO_STAFF_EMAILS` + a Google `amr` check), so
the actions moved behind it.

## What was built

`POST /api/studio/tools/:tool` — one contract-first endpoint behind
`requireStaff`, dispatching to the **unchanged** underlying services.
`services/studio-tools.service.ts` is the dispatcher; the UI is
`web-app/src/components/studio-tools.tsx`, rendered at the bottom of
`pages/studio.tsx`.

Load-bearing decisions:

1. **Deleted, not deprecated.** All ten retired handlers are gone, including the
   Bearer (non-`/run`) halves — nothing machine-driven called those.
   `test/integration/retired-secret-links.routes.test.ts` asserts they stay 404
   even with a valid `CRON_SECRET`, because re-mounting one would put a
   money-moving credential back into URLs.

2. **`CRON_SECRET` survives for machines only.** Two callers can send a header,
   so they keep it: Vercel Cron → `GET /api/cron/generate-milestones`, and the
   Notion stage-change automation → `POST /api/webhooks/notion-stage-change`.
   That webhook still _also_ accepts `?secret=` — the last place the app reads
   the secret from a URL — kept deliberately, because a live automation may
   already be configured that way and breaking it would silence customer status
   emails as a side effect of a dashboard change. It should use the header.
   `lib/cron-route.ts` shrank to just those two checks (`htmlPage` / `escapeHtml`
   / `orderParam` had no callers left).

3. **The server owns the wording.** Every tool returns
   `{ tool, status, title, message, details[] }` — the summary sentences the HTML
   confirmation pages composed, moved into the dispatcher. One render shape
   instead of five, and the atelier reads the same sentences as before.

4. **`noop` is a first-class result.** Every action is idempotent, so "ran and
   found nothing to do" is normal and must not read as success. `attention` is
   the third state: it ran but left work for a human — a refund Stripe rejected,
   which leaves the order uncancelled _precisely so_ a re-run can retry. Anything
   the tool couldn't start (missing order number, unknown order, invoice not
   ready) is thrown and surfaces as a 400/404 with its own message.

5. **The refunds confirm; a partial refund became a field.** A hand-typed order
   number is the one thing a formula link did better — it could never be typed
   wrong — so the two money tools ask again with the number echoed back, and
   editing the field re-arms the question. The trade buys what a link couldn't do:
   a partial return refund is a form field instead of an `&amount=180`
   hand-appended to a URL before pressing it.

6. **Contract-first, unlike what it replaced.** The old routes sat outside the
   OpenAPI contract because they were browser tabs. This is an ordinary SPA JSON
   call, so the tool name is a path-param **enum** (an unknown tool is a 400 from
   the generated schema, not a route that quietly doesn't exist) and `amount` is
   schema-validated as non-negative before any service sees it.

## Notion clean-up the code can't do (after deploy)

- Delete the four formula-property link fields: `Send Status Update` (Order
  Tracking Pipeline), the invoice-generator link (invoices & payments), and the
  cancellation / return refund links (Order Tracking Pipeline, Shop Orders).
- Delete any "Open link" button pointing at `…/generate-milestones/run`.
- **Rotate `CRON_SECRET`** and update the one Notion automation header. This is
  the point of the exercise — the secret has been sitting in formulas and browser
  history, and nothing but Vercel Cron and that automation sends it now.

Order matters: deploy first, then delete the fields. Deleting a formula property
before deploy just leaves the atelier without a button; deploying first means the
links 404 rather than working with a secret you're about to rotate.

## No new env var

The tools reuse `STUDIO_STAFF_EMAILS` (+ `STUDIO_REQUIRE_GOOGLE`), which the
dashboard already needed.
