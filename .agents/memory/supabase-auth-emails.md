# Supabase Auth email templates (branded)

Customer sign-in runs on **Supabase Auth** (see `account-portal.md`), and the
verify / magic-link / reset emails are sent by **Supabase over Resend SMTP** from
its own template editor — **not** from `lib/resend/emails.ts`. This file is the
version-controlled source of the branded HTML to paste into
**Supabase → Authentication → Emails** (one block per template slot), so the copy
is reviewable in git even though it lives in the Supabase dashboard at runtime.

Styling mirrors the studio's transactional emails (`layout()` in
`lib/resend/emails.ts`): Georgia serif, `#faf8f5` paper, `#2b2622` ink, `#8a7f74`
muted, the uppercase "A.A Atelier" masthead, and the `#2b2622` button. The action
link is Supabase's `{{ .ConfirmationURL }}`.

**Redirect targets** (must be in the Supabase redirect allow-list): magic-link +
confirm-signup land on `${PUBLIC_BASE_URL}/account/callback`; password reset lands
on `${PUBLIC_BASE_URL}/account/reset`. These come from the `emailRedirectTo` /
`redirectTo` the frontend passes (`pages/account-login.tsx`).

**Expiry wording** is intentionally generic ("expire soon") because the real
duration is the Supabase OTP-expiry setting (Auth → Providers → Email, default
~1 hour). Make it concrete only if that setting is pinned.

If updating: edit here first, then paste into the Supabase dashboard — keep the two
in sync by hand (there is no API sync).

---

## 1. Confirm signup

**Subject:** `Confirm your A.A Atelier account`

```html
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f5;">
    <div style="max-width:520px;margin:0 auto;padding:40px 28px;font-family:Georgia,'Times New Roman',serif;color:#2b2622;line-height:1.6;">
      <p style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#8a7f74;margin:0 0 28px;">A.A Atelier</p>
      <h1 style="font-size:22px;font-weight:normal;margin:0 0 20px;">Confirm your email</h1>
      <p style="margin:0 0 16px;">Welcome to A.A Atelier. Please confirm your email address to finish creating your account, where you can see your orders, invoices, and appointments in one place.</p>
      <p style="margin:28px 0;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#2b2622;color:#faf8f5;text-decoration:none;padding:12px 24px;border-radius:2px;font-size:15px;">Confirm email</a>
      </p>
      <p style="font-size:14px;color:#8a7f74;margin:0 0 16px;">This link will expire soon, so please use it right away. If you didn&rsquo;t create an account, you can safely ignore this email.</p>
      <p style="font-size:13px;color:#8a7f74;word-break:break-all;margin:0;">Or paste this link into your browser:<br/>{{ .ConfirmationURL }}</p>
      <p style="font-size:13px;color:#8a7f74;margin:36px 0 0;border-top:1px solid #e7e0d8;padding-top:16px;">Thank you,<br/>The A.A Atelier team</p>
    </div>
  </body>
</html>
```

---

## 2. Magic Link

**Subject:** `Your A.A Atelier sign-in link`

```html
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f5;">
    <div style="max-width:520px;margin:0 auto;padding:40px 28px;font-family:Georgia,'Times New Roman',serif;color:#2b2622;line-height:1.6;">
      <p style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#8a7f74;margin:0 0 28px;">A.A Atelier</p>
      <h1 style="font-size:22px;font-weight:normal;margin:0 0 20px;">Your sign-in link</h1>
      <p style="margin:0 0 16px;">Use the button below to sign in to your A.A Atelier account, where you can see your orders, invoices, and appointments in one place.</p>
      <p style="margin:28px 0;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#2b2622;color:#faf8f5;text-decoration:none;padding:12px 24px;border-radius:2px;font-size:15px;">Sign in</a>
      </p>
      <p style="font-size:14px;color:#8a7f74;margin:0 0 16px;">Keep this link to yourself &mdash; anyone with it can sign in until it expires. If you didn&rsquo;t request it, you can safely ignore this email; no one can sign in without it.</p>
      <p style="font-size:13px;color:#8a7f74;word-break:break-all;margin:0;">Or paste this link into your browser:<br/>{{ .ConfirmationURL }}</p>
      <p style="font-size:13px;color:#8a7f74;margin:36px 0 0;border-top:1px solid #e7e0d8;padding-top:16px;">Thank you,<br/>The A.A Atelier team</p>
    </div>
  </body>
</html>
```

---

## 3. Reset Password

**Subject:** `Reset your A.A Atelier password`

```html
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f5;">
    <div style="max-width:520px;margin:0 auto;padding:40px 28px;font-family:Georgia,'Times New Roman',serif;color:#2b2622;line-height:1.6;">
      <p style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#8a7f74;margin:0 0 28px;">A.A Atelier</p>
      <h1 style="font-size:22px;font-weight:normal;margin:0 0 20px;">Set a new password</h1>
      <p style="margin:0 0 16px;">We received a request to reset the password for your A.A Atelier account. Use the button below to choose a new one.</p>
      <p style="margin:28px 0;">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#2b2622;color:#faf8f5;text-decoration:none;padding:12px 24px;border-radius:2px;font-size:15px;">Set a new password</a>
      </p>
      <p style="font-size:14px;color:#8a7f74;margin:0 0 16px;">This link will expire soon, so please use it right away. If you didn&rsquo;t request a password reset, you can safely ignore this email &mdash; your password won&rsquo;t change.</p>
      <p style="font-size:13px;color:#8a7f74;word-break:break-all;margin:0;">Or paste this link into your browser:<br/>{{ .ConfirmationURL }}</p>
      <p style="font-size:13px;color:#8a7f74;margin:36px 0 0;border-top:1px solid #e7e0d8;padding-top:16px;">Thank you,<br/>The A.A Atelier team</p>
    </div>
  </body>
</html>
```

---

## Left on Supabase defaults (not branded yet)

**Invite user** and **Change email address** — the app doesn't drive those flows
today. Add branded versions here if/when they're used.
