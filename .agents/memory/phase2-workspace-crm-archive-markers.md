# Phase-2 Workspace — CRM record, archiving, marker corral, manual-entry templates

A pass over four more Phase-2 "Workspace" roadmap cards (the Notion databases /
formulas / views behind the app). Same pattern as `phase2-workspace-cards.md`
and `notion-p2-duplicates.md`: **apply what's safe via the Notion API, document
the UI-only rest, and record what the deployed app depends on so nothing
load-bearing is pruned.** All changes here are **purely additive** (new
properties, new views, a template default) — nothing renamed or deleted, so the
app (which reads/writes Notion by exact property name) is untouched.

Live data-source ids used (this workspace, `{ hi, alex }`
`d474cf59-4b91-4e3f-8681-67ab76d76735`):

- Custom Orders `944a7e5a-b47f-40e4-87d2-f4743f08428f` (db `72ab2818…`)
- shop orders `a9382cb0-5542-4111-9049-3f9987073598` (db `2a17f750…`)
- Client CRM `1260ae2e-f32f-402f-9ead-128fe97587da` (db `cc6c9305…`)
- invoices & payments `d64a9c2f-bd5b-432b-9e47-2439bff27905`
- Production Schedule `1cf6166a-e1bc-4e36-8417-d6db98d5501e`

## What the app depends on (verified against the codebase, so it stays safe)

- The app **never reads any Client CRM rollup** — `clients.repository.ts` reads
  only `Email`, `Status`, `Last Contact`, and the reward fields. So adding
  rollups is invisible to the app.
- The app reads the order **`Stage`** _positionally_ — `services/delivery.ts`
  `orderDelivered()` treats the **last** option in the live `fetchLiveOrderStages`
  list as "delivered" (drives the review gate + schedule). **This is why the
  archive marker is a `checkbox`, NOT a new `Stage` option** — an "Archived"
  Stage after "Delivered" would silently become the delivered position and break
  the review gate, milestone scheduling, and the account portal. Never add
  Archived to the Stage status.
