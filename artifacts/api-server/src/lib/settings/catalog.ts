// The typed catalog of every Studio Setting the app reads — one entry per key,
// carrying what it means, what shape a value has to be, and what the app falls
// back to when nothing is set.
//
// Why this exists. The settings database is a free-text key/value table: the
// `Setting` title is typed by hand and matched against the env var name, and the
// `Value` is typed by hand too. Both are silent when wrong. A mistyped KEY
// ("RUSH_SURCHARGE_RAT") is a row the app never looks at, and a mistyped VALUE
// ("15%" where a fraction was wanted) is parsed, rejected, and replaced by the
// built-in default — in both cases with no error, no log, and a Notion row that
// looks for all the world like it is in force. This catalog is what lets the
// dashboard render the known keys as validated inputs, say where each effective
// value actually came from, and name a row that isn't a setting at all.
//
// Two validators per entry, and the difference between them is load-bearing:
//
//   • `accepts` mirrors the RUNTIME getter — "would the app honour this value?"
//     It is what decides whether a stored value is in force or is being ignored
//     in favour of the default, so it must not be stricter than the getter or
//     the dashboard would report a value as ignored while the app was using it.
//   • `validate` guards a WRITE, and is deliberately allowed to be stricter:
//     the runtime accepts any non-negative rush rate, but somebody typing `15`
//     for "15%" would bill a 1500% surcharge, so the editor refuses it. Writes
//     can be fussier than reads; reads must honour whatever is already stored.
//
// The defaults below are the same values the getters fall back to, restated here
// as display text. `test/unit/settings.catalog.test.ts` drives every getter with
// an empty snapshot and asserts it lands on this default, so the two can't
// drift — that test is the guard, not a convention.

import { parseColorPalette } from "../../services/colors.js";

/** How the dashboard should render (and the server should read) a value. */
export type SettingKind =
  | "number" // a decimal fraction, e.g. a rate
  | "integer"
  | "percent" // whole-number percentage, 0–100
  | "money" // a dollar amount
  | "text"
  | "email"
  | "timezone"
  | "palette"; // the `Name #hex, …` color list

/** The section a setting is shown under. Presentation only. */
export type SettingGroup =
  "Orders & pricing" | "Intake" | "Appointments" | "Rewards" | "Notifications";

export interface SettingDefinition {
  key: string;
  label: string;
  group: SettingGroup;
  kind: SettingKind;
  /** What the setting does, in the atelier's terms. */
  description: string;
  /** The built-in fallback, as text. Empty when the fallback isn't a value
   * (an unset notification inbox means the notification is skipped). */
  defaultValue: string;
  /** How to phrase the fallback when `defaultValue` alone doesn't say it. */
  defaultLabel?: string;
  /** Bounds + step for a numeric input, and the unit shown beside it. */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  /** Runtime parity: would the getter honour this raw value? */
  accepts(raw: string): boolean;
  /** Write guard: `null` when the value may be saved, else why it may not. */
  validate(raw: string): string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when the runtime's `Number(...)` parse lands in range — the shape every
 * numeric getter uses (`Number.isFinite` plus a bound). */
function numberIn(raw: string, min: number, max = Infinity): boolean {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

/** A numeric write guard, with the message the editor shows on refusal. */
function numberRule(
  min: number,
  max: number,
  { integer = false, unit = "" }: { integer?: boolean; unit?: string } = {},
) {
  return (raw: string): string | null => {
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed)) {
      return "That isn't a number.";
    }
    if (integer && !Number.isInteger(parsed)) {
      return "That has to be a whole number.";
    }
    if (parsed < min || parsed > max) {
      return `That has to be between ${min} and ${max}${unit ? ` ${unit}` : ""}.`;
    }
    return null;
  };
}

/** Does the platform know this IANA zone? The getter doesn't check — an unknown
 * zone reaches `Intl` and throws deep inside the slot maths — so the editor
 * checking it is a real improvement rather than parity. */
export function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Non-empty is all any free-text getter asks for (`x || DEFAULT`). */
const nonEmpty = (raw: string): boolean => raw.trim() !== "";

function textRule(maxLength: number, what: string) {
  return (raw: string): string | null => {
    if (raw.trim() === "") return `${what} can't be blank.`;
    if (raw.trim().length > maxLength)
      return `Keep it under ${maxLength} characters.`;
    return null;
  };
}

