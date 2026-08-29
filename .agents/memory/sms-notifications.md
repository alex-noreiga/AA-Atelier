# SMS notifications (roadmap card 02)

Opt-in text alerts for the three moments the card names — a payment falling due,
an appointment coming up, and a piece being finished — sent **alongside** the
emails that already carry the same news, never instead of them.

The day-before-reminder work deliberately left the groundwork for this (see the
"Groundwork for SMS" section of `appointment-reminders.md`), and named the two
things missing: **a vendor** and **an opt-in**. This is both.

## The core problem it solves

Email is where the studio's notifications land and stay unread. The three that
cost somebody something when they're missed — a deposit slipping overdue, a
fitting nobody turns up to, a finished piece sitting unclaimed — are exactly the
ones worth a second channel. A text is not a better email; it is the one that
gets looked at within the hour.

What makes it a card rather than a line of code is that a text is **permissioned
differently from an email**. A customer who gives an email address to place an
order has plainly agreed to be emailed about it. Nobody has agreed to be texted
by giving a phone number, so consent has to be captured, stored, honoured, and
revocable — and that, not Twilio, is most of what this is.

## How it's shaped

1. **Consent is a fact about the PERSON, on their Client CRM row.** `SMS Consent`
   (checkbox) + `SMS Consent At` (date), with the row's existing `Phone` as the
   number. Not on the order, because the three flows that read it are three
   different features and a customer who opts in on their second commission has
   not opted in twice. The order keeps its own `SMS Consent` checkbox as the
   atelier's record of what was ticked at intake — exactly the relationship
   `Referral Code` on the order has with the reward engine's CRM state.

2. **There are two capture surfaces, because there are two ways in.** The order
   form covers anyone who has commissioned something. The booking form covers
   the rest — and it is the one that makes the day-before reminder work as
   advertised, because a consultation customer has never placed an order and so
   had no box to tick. A booking that creates a CRM row creates it as a `Lead`,
   since a consultation is not a purchase.

   A tick with **no phone number** is not an opt-in: `phone` is optional on a
   booking, so `recordSmsConsent` refuses one rather than leaving a ticked box
   on a row nothing can reach, and the form asks for the number instead of
   silently dropping what the customer just asked for. Nothing is stamped on
   the calendar event — `aptPhone` exists because a number cannot be
   retro-fitted onto a booking already taken, but an extended property is
   invisible in Google's own UI, so a consent copy there would be read by
   nobody and drift from the row that decides.

3. **`preferredContact: "text"` does NOT imply consent.** It says how the
   atelier should reach somebody, which is not permission to send automated
   messages, and the memory note this card grew out of says so explicitly. The
   box starts unticked and is never pre-ticked from it — the same rule the
   newsletter opt-in follows, and a frontend test pins it.

4. **Everything fails closed.** No Twilio, no CRM, no row, no tick, no readable
   number — all of them mean "no text", quietly. This is the opposite of
   `services/capacity.ts`, which fails open, and for the opposite reason: there,
   turning away a customer you could have served is the costly mistake; here,
   texting somebody who never agreed is. `toE164` is where most of that lives: a
   number it can't read yields `""` and nothing is sent, because a number we
   guess at is a text sent to a stranger.

5. **The carrier's record of an opt-out beats ours.** Twilio refuses a send to a
   number that has replied STOP (error 21610). That refusal is not a failure —
   it is the opt-out arriving through the only channel the customer has — so the
   transport reports it as its own outcome and `textCustomer` clears the consent
   checkbox that contradicts it. Otherwise the studio would text a number every
   night that can never be delivered to, while the CRM went on claiming
   permission. Same instinct as "Stripe is the source of truth for money — the
   Notion markers are not".

6. **A text can never be the reason a notification failed.** Every send is
   best-effort and swallowed, and always follows the email rather than replacing
   it. That is also the reason a rejected text is deliberately **not** escalated
   to the alert inbox where a rejected email is: the news reached the customer
   either way, so a dropped text costs a notification its second channel, never
   the notification itself. The alerting section's bar for staying high-signal.

7. **One stage earns the "order ready" text, not fourteen.** `isShippedStage`
   (default `Ready for delivery/pickup`, `SMS_SHIPPED_STAGES` to override) — a
   targeted business rule naming live Notion option values, like
   `FITTING_REMINDER_STAGES`. The customer is _emailed_ at every forward step;
   texting each one would turn an opt-in given for three alerts into a running
   commentary the studio also pays for by the message. It needs no marker of its
   own — the `Last Notified Stage` high-water mark that stops the email
   repeating stops the text with it.

   Its copy says "finished and ready", never "shipped": that stage covers a
   posted parcel **and** a collection at the studio, and the tracking page it
   links to already answers whichever applies. Saying "shipped" would be wrong
   for every skater who collects in person.

8. **The appointment sweep now reads its two markers INDEPENDENTLY**, which is
   what the per-channel scheme was built for and the one genuinely delicate part
   of this change. Every booking taken before texts existed already carries an
   `aptRemindedEmail`, so a shared "have we reminded them?" test would have found
   the entire back catalogue already answered and sent nobody a first text. The
   `aptRemindedSms` marker is written **only on a real send**, so consent given
   between two nightly runs still earns a text before the appointment.

