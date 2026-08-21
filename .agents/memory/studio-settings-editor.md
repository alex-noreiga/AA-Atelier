# Studio settings as a typed form (roadmap card #3)

The atelier-editable settings have lived in a Notion key/value table since the
"Studio Settings" work. This card added the dashboard editor over it:
`GET /api/studio/settings` + `PUT /api/studio/settings/{key}`, rendered by
`web-app/src/components/studio-settings.tsx` on `/studio`.

## What the card was actually complaining about

Not that the settings were hard to edit — they were a Notion table, which is
easy. The problem is that a free-text key/value table **cannot report anything**,
and both halves of a row fail silently:

- a mistyped **key** (`RUSH_SURCHARGE_RAT`, or `Rush Surcharge Rate` typed as
  prose into a title property) is a row nothing has ever read;
- a mistyped **value** (`15%`, `15` for a fraction, `Mars/Olympus` for a zone) is
  read, parsed, rejected, and replaced by the built-in default.

Neither produces an error, a log, or any visible difference in Notion. So the
feature isn't "a prettier table" — it's the two answers the table can't give:
what is in force and where it came from, and which rows aren't settings at all.

## Load-bearing decisions

1. **Two validators per key, and the asymmetry is the point.**
   `lib/settings/catalog.ts` gives each entry an `accepts` (runtime parity —
   "would the getter honour this?") and a `validate` (write guard). `accepts`
   decides whether a stored value is in force or is being ignored, so it must
   never be stricter than the getter, or the panel would claim the app was
   discarding a value it is in fact using. `validate` is deliberately allowed to
   be stricter, because a write is a chance to catch what the runtime would
   happily do something stupid with:
   - `RUSH_SURCHARGE_RATE = 15` (meaning 15%) parses and prices a **1500%**
     surcharge. Refused on write, honoured if already stored.
   - `COLOR_PALETTE = "Emerald #0B6E4F, Navy"` yields a palette with the mistyped
     colour silently missing. Refused on write; the runtime keeps what parses.
   - `APPOINTMENT_TIMEZONE = "Mars/Olympus"` is accepted by the getter (it does no
     validation at all) and throws deep inside the slot maths later. Refused on
     write against `Intl`.

2. **The catalog RESTATES each default; a test binds it to the getter.** The
   defaults live in the getters (`DEFAULT_RUSH_SURCHARGE_RATE` etc.) and are
   repeated in the catalog as display text. `test/unit/settings.catalog.test.ts`
   drives all sixteen real getters with an empty snapshot and no env and asserts
   each lands on the catalog's stated default — plus that a snapshot value reaches
   the getter, and that a value `accepts` rejects is in fact ignored by it. That
   test is the anti-drift guard. Consolidating the defaults _into_ the catalog was
   the alternative; it would have rewritten six well-tested getters to buy the
   same guarantee the test gives for free. `alertInbox` was exported from
   `alert.service.ts` purely so the test could reach it.

3. **The resolution corner the source chip exists for.** Getters read
   `settingValue(KEY) ?? process.env[KEY]` and _then_ parse. So a Notion value
   that can't be used falls back to the **built-in default**, NOT to the
   environment variable sitting behind it — the environment was never consulted.
   `resolveSetting` mirrors that exactly (`source: "default"` +
   `ignoredValue: <the discarded text>`). Reporting `environment` there would be
   wrong in precisely the case someone opens the page to understand.

4. **The editor's read is the row list, uncached, and it throws.** Three
   deliberate departures from `fetchStudioSettings`:
   - **rows, not the key→value map** — a mistyped key isn't in the map at all, and
     a duplicate row loses to whichever came last;
   - **uncached** — the atelier looks at this immediately after saving, and a
     60s-stale answer reads as the save having failed;
   - **throws on failure** — every settings consumer has an env fallback behind
     it, so degrading to an empty map is right there; an editor rendering an empty
     list would just be lying.

5. **A blank value is a clear, and there is no delete.** A blank `Value` reads as
   unset everywhere, so clearing hands the setting back to env/default, and
   keeping the row keeps the key documented in Notion.

6. **The field is seeded from `notionValue`, never `effectiveValue`.** Showing an
   environment value in an editable box would copy it into Notion the instant
   anyone pressed Save, silently moving where that setting lives.

7. **`Description` is seeded on create, with one bounded retry without it.**
   Notion rejects the _whole_ page create when it names a property the database
   lacks, and `Description` is the one property the setup instructions call
   optional — so without the retry, a database missing that column could never
   save any setting at all. Same shape as
   `createPageDroppingUnknownProperties` on the order intake.

8. **A successful write drops the repository's cached map**, so the next
   request's `primeSettings` sees the change. Per-instance, like every other cache
   here — bounded by the 60s TTL on other warm instances.

## Things that will bite

- **Adding a setting is two edits, not one.** A key added to a getter but not to
  `SETTING_DEFINITIONS` still resolves at runtime and is simply invisible to the
  atelier. The catalog test only checks the keys it lists, so it won't catch that.
- **`accepts` must track its getter.** If a getter's parse is ever tightened or
  loosened, `accepts` has to move with it or the panel starts misreporting which
  values are in force. The catalog test covers one usable and one unusable sample
  per key, which is what would fail.
- **Secrets are still not settings.** The write refuses any key outside the
  catalog (`"STRIPE_SECRET_KEY" isn't a setting this app reads`), so the editor
  can't be used to smuggle one into Notion.
- **Duplicate rows: the LAST one wins, on both paths.** `extractSettings` lets the
  last row for a key win, so `saveSetting` writes to the last matching row too —
  writing to the first would report success and change nothing the app reads.
  Duplicates are not otherwise surfaced by the panel (unlike a mistyped key, two
  rows with the same title are visible in Notion).
- **Not yet exercised against live Notion.** Both halves are tested against seams
  — the routes with the repository mocked, the repository with the client faked —
  which is the house pattern, but nothing here has written a real row. Save one
  setting from `/studio` after deploy and check the row in Notion, particularly
  the create path and the `Description` retry.
- **No new env var, no atelier setup.** Same database, same three properties.
