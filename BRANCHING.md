# Branching & release strategy

How code reaches the live site (a3iceanddance.com), and how to ship features
deliberately instead of every merge to `main` going straight to production.

## The two branches

| Branch    | Role                                                                                                                                                | Vercel deploys it as                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `main`    | **Integration.** Feature branches merge here via pull request, exactly as before. Always green, always releasable — but not automatically released. | **Preview** (stable alias `aa-atelier-git-main-a3iceanddance.vercel.app`) |
| `release` | **Production.** Only ever receives code promoted from `main` (or an emergency hotfix). What is on this branch is what customers see.                | **Production** (a3iceanddance.com)                                        |

Feature work is unchanged: branch off `main`, open a PR, merge when CI is
green. The difference is that merging to `main` no longer publishes anything —
it lands the feature on the integration preview, where it can sit alongside
other in-flight features until you choose to release.

## Promoting to production

When the state of `main` is ready to ship (one feature or several — whatever
has accumulated):

```bash
git fetch origin
git checkout release
git merge --ff-only origin/main
git push origin release
```

The push triggers a Vercel **production** deployment. `--ff-only` is
deliberate: it guarantees `release` is a pure snapshot of a commit that already
passed CI on `main` — no new merge commit, no code that was never on `main`.
If the fast-forward is refused, `release` has commits `main` doesn't (a
hotfix); merge `release` back into `main` first (see below), then promote.

Prefer promoting via a **pull request from `main` into `release`** when you
want a review trail or a place to write release notes — same result, and CI
runs on the PR. Use the merge button's ordinary merge (never squash — squashing
would rewrite the promoted commits and break the next fast-forward).

After promoting, verify: the Vercel dashboard shows a new Production
deployment, and the daily smoke suite (`.github/workflows/smoke.yml`) runs
against the apex domain, so it now exercises exactly what `release` shipped.

## Shipping one feature ahead of the rest

The model promotes `main` wholesale — everything merged so far. That's the
right default: features are tested together on the integration preview, and
partial promotion is where drift and conflicts come from. If something truly
must ship while unrelated work on `main` isn't ready:

- **Best:** hold the not-ready work out of `main` (keep it on its feature
  branch, or behind one of the app's existing env-var gates) and promote
  normally. Most features here already degrade to "off" when their env var or
  Notion property is absent — that is the repo's own feature-flag mechanism.
- **Escape hatch:** cherry-pick the feature's merge commit onto `release`
  (`git cherry-pick -m 1 <merge-sha>`). This forfeits the fast-forward
  guarantee until the next full promotion catches `release` up, so treat it as
  a hotfix, not a workflow.

## Versions & rolling back

Every push to `release` is tagged automatically by
`.github/workflows/release-tag.yml`: a CalVer tag in the studio's timezone
(`v2026.08.27`, then `v2026.08.27.2` if the same day ships twice) plus a
GitHub **Release** whose notes list the PRs since the previous tag — the
record of what each promotion shipped. Nothing to do by hand; the tags are
the rollback points.

Three ways back, from fastest to most surgical:

1. **Vercel Instant Rollback** (production is broken _right now_): Vercel
   dashboard → Deployments → the last good Production deployment → ⋯ →
   **Instant Rollback**. Live in seconds, no git involved — but it's a
   holding action: the next push to `release` deploys whatever `release`
   says again, so follow up with one of the git options.

2. **Revert one feature** (the rest of the release is fine):

   ```bash
   git checkout release
   git revert -m 1 <merge-sha-of-the-feature-PR>   # find it in the release notes
   git push origin release
   ```

   Production redeploys without that feature. Then merge `release` back into
   `main` (as after a hotfix) so `main` agrees. To re-land the feature later,
   revert the revert — git considers reverted code "already merged", so just
   merging the original branch again won't bring it back.

3. **Return to a previous version wholesale** (`release` should be exactly
   what `vX` was):

   ```bash
   git checkout release
   git rm -r --quiet .          # clear the tracked tree…
   git checkout <tag> -- .      # …and restore the tagged version of every file
   git commit -m "Roll back to <tag>"
   git push origin release
   ```

   One new commit whose content is byte-for-byte the tagged release — history
   keeps moving forward, so the branch protection and the next promotion
   still work. (A range `git revert` doesn't work here: the range contains
   PR merge commits, which git refuses to revert in bulk.) Note the next
   `main` → `release` promotion re-includes everything, so hold `main` until
   the problem is fixed there, or land the fix on `main` first and promote
   past the rollback. Avoid `git reset --hard <tag>` + force-push: it fights
   the ruleset and rewrites history other clones may hold.

A tag is also the honest answer to "what exactly was live last Tuesday?" —
`git checkout v2026.08.25` rebuilds it.

## Hotfixes (production is broken, `main` has moved on)

```bash
git checkout -b hotfix/<what> release
# fix, commit, open a PR into release
```

After it merges and deploys, **merge `release` back into `main`** so the fix
isn't lost and the next `--ff-only` promotion works again:

```bash
git checkout main
git merge release
git push origin main
```

## One-time setup (manual, in this order)

1. **Create the branch** from the current production state:
   ```bash
   git fetch origin
   git checkout -b release origin/main
   git push -u origin release
   ```
2. **Flip Vercel's production branch:** Vercel dashboard → `aa-atelier` →
   Settings → **Git** → **Production Branch** → `release` → Save. From then on
   pushes to `release` deploy production and pushes to `main` deploy previews.
   (This is a dashboard setting; `vercel.json` cannot express it.)
3. **Check Preview environment variables.** Vercel env vars are scoped
   Production / Preview / Development. `main` deploys now run with the
   **Preview** scope, so any var only set for Production (Notion ids, Stripe
   test keys, Supabase, …) should be reviewed — otherwise the integration
   preview degrades to whatever the missing var's fallback is. Use **test-mode**
   Stripe keys and ids in Preview (they're mode-scoped — see CLAUDE.md).
4. **(Recommended) Protect `release` on GitHub:** Settings → Branches → add a
   ruleset for `release` requiring the CI checks and blocking force pushes, so
   production can only move through a green promotion.

## What is unaffected

- **Vercel Cron** (`/api/cron/generate-milestones`) runs against the current
  production deployment, so it follows `release` automatically.
- **Database migrations** (`migrate.yml`) are out-of-band and manual; run them
  before promoting a change that needs a new table, exactly as before.
- **CI** runs on every PR and on pushes to both `main` and `release`
  (`ci.yml`); CodeQL keeps scanning `main`, which is where all promoted code
  originates. The tag workflow (`release-tag.yml`) runs alongside CI on each
  `release` push and never blocks a deploy — Vercel deploys from the push,
  not from the workflow.
- **The smoke suite** targets the deployed apex domain, i.e. production —
  unchanged, and now the post-release check.
