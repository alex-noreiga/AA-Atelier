# Setup guide — appointment scheduling (Google Calendar + working hours)

This walks through everything needed to turn on **appointment booking**. Conflicts
come from Google: each staff member's Google Calendar free/busy is subtracted
from their working hours, and bookings are written as calendar events (with a
Google Meet link for virtual). The bookable **working hours** themselves live in
the app's own Postgres database, edited from the **studio dashboard**, no
redeploy needed.

You do this once. Plan ~20 minutes. You'll need:

- A **Google Cloud** account (to create the service account + key).
- **Google Workspace admin** access (for the one domain-wide-delegation step).
- The **Supabase** Postgres connection strings (the Vercel integration supplies
  them) — the working hours are a table there.
- **Vercel** project access (to set the environment variables).

> The rest of the app (orders, shop, contact) has its own env vars — see
> [`.env.example`](.env.example). This guide covers the appointment feature.

---

## Part A — Create the Google service account + key

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and
   select (or create) a project.
2. **Enable the API** — search it in the top bar and click **Enable**:
   - **Google Calendar API**
3. **Create a service account:** _APIs & Services → Credentials → Create
   credentials → Service account_. Name it (e.g. `atelier-scheduler`) and click
   **Done**. It needs no roles.
4. Open the service account and note two things:
   - its **email** — looks like
     `atelier-scheduler@your-project.iam.gserviceaccount.com` (the `client_email`
     in the key file);
   - its **Unique ID** (a long number) — the "Client ID" for Part B.
5. **Create a JSON key:** on the service account, open the **Keys** tab →
   _Add key → Create new key → JSON_. A `.json` file downloads. **Its entire
   contents are the value of `GOOGLE_SERVICE_ACCOUNT_KEY`.** Keep it secret; don't
   commit it.