function emailRule(raw: string): string | null {
  return EMAIL_RE.test(raw.trim()) ? null : "That isn't an email address.";
}

const emailAccepts = nonEmpty;

/**
 * Every setting the app reads, in the order the dashboard shows them. The key is
 * the env var name 1:1 — that identity is what keeps the Notion row, the
 * environment variable and this catalog from ever meaning different things.
 */
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: "RUSH_SURCHARGE_RATE",
    label: "Rush surcharge",
    group: "Orders & pricing",
    kind: "number",
    description:
      "The fraction of an itemized order the invoice generator adds as a rush surcharge line. 0.15 is 15%; 0 turns the surcharge off. Keep the intake form's disclosure wording in step with it.",
    defaultValue: "0.15",
    min: 0,
    max: 1,
    step: 0.01,
    placeholder: "0.15",
    accepts: (raw) => numberIn(raw, 0),
    // Stricter than the runtime on purpose: `15` (meaning 15%) would price a
    // 1500% surcharge, and that is the likeliest way to get this wrong.
    validate: numberRule(0, 1),
  },
  {
    key: "MEASUREMENT_LOCK_FROM_STAGE",
    label: "Measurements lock from stage",
    group: "Orders & pricing",
    kind: "text",
    description:
      "The production stage at which a customer can no longer request a measurement change. Must match a Stage option in Notion exactly — rename that stage and this has to change with it.",
    defaultValue: "Cutting/Pinning",
    placeholder: "Cutting/Pinning",
    accepts: nonEmpty,
    validate: textRule(100, "The stage name"),
  },
  {
    key: "COLOR_PALETTE",
    label: "Intake color palette",
    group: "Intake",
    kind: "palette",
    description: "",
    defaultValue: "",
    defaultLabel: "The built-in primary palette (12 colors)",
    placeholder: "Emerald #0B6E4F, Rose Gold #C5878C, Navy #1F2A44",
    // The runtime keeps whatever parses and drops the rest, so one bad entry
    // still yields a palette.
    accepts: (raw) => parseColorPalette(raw).length > 0,
    // A write is refused unless EVERY entry parses: silently dropping the one
    // color that was mistyped is exactly the failure this editor exists to end.
    validate: (raw) => {
      const entries = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      if (entries.length === 0) return "Add at least one color.";
      const parsed = parseColorPalette(raw);
      if (parsed.length !== entries.length) {
        return 'Each color needs a name and a hex code, like "Rose Gold #C5878C".';
      }
      return null;
    },
  },
  {
    key: "APPOINTMENT_TIMEZONE",
    label: "Booking timezone",
    group: "Appointments",
    kind: "timezone",
    description: "",
    defaultValue: "America/Chicago",
    placeholder: "America/Chicago",
    accepts: nonEmpty,
    validate: (raw) =>
      isKnownTimeZone(raw.trim())
        ? null
        : 'That isn\'t a timezone name. Use the IANA form, like "America/Chicago".',
  },
  {
    key: "APPOINTMENT_MIN_LEAD_HOURS",
    label: "Minimum booking notice",
    group: "Appointments",
    kind: "number",
    description:
      "How far ahead a slot has to be before a customer may book it.",
    defaultValue: "24",
    unit: "hours",
    min: 0,
    max: 720,
    step: 1,
    accepts: (raw) => numberIn(raw, 0),
    validate: numberRule(0, 720, { unit: "hours" }),
  },
  {
    key: "APPOINTMENT_MAX_ADVANCE_DAYS",
    label: "Booking window",
    group: "Appointments",
    kind: "integer",
    description: "How far into the future the booking calendar goes.",
    defaultValue: "45",
    unit: "days",
    min: 1,
    max: 730,
    step: 1,
    accepts: (raw) => numberIn(raw, 1),
    validate: numberRule(1, 730, { integer: true, unit: "days" }),
  },
  {
    key: "APPOINTMENT_SLOT_STEP_MINUTES",
    label: "Slot spacing",
    group: "Appointments",
    kind: "integer",
    description:
      "The grid offered slots snap to inside working hours — 15 offers 10:00, 10:15, 10:30 and so on.",
    defaultValue: "15",
    unit: "minutes",
    min: 5,
    max: 240,
    step: 5,
    accepts: (raw) => numberIn(raw, 5),
    validate: numberRule(5, 240, { integer: true, unit: "minutes" }),
  },
  {
    key: "APPOINTMENT_REMINDER_LEAD_DAYS",
    label: "Appointment reminder lead",
    group: "Appointments",
    kind: "integer",
    description:
      "How many days ahead the nightly sweep emails a booking reminder. 1 is the day-before reminder.",
    defaultValue: "1",
    unit: "days",
    min: 1,
    max: 30,
    step: 1,
    accepts: (raw) => numberIn(raw, 1),
    validate: numberRule(1, 30, { integer: true, unit: "days" }),
  },
  {
    key: "REFERRAL_CREDIT_AMOUNT",
    label: "Referral credit",
    group: "Rewards",
    kind: "money",
    description:
      "What a referrer is credited when the skater they referred pays for their first order. 0 turns the referrer credit off.",
    defaultValue: "40",
    unit: "USD",
    min: 0,
    max: 10000,
    step: 1,
    accepts: (raw) => numberIn(raw, 0),
    validate: numberRule(0, 10000, { unit: "dollars" }),
  },
  {
    key: "REFERRAL_WELCOME_PERCENT",
    label: "Welcome discount",
    group: "Rewards",
    kind: "percent",
    description:
      "The discount a newly referred skater is sent when they order with a referral code.",
    defaultValue: "10",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    accepts: (raw) => numberIn(raw, 0, 100),
    validate: numberRule(0, 100, { unit: "percent" }),
  },
  {
    key: "RETURNING_DISCOUNT_PERCENT",
    label: "Returning-skater discount",
    group: "Rewards",
    kind: "percent",
    description:
      "The standing discount a customer earns once they've paid for a second, different order.",
    defaultValue: "10",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    accepts: (raw) => numberIn(raw, 0, 100),
    validate: numberRule(0, 100, { unit: "percent" }),
  },
  {
    key: "REWARD_CODE_EXPIRES_DAYS",
    label: "Reward code lifetime",
    group: "Rewards",
    kind: "integer",
    description: "How long an issued one-time reward code stays redeemable.",
    defaultValue: "90",
    unit: "days",
    min: 1,
    max: 3650,
    step: 1,
    accepts: (raw) => numberIn(raw, 1),
    validate: numberRule(1, 3650, { integer: true, unit: "days" }),
  },
  {
    key: "ATELIER_INBOX_EMAIL",
    label: "Studio inbox",
    group: "Notifications",
    kind: "email",
    description:
      "Where the internal notification for a new order, message or request lands. The two overrides below fall back to this one.",
    defaultValue: "",
    defaultLabel: "Not set — internal notifications are skipped",
    placeholder: "orders@a3iceanddance.com",
    accepts: emailAccepts,
    validate: emailRule,
  },
  {
    key: "ATELIER_CONTACT_INBOX_EMAIL",
    label: "Contact inbox",
    group: "Notifications",
    kind: "email",
    description: "Where contact-form and newsletter notifications land.",
    defaultValue: "",
    defaultLabel: "The studio inbox above",
    placeholder: "hello@a3iceanddance.com",
    accepts: emailAccepts,
    validate: emailRule,
  },
  {
    key: "ATELIER_APPOINTMENTS_INBOX_EMAIL",
    label: "Appointments inbox",
    group: "Notifications",
    kind: "email",
    description: "Where booking notifications land.",
    defaultValue: "",
    defaultLabel: "The studio inbox above",
    placeholder: "bookings@a3iceanddance.com",
    accepts: emailAccepts,
    validate: emailRule,
  },
  {
    key: "ALERT_INBOX_EMAIL",
    label: "Error alert inbox",
    group: "Notifications",
    kind: "email",
    description: "Production error alert notification inbox.",
    defaultValue: "alexandra@a3iceanddance.com",
    placeholder: "alexandra@a3iceanddance.com",
    accepts: emailAccepts,
    validate: emailRule,
  },
];

/** The keys the app reads, in catalog order. */
export const SETTING_KEYS: readonly string[] = SETTING_DEFINITIONS.map(
  (definition) => definition.key,
);

/** The definition for a key, or `undefined` when it isn't one the app reads. */
export function settingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key);
}
