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

## OUTSTANDING — atelier steps the code can't do

Merged to `development` in PR #182 (2026-08-19). These are **not done** and
nothing in the app will do them. Until step 1, the atelier's old Notion buttons
are dead links (a 404, not a silent failure) — the work is run from `/studio`
instead.

Do them in this order. Deleting a formula property before the deploy just leaves
the atelier without a button; deploying first means the old links 404 rather than
still working with a secret you are about to rotate.

- [ ] **1. Deploy `development` to production.**
- [ ] **2. Delete the four formula-property link fields in Notion:**
  - `Send Status Update` — Order Tracking Pipeline
  - the invoice-generator link — invoices & payments
  - the cancellation refund link — Order Tracking Pipeline
  - the return refund link — Shop Orders
- [ ] **3. Delete any "Open link" button** pointing at `…/generate-milestones/run`.
- [ ] **4. Rotate `CRON_SECRET`** (`openssl rand -hex 32` → Vercel → the project's
      Environment Variables → redeploy) **and update the Notion stage-change
      automation's `Authorization: Bearer <CRON_SECRET>` header to match.** This is
      the point of the whole exercise: the old value sat in four Notion formulas
      and in the browser history of everyone who ever pressed one. Nothing but
      Vercel Cron and that one automation sends it now, so rotating costs one env
      var and one automation header.

**Rotation gotcha:** the Notion stage-change automation is the one caller that may
still be configured with `?secret=` in its URL rather than the `Authorization`
header (the app still accepts both — see point 2 above). If it is, rotating breaks
it **silently**, and the symptom is customers quietly no longer receiving order
status-change emails. Move that automation to the header as part of rotating.

## NOT YET VERIFIED AGAINST LIVE NOTION / STRIPE

The test suites mock Notion and Stripe entirely, and the underlying services were
carried over unchanged — so what shipped is verified as _wiring_, not as a live
run. The first real use of each tool is its first live exercise.

**Run the two money tools against a known test order first.** `cancellation-refund`
and `return-refund` call Stripe for real; a wrong order number refunds a real
customer. Both are idempotent and safe to re-run, which is the mitigation, but a
refund that has already gone out cannot be un-sent.

The three non-money tools are lower stakes but still worth one deliberate run each:
`milestones` (writes Production Schedule rows and can send reminder emails),
`invoice-lines` (writes invoice line items), `status-email` (emails a customer —
run it against an order whose email is the studio's own).

## No new env var

The tools reuse `STUDIO_STAFF_EMAILS` (+ `STUDIO_REQUIRE_GOOGLE`), which the
dashboard already needed.