> **If steps 1 or 5 are blocked** by your organization (a "select a parent
> resource" error on project creation, or a greyed-out "Create key" button),
> that's an org security policy. Either have a Google Cloud admin grant the
> exception (Project Creator role / an override of
> `iam.disableServiceAccountKeyCreation` for this project), or create the project
> under a personal Google account — the credential still works for your Workspace
> because delegation (Part B) is authorized separately by the Client ID.

---

## Part B — Authorize calendar access (domain-wide delegation)

This lets the service account act _as_ each staff member — read their free/busy,
create events on their calendar, invite the customer, and make Meet links. Do
this at **[admin.google.com](https://admin.google.com)** as a Workspace admin.

1. **Security → Access and data control → API controls**.
2. **Manage Domain-Wide Delegation → Add new**.
3. **Client ID:** paste the service account's **Unique ID** (from Part A, step 4).
4. **OAuth scopes:** paste exactly:
   ```
   https://www.googleapis.com/auth/calendar
   ```
5. **Authorize.**

> This delegation is **only** for Calendar. The working hours (Part C) live in
> the app's own database and don't involve Google at all.

---

## Part C — Create the working-hours table

This is the "when are we open" schedule. It lives in the app's own Postgres
database (the same Supabase project as sign-in), and you edit it on the studio
dashboard any time; the site picks up changes within about a minute, with no
redeploy.

### 1. Create the table

The table ships as a migration, so this is one job run — not something to build
by hand:

1. Make sure the repo has a **`POSTGRES_URL_NON_POOLING`** secret (the Supabase
   **direct** connection string, port 5432 — DDL can't go through the pooler).
   The Supabase→Vercel integration provides both URLs; copy the direct one into
   _GitHub → Settings → Secrets and variables → Actions_ if it isn't there.
2. Run the **DB migrate** workflow: _GitHub → Actions → DB migrate → Run
   workflow_. It applies every migration in `supabase/migrations/` that hasn't
   been applied yet, each in a transaction.

Locally the same thing is `pnpm --filter @workspace/api-server db:migrate` with
`POSTGRES_URL_NON_POOLING` set in your `.env`.

> **Why not Notion, like the rest of the studio's settings?** Because nobody
> edits this in Notion — the dashboard is the only thing that writes it, and the
> booking calculator is the only thing that reads it. Keeping it in Postgres also
> puts the rules in the database: real time-of-day columns, and a constraint that
> makes hours ending before they start impossible to store rather than merely
> refused.

### 2. Enter the hours on the dashboard

Once `POSTGRES_URL` is set (Part D) and the site has redeployed, sign in and open
**/studio → Working hours**, then **Add hours** for each block someone works:

| Who       | Booking calendar            | Days    | From  | To    | Bookable for       |
| --------- | --------------------------- | ------- | ----- | ----- | ------------------ |
| Alexandra | alexandra@a3iceanddance.com | Mon–Fri | 10:00 | 17:00 | In person, Virtual |
| Alayna    | alayna@a3iceanddance.com    | Sat     | 11:00 | 16:00 | Virtual            |

Add as many blocks as you need — split shifts, different hours per day, a
Saturday that's virtual-only. Two things the editor won't let you save, because
they'd produce hours nothing could be booked into: a person the studio doesn't
book, and an end time before the start time.

**A day off is not an edit here.** Block it on the staff member's Google Calendar
and it's subtracted automatically — this table is the standing week.

---

## Part D — Set the environment variables in Vercel

1. Go to **[vercel.com](https://vercel.com)** → your project.
2. **Settings** (top tab) → **Environment Variables** (left sidebar).
3. Add each variable below with **Add Another** / **Save**. For each, tick the
   environments you want it in — at least **Production** (add **Preview** too if
   you want booking to work on preview deploys):

   **Required**

   | Key                          | Value                                                                                                                                                                          |
   | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `GOOGLE_SERVICE_ACCOUNT_KEY` | The **entire contents** of the JSON key file from Part A. Paste it verbatim — the escaped `\n` newlines inside are handled correctly.                                          |
   | `POSTGRES_URL`               | The **pooled** Supabase connection string (port 6543). Booking reads the working hours from it, so it is required here even though the rest of the Postgres layer is optional. |

   **Optional (sensible defaults if unset)**

   | Key                                | Default                             | Notes                                                                                                 |
   | ---------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
   | `APPOINTMENT_TIMEZONE`             | `America/Chicago`                   | Set your actual IANA zone (e.g. `America/Toronto`). Working hours + slot times are read in this zone. |
   | `APPOINTMENT_MIN_LEAD_HOURS`       | `24`                                | How far ahead a slot must be to be bookable.                                                          |
   | `APPOINTMENT_MAX_ADVANCE_DAYS`     | `45`                                | How far into the future booking is allowed.                                                           |
   | `APPOINTMENT_SLOT_STEP_MINUTES`    | `15`                                | The grid slots snap to within working hours.                                                          |
   | `RESEND_APPOINTMENTS_FROM_EMAIL`   | falls back to `RESEND_FROM_EMAIL`   | Send booking mail from a separate address, e.g. `A.A Atelier <appointments@a3iceanddance.com>`.       |
   | `ATELIER_APPOINTMENTS_INBOX_EMAIL` | falls back to `ATELIER_INBOX_EMAIL` | Copy of each booking to a separate inbox.                                                             |

4. **Redeploy so the variables take effect.** Environment-variable changes only
   apply to _new_ deployments. Either:
   - **Deployments** tab → the latest deployment → the **⋯** menu → **Redeploy**; or
   - push any commit to the branch Vercel deploys.

> For **local development**, put `GOOGLE_SERVICE_ACCOUNT_KEY`, `POSTGRES_URL`
> and `POSTGRES_URL_NON_POOLING` in your repo-root `.env` (see `.env.example`).

---

## Part E — Verify it works

1. After the redeploy, open the site's **Book an Appointment** page and pick a
   purpose and format — open times should appear.
2. **Prove the calendar link is live:** add a busy event on a staff member's
   Google Calendar _inside_ their working hours, reload the booking page, and
   confirm that time disappears from the available slots.
3. **Prove booking works:** book a slot, then check that the event lands on the
   staff calendar, the customer receives a Google Calendar invite, and a virtual
   booking includes a Google Meet link.
4. **Prove the hours are live:** change a time under **/studio → Working hours**
   and confirm the offered slots shift within about a minute — no redeploy
   needed.

### If no slots show up

- The domain-wide-delegation scope must be **exactly**
  `https://www.googleapis.com/auth/calendar` (a typo or a narrower scope silently
  blocks it).
- There must be **working hours on record** — an empty schedule offers no times.
  Check **/studio → Working hours**; the dashboard says so plainly when it's
  empty.
- If that page shows an error rather than an empty state, the **migration hasn't
  run** or `POSTGRES_URL` isn't set for that environment.
- Confirm the **Calendar API** is enabled on the Google Cloud project.
