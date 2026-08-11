# Phase-2 Workspace cards — costing, secret buttons, schedule, categories, contact inbox

A pass over five Phase-2 "Workspace" roadmap cards (the Notion databases /
formulas / views behind the app). Same pattern as `notion-p2-duplicates.md`:
apply what's safe via the Notion API, document the rest, record what the
**deployed app** depends on so nothing load-bearing is pruned.

Live data-source ids (this workspace):

- Custom Orders `944a7e5a-b47f-40e4-87d2-f4743f08428f` (Stage = 11-step _status_)
- costing `1d0f258c-7ef1-408b-b280-1feab1409dcb`
- Production Schedule `1cf6166a-e1bc-4e36-8417-d6db98d5501e`
- Product Categories `3868b1d0-b32a-43a4-adba-126fe85ee01c`
- Website Contact Messages `39ada6fa-c638-80f9-9a6c-000b86972989`

Notion API gotchas learned here (add to the `invoice-building.md` list):

- The DDL **FORMULA parser breaks on `(` in a column _name_** ("Unterminated
  single-quoted string") — name system columns without parens (`Stage Index Sys`,
  not `Stage Index (system)`).
- `DROP COLUMN "X"; ADD COLUMN "X" FORMULA(...)` **in one batch reuses the old
  formula code** (same `formulaCode://` id) — the new body silently doesn't apply.
  Drop in one call, add in the next.
- A **rollup of a status/select can't be read in a formula** (`format()`/compare
  both "Type error with formula"). Convert to a **number on the source row first**
  (a formula that maps the status → an index), then roll up that _number_ (a number
  rollup reads fine). A nested-`if` mapping is only reliably numeric _through a
  numeric rollup_ (`aggregation: max`); referenced directly it may not type as a
  number — so compare literals to the rollup, don't build a same-row index formula.
- **Formula _values_ are not readable via the MCP** — `fetch`/`query_data_sources`
  return `formulaResult://…` refs, never the computed value. Verify formula output
  by eye in the Notion UI, not through the API.

---

## ⑤ Triage the shared contact inbox — DONE (Notion only, app-safe)

The resolved state already existed (`Stage` select = New / Replied / Closed). Gap
was per-request-type views.

- **Applied:** added the two `Request type` options that otherwise only auto-create
  on first write — **Cancellation**, **Return / exchange** — so all six kinds exist
  and filter cleanly (must match the exact code strings; verified against
  `cancellation.blocks.ts` `RETURN_REQUEST_TYPE` etc.). Created 7 table views:
  _Open — all types_ (`Stage != Closed`), and one per type (`Request type = X` AND
  `Stage != Closed`) — Inquiries, Back in stock, Measurement updates, Cancellations,
  Returns / exchanges, plus Newsletter sign-ups.
- **App impact:** none — writers still set `Stage = "New"` + their own `Request
  type`; adding options/views doesn't touch writes. No code change.

## ④ One category list for everything — DONE (Notion only, app-safe)

`costing.Category` was a **select**; the shop uses a Product Categories relation.
Pointed costing at the same database.

- **Verified app-safe:** `costing.schema.ts` reads only Labor Cost / Suggested Price
  / Material Usage Lines — **never `Category`**. So converting it is invisible to the app.
- **Applied:** added a `Category` **relation → Product Categories** on costing,
  migrated all 10 categorized rows (7 Skate Soakers → Skate Soakers, 2 Dress/Costume
  → **Dresses**, 1 Other → Other; "The Truth Dress" was uncategorized, left blank),
  verified, then dropped the old select and renamed the relation to `Category`.
  (`DROP … ; RENAME … TO "Category"` in one batch collided → landed as `Category 1`;
  a follow-up standalone `RENAME "Category 1" TO "Category"` fixed it.)
- **Manual (optional):** nothing required. Could add a dual back-relation +
  best-seller rollup on Product Categories later; not needed for the card.

## ③ Let the schedule read, not copy — DONE (Notion + code)

Production Schedule already pulled Customer / Order # / Due Date as rollups; the
only nightly-synced _copy_ was the milestone `Status`. Replaced it with a derived
Notion formula and **retired the status-sync pass in code**.

