# Setup guide — appointment scheduling (Google Calendar + Sheet)

This walks through everything needed to turn on **appointment booking**. It runs
on Google: each staff member's Google Calendar free/busy is the conflict source,
bookings are written as calendar events (with a Google Meet link for virtual),
and the bookable **working hours** live in a Google Sheet the atelier edits live.

You do this once. Plan ~20 minutes. You'll need:

- A **Google Cloud** account (to create the service account + key).
- **Google Workspace admin** access (for the one domain-wide-delegation step).
- **Vercel** project access (to set the environment variables).

> The rest of the app (orders, shop, contact) has its own env vars — see
> [`.env.example`](.env.example). This guide covers the appointment feature.

---

## Part A — Create the Google service account + key

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and
   select (or create) a project.
2. **Enable two APIs** — search each in the top bar and click **Enable**:
   - **Google Calendar API**
   - **Google Sheets API**
3. **Create a service account:** *APIs & Services → Credentials → Create
   credentials → Service account*. Name it (e.g. `atelier-scheduler`) and click
   **Done**. It needs no roles.
4. Open the service account and note two things:
   - its **email** — looks like
     `atelier-scheduler@your-project.iam.gserviceaccount.com` (you'll share the
     Sheet with this, and it's also the `client_email` in the key file);
   - its **Unique ID** (a long number) — the "Client ID" for Part B.
5. **Create a JSON key:** on the service account, open the **Keys** tab →
   *Add key → Create new key → JSON*. A `.json` file downloads. **Its entire
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

This lets the service account act *as* each staff member — read their free/busy,
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

> This delegation is **only** for Calendar. The Sheet (Part C) does not use it —
> it's shared directly instead.

---

## Part C — Create the working-hours Google Sheet

This is the "when are we open" schedule. The atelier edits it any time; the site
picks up changes within about a minute, with no redeploy.

### 1. Create the sheet

Make a new Google Sheet. In the **first tab**, put these headers in **row 1**,
then one row per working block starting at **row 2**:

| A: Staff | B: Email | C: Day | D: Start | E: End | F: Locations |
|----------|----------|--------|----------|--------|--------------|
| Alexandra | alexandra@a3iceanddance.com | Mon-Fri | 10:00 | 17:00 | in-person, virtual |
| Alayna | alayna@a3iceanddance.com | Sat | 11:00 | 16:00 | virtual |

- **Staff** — must match the names in the app's catalog (currently `Alexandra`
  and `Alayna`).
- **Email** — that person's Google Workspace calendar (the one read/written).
- **Day** — a single day, a comma list (`Mon,Wed`), or a range (`Mon-Fri`);
  `Mon` or `Monday` both work.
- **Start / End** — 24-hour `HH:MM`, in your booking timezone.
- **Locations** — comma-separated: `in-person`, `virtual` (a `virtual`-only block
  won't offer in-person slots).

Add as many rows as you need (split shifts, different hours per day, etc.).

### 2. Share the sheet with the service account

The service account reads the sheet as *itself*, so you grant it access by simply
sharing the sheet with its email:

1. Open the sheet and click the green **Share** button (top-right).
2. In **Add people and groups**, paste the service account's email — the
   `atelier-scheduler@your-project.iam.gserviceaccount.com` address from Part A.
   (It's also the `client_email` in your JSON key file.)
3. Set its role to **Viewer** (read-only is all it needs).
4. **Uncheck "Notify people"** — a service account has no inbox, so there's
   nobody to email.
5. Click **Share** (or **Done**).

That's it — no domain-wide delegation for the Sheet; the direct share is enough.

### 3. Copy the sheet ID

The ID is the long token in the sheet's URL, between `/d/` and `/edit`:

```
https://docs.google.com/spreadsheets/d/1AbC…long…XyZ/edit#gid=0
                                        └──────── this ────────┘
```

You'll paste it into `APPOINTMENT_SHEET_ID` next.

---

## Part D — Set the environment variables in Vercel

1. Go to **[vercel.com](https://vercel.com)** → your project.
2. **Settings** (top tab) → **Environment Variables** (left sidebar).
3. Add each variable below with **Add Another** / **Save**. For each, tick the
   environments you want it in — at least **Production** (add **Preview** too if
   you want booking to work on preview deploys):

   **Required**

   | Key | Value |
   |-----|-------|
   | `GOOGLE_SERVICE_ACCOUNT_KEY` | The **entire contents** of the JSON key file from Part A. Paste it verbatim — the escaped `\n` newlines inside are handled correctly. |
   | `APPOINTMENT_SHEET_ID` | The sheet ID you copied in Part C, step 3 (just the token, e.g. `1AbC…XyZ` — not the full URL). |

   **Optional (sensible defaults if unset)**

   | Key | Default | Notes |
   |-----|---------|-------|
   | `APPOINTMENT_TIMEZONE` | `America/New_York` | Set your actual IANA zone (e.g. `America/Toronto`). Working hours + slot times are read in this zone. |
   | `APPOINTMENT_SHEET_RANGE` | `A2:F` | Only if your data isn't on the first tab / standard columns, e.g. `Schedule!A2:F`. |
   | `APPOINTMENT_MIN_LEAD_HOURS` | `24` | How far ahead a slot must be to be bookable. |
   | `APPOINTMENT_MAX_ADVANCE_DAYS` | `45` | How far into the future booking is allowed. |
   | `APPOINTMENT_SLOT_STEP_MINUTES` | `15` | The grid slots snap to within working hours. |
   | `RESEND_APPOINTMENTS_FROM_EMAIL` | falls back to `RESEND_FROM_EMAIL` | Send booking mail from a separate address, e.g. `A.A Atelier <appointments@a3iceanddance.com>`. |
   | `ATELIER_APPOINTMENTS_INBOX_EMAIL` | falls back to `ATELIER_INBOX_EMAIL` | Copy of each booking to a separate inbox. |

4. **Redeploy so the variables take effect.** Environment-variable changes only
   apply to *new* deployments. Either:
   - **Deployments** tab → the latest deployment → the **⋯** menu → **Redeploy**; or
   - push any commit to the branch Vercel deploys.

> For **local development**, put `GOOGLE_SERVICE_ACCOUNT_KEY` and
> `APPOINTMENT_SHEET_ID` in your repo-root `.env` (see `.env.example`).

---

## Part E — Verify it works

1. After the redeploy, open the site's **Book an Appointment** page and pick a
   purpose and format — open times should appear.
2. **Prove the calendar link is live:** add a busy event on a staff member's
   Google Calendar *inside* their working hours, reload the booking page, and
   confirm that time disappears from the available slots.
3. **Prove booking works:** book a slot, then check that the event lands on the
   staff calendar, the customer receives a Google Calendar invite, and a virtual
   booking includes a Google Meet link.
4. **Prove the sheet is live:** change a time in the Google Sheet and confirm the
   offered slots shift within about a minute — no redeploy needed.

### If no slots show up

- The domain-wide-delegation scope must be **exactly**
  `https://www.googleapis.com/auth/calendar` (a typo or a narrower scope silently
  blocks it).
- The **Staff** names in the Sheet must match the app's catalog names exactly
  (`Alexandra`, `Alayna`).
- Confirm the sheet is **shared with the service-account email**, and that both
  the **Calendar API and Sheets API** are enabled on the project.
