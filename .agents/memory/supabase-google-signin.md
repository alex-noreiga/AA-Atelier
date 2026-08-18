# Google sign-in (Supabase Auth) — setup runbook

`pages/account-login.tsx` has always shipped a **"Continue with Google"** button
(`supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo:
callbackUrl() } })`). **No code change is needed to turn it on** — the button,
the PKCE flow, the `/account/callback` landing page, and the Bearer-token seam
are all already wired (see `account-portal.md`). What was missing is
configuration, in two dashboards: **Google Cloud Console** (create the OAuth
client) and **Supabase → Authentication** (enable the provider + allow the
redirect). Neither is API-reachable from this repo's tooling, so this file is
the version-controlled runbook — the same pattern as `supabase-auth-emails.md`.

## Project facts (fill these in verbatim)

| Thing                                    | Value                                                     |
| ---------------------------------------- | --------------------------------------------------------- |
| Supabase project                         | `supabase-atelier`, ref `nrxfyhootpklhugegzsq`             |
| Supabase URL                             | `https://nrxfyhootpklhugegzsq.supabase.co`                 |
| **Google "Authorized redirect URI"**     | `https://nrxfyhootpklhugegzsq.supabase.co/auth/v1/callback` |
| Google "Authorized JavaScript origin"    | `https://a3iceanddance.com` (+ `http://localhost:5173` for dev) |
| Supabase **Site URL**                    | `https://a3iceanddance.com` (the apex — see below)          |
| Supabase **Redirect URLs** (allow-list)  | `https://a3iceanddance.com/account/callback`, `https://a3iceanddance.com/account/reset`, `http://localhost:5173/**` |

## Step 1 — Google Cloud Console

1. Pick (or create) a project at <https://console.cloud.google.com>. It can be
   the **same** project that holds the Calendar/Sheets service account used for
   appointment booking — an OAuth client and a service account are independent
   credentials and do not conflict.
2. **APIs & Services → OAuth consent screen**: User type **External**. Fill in the
   app name, support email, and developer contact. Scopes: the defaults
   `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` are all the
   portal needs — identity here is only the email address (see
   `account-portal.md`), so **add no other scopes**.
3. **Publish the consent screen.** While it is in "Testing", only the explicitly
   listed test users can sign in; every other customer gets Google's
   "Access blocked: … has not completed the Google verification process". A
   screen requesting only the three non-sensitive scopes above publishes without
   a Google review.
4. **Credentials → Create credentials → OAuth client ID**, type **Web
   application**:
   - *Authorized JavaScript origins* → the origins in the table above.
   - *Authorized redirect URIs* → **the Supabase callback**
     `https://nrxfyhootpklhugegzsq.supabase.co/auth/v1/callback`.
5. Copy the **Client ID** and **Client secret**.

> **The single most common mistake** is putting the app's own
> `https://a3iceanddance.com/account/callback` into Google's *Authorized redirect
> URIs*. Google redirects to **Supabase**, and Supabase then redirects to the
> app. The app callback belongs in Supabase's allow-list (step 2), never in
> Google's.

## Step 2 — Supabase dashboard

1. **Authentication → Sign In / Providers → Google**: toggle **Enable**, paste
   the Client ID + Client secret, Save. (Leave "Skip nonce check" off — it is for
   Google One Tap / native apps, not this web flow.)
2. **Authentication → URL Configuration**:
   - **Site URL** = `https://a3iceanddance.com`.
   - **Redirect URLs** = the allow-list in the table above.

**The Site URL must be the apex, not `www`.** The canonical host is the apex and
`www` 308-redirects to it (see `domain-redirect-loop.md`); pointing Supabase at a
host that immediately redirects is an avoidable way to lose the auth code.

**Vercel preview deployments** get a fresh random hostname each build, so Google
sign-in will fail there until a wildcard such as
`https://aa-atelier-*.vercel.app/**` is added to the Redirect URLs. Production is
unaffected. Adding it is optional — previews can be tested with email+password.

The Client **secret** lives only in the Supabase dashboard. It is not an app env
var, must not be committed, and needs no Vercel entry.

## Step 3 — verify

There is no new env var and nothing to redeploy — the provider list is read by
Supabase at sign-in time, so the change is live immediately. Sign in at
`/account/login` → "Continue with Google", which should land on
`/account/callback` and forward to `/account`.

Confirm server-side that a Google identity was actually created:

```sql
select provider, count(*) from auth.identities group by provider;
```

Before this setup that returned only `email`. A successful Google sign-in adds a
`google` row.

**Account linking:** a customer who already has an email+password account and
then signs in with the same Google address — Supabase links the identities when
the email matches and is verified on both sides, rather than creating a second
user. Worth confirming with the query above on a real account before relying on
it, because the portal is **email-keyed** end to end (`middlewares/auth.ts`
normalizes the token's email and every Notion lookup filters on it), so a
duplicate user would mean a customer seeing an empty dashboard.

## What is deliberately not here

- **No code change.** Do not add a provider list, an env var, or a "Google
  configured?" flag — the button is unconditional and Supabase reports an
  unenabled provider as an error the existing handler already surfaces.
- **No `GOOGLE_SERVICE_ACCOUNT_KEY` involvement.** That credential is the
  Calendar/Sheets service account for appointment booking
  (`appointment-scheduling.md`) and is unrelated to customer sign-in.