- **Notion (applied, additive):**
  - `Stage Index Sys` (formula) on **Custom Orders** = maps the order's live `Stage`
    (status) → its index 0–10 over the fixed pipeline (`0-1` fallback for unknown).
  - `Order Stage` (rollup, status) + `Order Stage Index` (rollup, **max** of `Stage
    Index Sys` → a number) on Production Schedule — each milestone now _reads_ the
    order's live stage directly.
  - `Milestone Status` (formula) on Production Schedule = for the row's
    `Production Stage`, compare its literal index to `Order Stage Index`: past →
    Completed, current → In Progress (Completed at Delivered/10), ahead → Not
    Started, unknown → "". Reproduces the old `milestoneStatusFor` exactly (checked
    against the still-present old `Status` on live rows — e.g. Knight of Midnight at
    Cutting/Pinning: Pattern Design Completed, Cutting/Pinning In Progress, later
    Not Started). Logic verified by hand (formula values aren't API-readable).
- **Code (applied — 1030 api-server tests green):**
  - `production-schedule.blocks.ts`: `PS_STATUS_PROPERTY` → `PS_MILESTONE_STATUS_PROPERTY
    = "Milestone Status"`; `buildMilestoneProperties` no longer writes a completion
    state; removed `buildMilestoneStatusUpdate`, `PRODUCTION_SCHEDULE_INITIAL_STATUS`,
    `MILESTONE_STATUS_NOT_STARTED`, `MilestoneStatus`. Kept `MILESTONE_STATUS_IN_PROGRESS`
    / `_COMPLETED` (the fitting-reminder filter's string literals).
  - `production-schedule.repository.ts`: removed `listOrderMilestonePages` +
    `updateMilestoneStatus`; **rewrote the fitting-reminder filter** from status-type
    (`status: {does_not_equal/equals}`) to **formula-string** (`formula: {string:
    {…}}`) on `Milestone Status`.
  - `orders.repository.ts`: removed `findOrdersWithMilestones` (sync-only).
  - `schedule.service.ts`: removed `syncMilestoneStatuses` + `milestoneStatusFor`;
    dropped the sync pass + `milestonesUpdated` from `reconcileMilestones` /
    `MilestoneReconcileResult`. `routes/cron.ts` drops the "refreshed statuses" note.
  - Tests updated across schedule.service / production-schedule.{repository,blocks} /
    orders.repository / cron.routes.
- **Trade-off (accepted per the card):** the `Stage Index Sys` / `Milestone Status`
  formulas **hardcode the 11-stage pipeline order**, so renaming/reordering Stage
  options in Notion means updating those two formulas (generation still reads the
  live list via `fetchLiveOrderStages`; the formulas degrade to blank for unknown
  stages). This is the deliberate price of "read, not copy."
- **POST-DEPLOY manual step (do NOT do before the code ships):** the old `Status`
  status-property on Production Schedule is **still present** on purpose — the
  currently-deployed cron still writes it. After this branch deploys (the new code
  stops writing/syncing it), **drop `Status`** in Notion and point the Timeline /
  Calendar / "The Truth" views at `Milestone Status`. Until then both columns
  coexist, which is the built-in way to eyeball that the formula matches.

## ① One costing engine — profit model — NEEDS AN OWNER DECISION (not applied)

Labor unit is **already unified** (`Labor Hours`, hours, all channels). What's left
is the profit model, and it can't be done unilaterally:

- The current `Suggested Price` = `round(Break Even × (1 + margin) / (Production ?
  1 − sellingFees : 1), 2)` — **only Production grosses up selling fees**; Custom
  and Rhinestone divide by 1.
- "Standardizing" means one model for all channels, which **necessarily changes some
  prices**: (a) margin-only everywhere → Production prices _drop_; (b) margin + fee
  gross-up everywhere → Custom/Rhinestone prices _rise_.
- The `Default Selling Fees %` rollup is **global** (every row relates to the one
  Pricing Settings row), so a naive "one formula, fee as data" does **not** leave
  Custom unchanged — Custom would start dividing by `(1 − fees)`.
- **The app reads Custom-channel costing rows to build customer invoices** (the
  generator's Adjustment line makes the invoice total = Σ `Suggested Price`), so any
  change to Custom's `Suggested Price` changes what customers are billed. And
  **formula values aren't API-readable**, so a rewrite can't be verified through the
  API — only in the Notion UI.

**Recommendation to run in Notion (owner picks the model, verifies values by eye):**
express the fee as a per-row value that's 0 for direct-sale channels, e.g.
`effectiveFees = if(prop("Channel") == "Production", prop("Default Selling Fees %
(from settings)"), 0)` and `Suggested Price = round(prop("Break Even Price") × (1 +
prop("Default Profit Margin (from settings)")) / (1 − effectiveFees), 2)`. That's
identical to today for Custom (unchanged invoices) and Production, and only reprices
Rhinestone advisory rows — the smallest-blast-radius "standardization." If the
atelier instead wants fees on every channel, that's option (b) and it _will_ change
Custom invoices. **Left for the owner to choose + apply.**

## ② Retire the copy-a-secret buttons — OWNER RUNBOOK (not app-executable)

Two Custom Orders **formula properties** — `Generate Invoice API Call`,
`Send Status Update` — paste `CRON_SECRET` into a URL. Two hard limits:

- **Native Notion "button" properties can't be created via the API** (no BUTTON
  type in the schema DDL; button actions are UI-only), and a native button can't
  interpolate the row's Order Number into its URL — the very reason these are
  formula-links today. So the "move to native buttons" half is a **Notion UI job**.
- **Rotating `CRON_SECRET` is a Vercel dashboard action.** The app is unaffected —
  the env-var name stays and the `/run` endpoints still accept `?secret=` (see
  `lib/cron-route.ts`). No repo code change.

**Runbook (owner):** (1) generate a fresh secret — `openssl rand -hex 32`; (2) set
`CRON_SECRET` to it in Vercel → the project's Environment Variables and redeploy;
(3) update the two Custom Orders formula-link properties (and the milestone / invoice
/ cancellation formula-links that reuse the same secret) to the new value. Keeping
the formula-link pattern is fine; the durable fix is the Phase-3 "Staff
authentication for internal tools" card (a real signed-in staff role instead of a
shared URL secret). Do **not** commit an actual secret to the repo.
