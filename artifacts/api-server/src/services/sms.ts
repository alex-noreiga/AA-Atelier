// The SMS business rules, kept pure so the number formatting and the
// "is this the moment to text?" test can be exercised without Twilio, Notion or
// a clock — the same split as `services/rush.ts` and `services/fitting-reminder.ts`,
// whose env-read-at-call-time shape this follows.

/** The country code assumed for a number typed without one. The studio is in
 * `America/Chicago`, prices in USD and ships domestically, so a bare 10-digit
 * number is a US one. A number the customer typed with a `+` is always taken as
 * given, so this only ever fills in the common local case. */
const DEFAULT_COUNTRY_CODE = "1";

/** The live `Stage` option(s) whose arrival means the piece is on its way, and
 * so is worth a text. Comma-separated; renaming that stage in Notion means
 * setting this override. A targeted business rule naming live option values,
 * exactly like `FITTING_REMINDER_STAGES` and `MEASUREMENT_LOCK_FROM_STAGE`. */
const DEFAULT_SHIPPED_STAGES = "Ready for delivery/pickup";

/**
 * A phone number in the E.164 form Twilio requires (`+15125550123`), or "" when
 * the text the customer typed can't be read as one.
 *
 * Fails CLOSED — an unparseable number yields "" and the caller sends nothing —
 * because the failure modes are asymmetric: a number we decline to text is a
 * customer who still got the email, while a number we guess at is a text sent to
 * a stranger. That is also why only two shapes are accepted beyond an explicit
 * `+`: a 10-digit local number, and an 11-digit one already carrying the country
 * code.
 */
export function toE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // An explicit country code the customer gave us. Keep it; just strip the
  // spaces, dashes and brackets people type.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    // E.164 allows at most 15 digits, and a country code plus a subscriber
    // number is never shorter than 8.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "";
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length === 11 && digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return `+${digits}`;
  }
  return "";
}

/** The stage names that count as "the piece is on its way", lowercased for a
 * case-insensitive match against the live stage the order carries. */
function shippedStages(): string[] {
  const raw = process.env.SMS_SHIPPED_STAGES?.trim() || DEFAULT_SHIPPED_STAGES;
  return raw
    .split(",")
    .map((stage) => stage.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether reaching this stage is the "your order is on its way" moment.
 *
 * Only one stage in the pipeline earns a text, deliberately: the customer is
 * emailed at every forward step, and texting all fourteen would turn an opt-in
 * they gave for three alerts into a running commentary — and cost the studio a
 * message each time. Matching is case- and whitespace-insensitive so a stage
 * retyped with different spacing still fires.
 */
export function isShippedStage(stage: string): boolean {
  const normalized = stage.trim().toLowerCase();
  if (!normalized) return false;
  return shippedStages().includes(normalized);
}

/** The most characters a single GSM-7 segment holds. Twilio bills per segment,
 * so the builders in `lib/twilio/messages.ts` are written to fit one. */
export const SMS_SEGMENT_LIMIT = 160;

/**
 * Trim ONE interpolated field to `limit` characters, ending on an ellipsis
 * rather than mid-word.
 *
 * Deliberately a field guard rather than a whole-message one: every text this
 * app sends carries a link, and clamping the composed message would cut the URL
 * — turning a two-segment text into a one-segment text nobody can act on. Only
 * the genuinely unbounded parts (a customer's own name) are clamped; everything
 * else is an order number, a catalog label or a formatted date.
 */
export function clampField(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) return trimmed;
  const cut = trimmed.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