9. **The payment reminder shares one marker across both channels**, unlike the
   appointment. The stage's existing `Reminded` checkbox gates the whole block,
   and that is right here: there is no reschedule that could make the same
   payment stage worth saying twice, so "told them once" is one fact. Both
   channels are also handed the same resolved label, date and amount, so a
   customer can't be emailed one figure and texted another.

## The vendor

Twilio, over **raw `fetch`** — `lib/twilio/{client,send,messages}.ts`, mirroring
`lib/resend/` file for file. **No new dependency**: sending a text is a
form-encoded POST with basic auth, and the SDK would be the largest package in
the app for that, against the pruned-dependencies rule. The house style already
does this for Notion and Google.

The sending identity is either `TWILIO_MESSAGING_SERVICE_SID` (preferred — a US
A2P 10DLC campaign is registered against a Messaging Service, and it is what
lets Twilio handle STOP/HELP on the studio's behalf) or a single
`TWILIO_FROM_NUMBER`. The service wins when both are set.

Every message carries "Reply STOP to opt out." even though a Messaging Service
appends its own language to the first message. It costs ~22 characters against a
possible second segment, and being unmistakably opt-out-able is worth more than
a fraction of a cent.

## A date is formatted in one place now

`lib/format-date.ts` was extracted from `lib/resend/emails.ts` when texts began
quoting the same due dates as the emails. The rule it carries is a real gotcha,
not a preference: **the formatting is pinned to UTC**, because a date-only value
parses to UTC midnight and any westward zone renders it as the previous day. A
second copy would have drifted, and the drift would be a payment reminder that
says one date in the inbox and the day before it on the phone. Same trap
`orderedOn` documents on the sales figures.

## Setup

**Two things, and the feature is inert until both are done.**

1. **Twilio.** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either
   `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`. US A2P 10DLC
   registration is a Twilio-console step, not a code one. Unset ⇒ no texts are
   sent and no Notion read is made per recipient (`smsConfigured()` is the first
   gate on every send path), so the app behaves exactly as it did before.

2. **Two Client CRM properties:** `SMS Consent` (checkbox) and `SMS Consent At`
   (date). A booking-form opt-in from a brand-new customer creates the CRM row
   itself, so nothing else is needed for consultations. Optionally `SMS Consent` (checkbox) on the Order Tracking Pipeline —
   missing, it is dropped by `createPageDroppingUnknownProperties` with a
   pointed warn and the value still appears in the order's page body.

`SMS_SHIPPED_STAGES` is the one optional knob (default
`Ready for delivery/pickup`).

## Known limits

- **Capture is the two forms that collect a phone number** — intake and
  booking. A customer whose only contact has been the contact form or a
  back-in-stock request has no opt-in surface; the atelier can tick the box on
  their CRM row by hand if they ask.
- **Revoking is STOP, or the atelier unticking the box.** There is no self-serve
  toggle in the account portal. STOP is the channel customers actually use, and
  it is honoured — but somebody who wants to keep texts off while opting back
  into email has to ask.
- **The reconciliation tool reports reminders, not texts.** Both passes log
  their text counts, and Twilio's own console is the better record anyway — it
  shows every message, its delivery status and its cost. Threading a second
  count through `MilestoneReconcileResult` for one sentence wasn't worth it.
- **No delivery-receipt handling.** Twilio accepting a message is not the same
  as a handset receiving it; a status-callback webhook would be a separate card.
- **The number is read from the CRM, not from the booking's `aptPhone` stamp**,
  even for the appointment reminder where it is right there. Consent and the
  number it was given for live together; a booking taken months ago carries
  whatever was typed then, and texting that on the strength of a permission
  recorded against a different number would be wrong.

## Files

- `lib/twilio/client.ts` — the REST client + `smsConfigured()`.
- `lib/twilio/send.ts` — `sendSms` / `sendSmsBestEffort`, and the three-valued
  outcome that makes the STOP handling possible.
- `lib/twilio/messages.ts` — all three messages' copy.
- `services/sms.ts` — the pure rules (`toE164`, `isShippedStage`, `clampField`).
- `services/sms.service.ts` — consent: `recordSmsConsent`, `textCustomer`.
- `lib/notion/clients.repository.ts` — `findClientSmsContactByEmail`,
  `setClientSmsConsent`, and the two CRM property names.
- `lib/format-date.ts` — the shared UTC-pinned calendar-date formatter.
- `services/orders.service.ts` — records consent at intake (deferred).
- `services/schedule.service.ts` — the payment-due text.
- `services/appointment-reminder.service.ts` — the two-channel sweep.
- `services/order-notification.service.ts` — the order-ready text.
- `services/appointments.service.ts` — records consent from a booking.
- `web-app/src/pages/order-form.tsx` + `pages/appointments.tsx` — the two opt-ins.
