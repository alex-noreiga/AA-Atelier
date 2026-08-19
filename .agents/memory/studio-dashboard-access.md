# Reaching `/studio` — why it looked missing, and the three gates

_Reported as: "on a preview deployment of the development branch I haven't been
able to see the studio staff dashboard."_

## What was actually wrong: nothing linked to it

The dashboard was built with **no entry point anywhere in the UI** — not the
navbar, not the footer, not the account page. `App.tsx` was the only file in the
whole frontend referencing `/studio`, and the page is `noindex`, so it was
absent from the sitemap and the prerender pass too. The only way in was typing
the URL. Working as designed, and invisible in practice.

The Vercel runtime logs confirmed the diagnosis rather than a broken gate: on
the `development` preview the reporter's browser was hitting
`/api/account/overview` **200** and `/api/colors` **200** minutes earlier — a
live session against a healthy API — with **zero** requests to
`/api/studio/analytics`. The page was never opened, so no gate ever refused
anyone. When triaging "I can't see X", check whether X was ever _requested_
before debugging the thing that would have refused it.

**Fixed by** a staff-only nav link (`useStudioAccess` → `GET /studio/access` →
the same `requireStaff` gate). See CLAUDE.md → "Studio analytics dashboard",
point 9. `/studio` still isn't in `NAV_LINKS` and is still `noindex`.

## Then: for staff it replaced the account portal, and became "Dashboard"

The follow-up (point 10) is that the link doesn't sit _beside_ Account — it
takes its place, and `/account` redirects a confirmed staff session to
`/studio`. The reason is the same one behind the original report: a staff
member's customer portal has nothing in it (they don't place orders through the
shop), so both entries led somewhere blank. One signed-in destination, labelled
**Dashboard**.

Three things worth remembering:

- **The URL is still `/studio`.** Only the UI label is "Dashboard" — the API
  routes, `post-signin.ts`, `ROUTE_SEO["/studio"]`'s key, and this note all
  still say studio. Renaming the route would mean touching all of them for no
  user-visible gain.
- **`useStudioAccess()` returns `{ staff, loading }`**, not a bare boolean.
  Anything that _routes_ on the answer must wait for `loading` to clear or a
  staff member sees the empty portal flash past on the way to the dashboard;
  anything that merely _offers_ something can ignore it. `loading` is false
  when the probe is disabled (signed out), so a caller can't be left waiting on
  a request that is never made.
- **`/account` is a one-way door for staff, so sign-out had to move.** It lives
  in the dashboard header _and_ its error state — a failed analytics read with
  no sign-out and `/account` bouncing back here is a trap with no way out.

## The three gates, in the order they bite

1. **A session.** Signed out, the page redirects to `/account/login`.
2. **`STUDIO_STAFF_EMAILS`** must contain the signed-in address. It **fails
   closed** — unset means nobody is staff.
3. **The session must have come through Google** (`amr` = `oauth`), because
   `STUDIO_REQUIRE_GOOGLE` **defaults on**. A password or magic-link session on
   an allowlisted address is a 403; the page's own **Continue with Google**
   button is the fix (it signs out first, or Supabase hands back the same
   session).

Gates 2 and 3 **answer differently**, and that difference is deliberate:

- **Gate 2 (not on the allowlist) → 404.** `/studio` renders the ordinary Not
  Found page, byte for byte what a mistyped URL renders — it returns the real
  `<NotFound />`, not a copy. The dashboard is unlinked and `noindex`, so the
  only way a customer gets there is by typing it, and a 403 would confirm to
  them that something is there to find. There is nothing such a caller can do
  about the refusal, so there is nothing to tell them.
- **Gate 3 (wrong sign-in method) → 403**, with the server's message shown
  verbatim and the **Continue with Google** button that fixes it. Here there
  _is_ something to do, and only someone who already controls a staff mailbox
  can provoke it, so it discloses nothing they didn't know.

Two consequences worth keeping in mind when debugging: a 404 on `/studio` means
**the allowlist**, not a routing bug — check `STUDIO_STAFF_EMAILS` for that
exact address; and the 403 panel now has exactly one cause, so seeing it at all
tells you the allowlist is fine and only the sign-in method is wrong.

Note the allowlist is **exact addresses, not a domain**. An `@a3iceanddance.com`
address that isn't listed in `STUDIO_STAFF_EMAILS` is refused like any customer.

## Preview-deployment specifics (all three have bitten)

- **Vercel env vars are per-environment.** `STUDIO_STAFF_EMAILS` set only on
  Production means every preview 403s. Same for `STUDIO_REQUIRE_GOOGLE` if it's
  being used as the recovery hatch.
- **Supabase's redirect allow-list needs the preview wildcard.** Google sign-in
  redirects to `${window.location.origin}/account/callback`, which on a preview
  is a `*.vercel.app` host. Without
  `https://aa-atelier-git-*-a3iceanddance.vercel.app/**` allow-listed, the round
  trip lands on the production Site URL instead and the preview never gets a
  session. Since gate 3 _requires_ the Google round trip, this breaks studio
  access on previews specifically.
- **Deployment protection is on** (`ssoProtection`, `all_except_custom_domains`),
  so a preview URL needs a Vercel login before the app is even served. Expected;
  it just means an incognito window won't work.

The branch preview lives at
`https://aa-atelier-git-development-a3iceanddance.vercel.app/studio`.

## Note on branches

The dashboard exists **only on `development`** (PRs #181, #182 and #187 merged
there, not to `main`), so it is not on the production site. Anything touching it
must be based on `development` — a branch cut from `main` has no
`pages/studio.tsx` at all, and `main`'s `navbar.tsx` has no staff link.