- The app **does not write `Stage` on order create** (`orders.blocks.ts`
  `buildOrderProperties` omits it — a new page inherits the Notion Stage **status
  default**), and it writes **`Measurement Unit`** only when the customer supplied
  measurements. So a hand-entered order can miss `Measurement Unit` (and the app
  reads it back for the account portal's measurement history) → the template fix
  below.
- The app reads nothing named `Archived` / `Created` — both are additive.

## ① Client CRM rollups — "a record, not a list" — APPLIED (Notion only)

**Finding: mostly already present.** The CRM already had `Order Count` (count of
`Orders`), `Lifetime Value` (sum of the linked invoices' `Final Balance`),
`Paid to Date` (sum of invoices' `Paid to Date`), and `Order Stages` (status
rollup). The card's genuinely-missing pieces were **first/last order date** and
any **shop-order** visibility (the existing count/value are custom-order-only, so
a shop-only customer read as "0 orders / $0").

- **Applied — added a `Created` (`created_time`) property to Custom Orders**
  (`ADD COLUMN "Created" CREATED_TIME`), because a rollup needs a real date
  property to aggregate (Notion has no "roll up the related page's creation time"
  without one). `created_time` **is** a valid `update_data_source` DDL type even
  though it isn't in the tool's short type list.
- **Applied — four rollups on Client CRM:**
  - `First Order Date` = `ROLLUP('Orders', 'Created', 'earliest_date')`
  - `Last Order Date` = `ROLLUP('Orders', 'Created', 'latest_date')`
  - `Shop Order Count` = `ROLLUP('Shop Orders', 'Order Name', 'count')`
  - `Shop Revenue` = `ROLLUP('Shop Orders', 'Total', 'sum')`
- **Applied — two blended formulas** (custom + shop, so the record shows one
  number each): `Total Orders` = `prop("Order Count") + prop("Shop Order Count")`
  and `Total Lifetime Value` = `prop("Lifetime Value") + prop("Shop Revenue")`.
  (Number-sum/count rollups read fine in a formula — only status/select rollups
  error; and **no parens in the column name** or the FORMULA DDL parser breaks,
  hence "Total Lifetime Value", not "Lifetime Value (All)".) They read as plain
  numbers — set the dollar format on `Total Lifetime Value` in the UI if wanted.
- **Applied — a `Clients` table view** (`view://3b9da6fa-c638-8120-a910-000c7b83f9cb`)
  that leads with the record fields (name, status, contact, the counts +
  `Total Orders`, the revenue rollups + `Total Lifetime Value`, paid-to-date,
  first/last order date, last contact, order stages, the relations, referral
  code) and **omits the reward markers** (see ③).
- **Known limits (documented, not bugs):** `First/Last Order Date` span **custom
  orders only** (one rollup can't merge two relations; shop dates live on
  `shop orders.Order Date`). `Lifetime Value` sums the custom invoice balances
  (full invoice, not just paid) and `Shop Revenue` sums **all** shop `Total`s incl.
  voided/refunded (a DDL rollup can't filter), so `Total Lifetime Value` inherits
  both — a contracted-value figure, not strictly collected cash (`Paid to Date` is
  the collected-cash number).

## ② Archiving convention for finished orders — APPLIED (Notion only, app-safe)

Delivered-and-paid orders never left the active pipeline, so working views grew
without bound.

- **Applied — an `Archived` `checkbox`** on **Custom Orders** and **shop orders**
  (`ADD COLUMN "Archived" CHECKBOX`). A checkbox, deliberately **not** a Stage /
  Status option (see "what the app depends on" — an Archived Stage would break the
  positional delivered gate).
- **Applied — two views per database:** an **`Active Orders`** table
  (`FILTER "Archived" = false`, sorted by due/order date) and an **`Archived`**
  table (`FILTER "Archived" = true`). Custom Orders:
  Active `view://3b9da6fa-c638-8160-8592-000ce334c00b`,
  Archived `view://3b9da6fa-c638-81f3-9d2d-000ccc97f598`. shop orders:
  Active `view://3b9da6fa-c638-8127-b436-000c037221f5`,
  Archived `view://3b9da6fa-c638-8155-8b0b-000c94007827`. The `Archived` checkbox
  stays visible in the Active view so the atelier can tick-to-archive in place.
- **Runbook (UI-only):** set **Active Orders** as the database's **default view**
  (drag it first / set default — the API can't mark a view default), and tick
  `Archived` on the already delivered-and-paid orders to seed the split. Archiving
  is a pure view-cleanliness convention: no cron re-touches an archived order
  (milestones already generated, invoice paid, order delivered), and the app never
  filters on it — a customer can still track/portal an archived order.

## ③ Corral the app's bookkeeping markers into "System" — PARTLY APPLIED + runbook

A dozen app-owned idempotency/system fields clutter human-facing databases. The
inventory, per database:

- **Custom Orders:** `Last Notified Stage`, `Milestones Generated`,
  `Stage Index Sys` (feeds the Production Schedule `Milestone Status` formula).
  (`Generate Invoice API Call` / `Send Status Update` are **actionable** formula
  links the atelier clicks — left visible; they're card ②'s "retire the
  copy-a-secret buttons", not markers.)
- **Client CRM:** `Referral Rewarded`, `Referred By Email`, `First Paid Order`,
  `Returning Reward Issued`, `Referral Credit Code`, `Returning Discount Code`.
  (`Referral Code` left visible — the atelier may want to share it.)
- **Production Schedule:** `Reminder Sent` (+ the leftover `Status` status-property
  that card ③ of `phase2-workspace-cards.md` marks for post-deploy deletion).
- **invoices & payments:** the `*Session Id` Stripe ids; and — once the payment-
  reminder setup lands — `First/Second Deposit Reminded` + `Balance Reminded`
  (not present yet).

- **Applied (API-possible):** the curated views above **hide** the markers from
  the working board — the Custom Orders Active/Archived views `HIDE` the three
  order markers; the CRM `Clients` view omits the six reward markers.
- **Runbook (UI-only — the API can't create property _groups_ or reorder the
  schema):** in each database's page-detail / property editor, drag the marker
  properties listed above into a **collapsed "🔧 System" property group** so
  they're grouped-and-hidden on the record page, not just the table. This is the
  card's "collapsed System section" and is a few minutes of drag-in-the-UI.

## ④ Database templates for manual order entry — APPLIED (custom) + runbook (shop)

A hand-created order can silently miss the fields the app reads (see "what the app
depends on"): `Stage` (the tracking timeline + delivered gate) and
`Measurement Unit` (the portal's measurement history).

- **Applied — fixed the existing Custom Orders template** "✨ Your Custom Dress —
  [Client Name]" (`d9f3049eafb442a1ab7f7aa13e928d78`): it pre-filled a lovely
  customer-facing page body but left **Stage and Measurement Unit blank**. Set the
  template defaults `Stage = "Consultation"` (earliest stage) and
  `Measurement Unit = "inches"` via `update_page` → `update_properties`. Editing a
  database template page's property values sets what new rows inherit, so every
  order created from this template now starts at Consultation with a unit set. Per-
  order fields (`Order Number`, `Email`, measurements) still get filled by hand.
- **Runbook (UI-only — the API can't create a _new_ database template, only edit an
  existing one):** add a **shop orders** template ("Manual / Etsy order") that
  pre-fills `Status = "New"`, `Sales Channel = "Etsy"` (or Skate Shop), and today's
  `Order Date`; the per-order `Order Number` (`SHP-…` / Etsy id), `Customer Email`,
  `Total`, and `Items` are filled by hand. (The webhook path mints its own
  `SHP-` number + email; this template is only for orders keyed in by hand.)

## Notion API gotchas confirmed this pass (add to the running list)

- `created_time` **is** a valid DDL column type for `update_data_source`
  (`ADD COLUMN "Created" CREATED_TIME`) despite not being in the tool's short type
  list — and a `created_time` property is rollup-able with `earliest_date` /
  `latest_date`.
- Rollup DDL takes **property names**, not ids:
  `ROLLUP('<relation prop>', '<target prop on the related db>', '<function>')`;
  `count` / `sum` / `earliest_date` / `latest_date` all work.
- View DSL checkbox filter: `FILTER "Archived" = false` / `= true` (bare boolean)
  compiles to `checkbox_is_not` / `checkbox_is`.
- A view's **default** flag and property **groups/sections** and **new database
  templates** are **not** API-reachable — those are the UI-only runbook items above.
