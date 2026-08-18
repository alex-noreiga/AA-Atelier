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
  by eye in the Notion UI, not through the API. (The **raw REST** `POST
/databases/{id}/query` _does_ return each row's computed formula value — e.g.
  `properties["Milestone Status"].formula.string` — so client-side evaluation over
  query results is fine; only the MCP hides it.)
- **A rollup-derived formula often can't be _filtered_ via the REST API.** A
  `formula: {string: {…}}` (or number/date) filter on a formula whose body reads a
  rollup is rejected with a 400 `validation_error` — _"Unable to filter based on a
  formula of unknown type"_ — because the API can't resolve the formula's declared
  result type through the rollup. (Distinct from reading the value, which works —
  see above.) This bit `findMilestonesNeedingFittingReminder`: it filtered on the
  `Milestone Status` formula and threw on every nightly cron run. **Fix (shipped):**
  filter the query only on the reliably-typed properties (the `Production Stage`
  select + the `Reminder Sent` checkbox) and evaluate the not-completed /
  due-or-in-progress conditions **client-side** from each row's computed
  `Milestone Status` value. Degrades to date-only if the value is unreadable.

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
{…}}`) on `Milestone Status`. **(Superseded — see the follow-up below: the
    formula filter 400s in production; the query now filters only on the stage
    select + `Reminder Sent` checkbox and evaluates `Milestone Status` client-side.)**
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

## ① One costing engine — ALREADY STANDARDIZED (no change; docs were stale)

**Finding: this card is effectively already done.** The live `Suggested Price` formula
(pasted from Notion by the atelier) is:

```
round((Material Cost + Labor Hours × Hourly Rate + Packaging Cost) × (1 + margin)
      / (1 − Default Selling Fees %), 2)
```

— **one uniform formula, no `Channel` branch**, labor already in `Labor Hours`. The
channel difference is expressed **as data, not logic**: `Pricing Settings` has TWO
rows —

- **Custom / Direct** — `Default Selling Fees %` = **0**, Hourly Rate 5, Margin 1
- **Production / Marketplace** — `Default Selling Fees %` = **0.065**, Hourly Rate 5, Margin 1

— and every costing row relates to the correct one (verified: all Custom items →
Custom/Direct, all Production items → Production/Marketplace; no Rhinestone rows yet).
So a Custom item divides by `(1 − 0) = 1` (no fee gross-up) and a Production item by
`0.935`, from the same formula. **This is exactly the "standardized profit model
across channels" the card asked for** — the labor unit is unified and the profit model
is one data-driven formula. Nothing to change.

**Do NOT rewrite the formula, and do NOT add a `Channel` branch.** An earlier draft of
this note (and `invoice-building.md`) wrongly claimed the formula had a `Production ?
1 − sellingFees : 1` branch — that's **stale**; the real formula has no branch. Adding
`if(Channel=="Custom", 0, fees)` would hardcode a redundant branch duplicating the
Pricing Settings relation and could **diverge** from it (e.g. a mislinked row, or a
future Rhinestone item). The relation IS the source of truth for the per-channel fee.

- **Docs corrected here:** `invoice-building.md` (the "`Suggested Price` is CORRECT"
  note) and `CLAUDE.md` (invoice-generator section) now describe the real branch-free,
  two-Pricing-Settings-rows model.
- **Gotcha for the future:** the app reads Custom-channel `Suggested Price` to bill
  customers (the generator's Adjustment line makes the invoice total = Σ Suggested
  Price), and **formula values are not API-readable** — so any real change to this
  formula must be made + verified in the Notion UI, never blind via the API.

## ② Retire the copy-a-secret buttons — DONE (superseded)

**Resolved** by the Phase-3 "Staff authentication for internal tools" card rather
than by moving to native Notion buttons: every `?secret=<CRON_SECRET>` link became
a tool on the signed-in `/studio` dashboard, and the routes behind them were
deleted. See [studio-internal-tools.md](studio-internal-tools.md) for what
replaced what, and for the remaining owner runbook (delete the four formula-link
properties in Notion, then rotate `CRON_SECRET`).

Two findings from this investigation are still worth keeping, because they are why
"move to native buttons" was never the answer:

- **Native Notion "button" properties can't be created via the API** (no BUTTON
  type in the schema DDL; button actions are UI-only), and a native button can't
  interpolate the row's Order Number into its URL — the very reason these were
  formula-links. So that half was always a Notion UI job.
- **Rotating `CRON_SECRET` is a Vercel dashboard action** (`openssl rand -hex 32`
  → the project's Environment Variables → redeploy). No repo code change. Do
  **not** commit an actual secret to the repo.
