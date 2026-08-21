# Materials restock alerts

Roadmap card #3. The atelier's **"materials inventory"** database has carried a
`Minimum Stock`, a `Stock on Hand` formula and a `Restock Alert` formula per material
since long before the app existed. The app had never read that database at all, so the
alerts only existed for whoever thought to open it mid-project. This is the read.

Two surfaces: the studio dashboard's **Materials** panel (`GET /api/studio/materials`,
`requireStaff`) and a **weekly digest email** riding the nightly reconciliation. The
app never writes materials stock.

## Why it's shaped this way

- **`Restock Alerts On/Off` SUPPRESSES; the name lies.** The property reads like an
  enable switch. Its Notion description says the opposite — "Check this to suppress
  restock alerts for fabrics or materials that do not need restocking" — and the data
  agrees: 8 of the 9 rows that carry a reorder point are _unticked_, while 21 rows are
  ticked. Reading it as an enable flag inverts the entire panel (it would show only the
  muted materials). The constant is named `MATERIAL_ALERTS_SUPPRESSED_PROPERTY` for
  exactly this reason.

- **The trip is re-derived in code rather than read off the atelier's `Restock Alert`
  formula.** The obvious read is "ask Notion for the rows where the formula trips". Two
  reasons it isn't:
  1. A `formula: {…}` **filter** on a formula derived from rollups 400s through the API
     ("Unable to filter based on a formula of unknown type") — the same wall
     `Milestone Status` hit, see `phase2-workspace-cards.md`. `Stock on Hand` is a
     formula over two rollups and `Restock Alert` sits on top of it, so it's the same
     shape.
  2. The formula's _rendered value_ is display wording (emoji, phrasing) the atelier can
     restyle at any time. Matching on a string nobody promised to keep is a silent
     breakage waiting to happen.

  Deriving `stockOnHand <= minimumStock` also produces the **`shortfall`** the panel and
  the digest rank by, which a display string can't. **The cost is a duplicated rule** —
  change what counts as low in the Notion formula and `materials.service.ts` must change
  too. Same category as `STATUS_IN_STOCK`.

- **At the reorder point counts.** `<=`, not `<`: a reorder point is the level you buy
  AT, not one you wait to fall under. Landing exactly on it gives `shortfall: 0` and
  still appears.

- **Unknown stock is never an alert.** `Stock on Hand` is absent on a material with no
  intake lines, and absent is **not zero** — "we have none" and "we have never counted"
  are different claims, only one of which is a reason to buy. Such a row goes to
  `untracked` with `reason: "stock-unknown"`.

- **The untracked list is the feature, not a footnote.** Only **9 of 50** materials
  carry a `Minimum Stock`. A strict alert list would therefore look reassuringly empty
  while saying nothing about the other 41 — the failure mode where the panel is _worse_
  than no panel. They're listed separately (collapsed, alphabetical, carrying whatever
  stock is known, which is what you need to pick a threshold). The roadmap card's "the
  reorder points are already set" is not accurate; this is the honest version.

  Muted materials are in **neither** list and only **counted**, so the numbers add up
  without the panel arguing with a decision the atelier already made.

- **The digest reports STATE, and that is what makes it idempotent.** This was the
  design question: "email when one trips" needs to remember what it has already said,
  or it re-sends every night for the weeks a material sits below its point — which is
  exactly why the back-in-stock sweep needed a Postgres table. A weekly digest of what
  is _currently_ low sidesteps it entirely: run it twice, it says the same true thing.
  **No sent-marker, no new table, no re-arm logic.** It also reads the way the atelier
  actually buys — one list, one trip.

  It fires only on `MATERIALS_DIGEST_WEEKDAY` (default Monday), read in the **studio
  timezone** so "Monday" is the atelier's Monday, not UTC's. Accepted limit: the weekday
  check is the whole guard, so a double-fire of the nightly cron on digest day sends two
  copies. It's an internal email; that's cheaper than a marker store for a message that
  is safe to repeat.

- **Silence when nothing is low.** A weekly "all good" trains the reader to ignore the
  sender, and the dashboard panel already answers "is anything low?" on demand.

- **No new cron.** It's a sixth pass on `reconcileMilestones`, next to the fitting,
  payment, back-in-stock and appointment-reminder passes — same reason as all of them
  (Vercel Hobby caps cron jobs). It's therefore also reachable on demand through the
  dashboard's **Reconcile production milestones** tool, which reports what it sent.

## Gotchas

- **`configured: false` is a real state, not an error.** An unset
  `NOTION_MATERIALS_DATABASE_ID` returns empty lists with the flag false, and the panel
  renders the reason. Rendering an empty alert list instead would read as "all good" —
  the most dangerous possible way to be wrong here.

- **The scan is unfiltered and bounded.** Nothing to filter on (see above), so it's a
  full `scanDatabase` like the studio analytics, with the usual 60s TTL and
  fall-back-to-stale-on-error. A Notion blip degrades to slightly stale numbers rather
  than an empty shopping list.

- **Setup is one env var and one share.** Every property already exists. The thing that
  actually makes the feature useful is setting `Minimum Stock` on more than 9 materials
  — that's atelier data entry, not code.
