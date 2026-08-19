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

## The three gates, in the order they bite

1. **A session.** Signed out, the page redirects to `/account/login`.
2. **`STUDIO_STAFF_EMAILS`** must contain the signed-in address. It **fails
   closed** — unset means nobody is staff.
3. **The session must have come through Google** (`amr` = `oauth`), because
   `STUDIO_REQUIRE_GOOGLE` **defaults on**. A password or magic-link session on
   an allowlisted address is a 403; the page's own **Continue with Google**
   button is the fix (it signs out first, or Supabase hands back the same
   session).

Gates 2 and 3 both render as a 403 with the server's message shown verbatim, so
the page tells you which one you failed.

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

The dashboard exists **only on `development`** (PRs #181 and #182 merged there,
not to `main`), so it is not on the production site. Anything touching it must
be based on `development` — a branch cut from `main` has no `pages/studio.tsx`
at all.
