import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SETTING_DEFINITIONS,
  settingDefinition,
  isKnownTimeZone,
} from "../../src/lib/settings/catalog.js";
import {
  __setSettingsSnapshot,
  __resetSettings,
} from "../../src/lib/settings/store.js";
import { rushSurchargeRate } from "../../src/services/rush.js";
import { lockFromStage } from "../../src/services/measurement-lock.js";
import { intakeColorPalette } from "../../src/services/colors.js";
import {
  closedMessage,
  commissionCapacity,
  intakeSwitch,
  DEFAULT_CLOSED_MESSAGE,
} from "../../src/services/capacity.js";
import {
  appointmentTimezone,
  minLeadMinutes,
  maxAdvanceDays,
  slotStepMinutes,
  reminderLeadDays,
} from "../../src/lib/appointments/settings.js";
import {
  formatStaffRouting,
  resolveAppointmentTypes,
} from "../../src/lib/appointments/routing.js";
import {
  referralCreditAmount,
  welcomeDiscountPercent,
  returningDiscountPercent,
  rewardCodeExpiresDays,
} from "../../src/services/rewards.service.js";
import { atelierInbox } from "../../src/lib/resend/config.js";
import { alertInbox } from "../../src/services/alert.service.js";

/**
 * The catalog restates each setting's built-in default as display text, and the
 * dashboard shows that text as "what the app falls back to". Nothing in the type
 * system stops it drifting from the getter it describes, so this is the guard:
 * every key is driven through its REAL getter, with the snapshot and the
 * environment empty, and the answer has to be the default the catalog claims.
 *
 * The same table then proves the wiring in the other direction — a value in the
 * snapshot reaches the getter, and a value the catalog says is unusable is in
 * fact ignored by it. That second case is what the dashboard reports as
 * `ignoredValue`, so `accepts` has to agree with the getter or the panel would
 * claim a value was being thrown away while the app was using it.
 */
interface Case {
  key: string;
  /** The effective value as text, read through the setting's real getter. */
  read: () => string;
  /** What that getter returns with nothing configured, when it isn't simply the
   * catalog's `defaultValue` (only the palette, which has no text default). */
  expectedDefault?: string;
  /** A value the setting should honour, and what the getter then reads. */
  sample: string;
  sampleReads?: string;
  /** A value the runtime can't use, so the default takes over. */
  unusable?: string;
}

/** The staffing in force, written back out in the shape the setting takes — so
 * this reads through the resolver every booking path uses, not the raw value. */
function staffRoutingText(): string {
  return formatStaffRouting(
    new Map(resolveAppointmentTypes().map((type) => [type.id, type.staff])),
  );
}

/** The palette as `Name #hex, …`, i.e. the shape the setting is written in. */
function paletteText(): string {
  return intakeColorPalette()
    .map((color) => `${color.name} ${color.hex}`)
    .join(", ");
}

const CASES: Case[] = [
  {
    key: "RUSH_SURCHARGE_RATE",
    read: () => String(rushSurchargeRate()),
    sample: "0.2",
    unusable: "fifteen percent",
  },
  {
    key: "MEASUREMENT_LOCK_FROM_STAGE",
    read: lockFromStage,
    sample: "Cutting",
  },
  {
    key: "COMMISSION_INTAKE",
    read: intakeSwitch,
    sample: "closed",
    // No `unusable` entry: the getter reads anything it doesn't recognise as
    // "auto" rather than discarding it, so `accepts` returns true for every
    // value — there is nothing the dashboard could honestly report as ignored.
    // The write guard is what refuses a typo, and that's asserted below.
  },
  {
    key: "COMMISSION_CAPACITY",
    read: () => String(commissionCapacity()),
    sample: "8",
    unusable: "eight",
  },
  {
    key: "COMMISSION_CLOSED_MESSAGE",
    read: closedMessage,
    // Like the palette, the fallback is a built-in rather than a value the
    // catalog can restate as text — hence the `defaultLabel`.
    expectedDefault: DEFAULT_CLOSED_MESSAGE,
    sample: "We reopen for the 2027-28 season in March.",
  },
  {
    key: "COLOR_PALETTE",
    read: paletteText,
    // The only setting whose fallback isn't a value: it's the built-in palette,
    // which is why the catalog carries a `defaultLabel` for it instead.
    expectedDefault:
      "Red #C0392B, Orange #E67E22, Yellow #F1C40F, Green #27AE60, " +
      "Blue #2E5CB8, Purple #7A3E9D, Pink #E48AA8, Black #1A1A1A, " +
      "White #FFFFFF, Ivory #F3ECE2, Gold #C7A75E, Silver #C0C4CC",
    sample: "Emerald #0B6E4F, Navy #1F2A44",
    unusable: "Emerald, Navy",
  },
  {
    key: "APPOINTMENT_TIMEZONE",
    read: appointmentTimezone,
    sample: "America/New_York",
  },
  {
    key: "APPOINTMENT_MIN_LEAD_HOURS",
    read: () => String(minLeadMinutes() / 60),
    sample: "48",
    unusable: "two days",
  },
  {
    key: "APPOINTMENT_MAX_ADVANCE_DAYS",
    read: () => String(maxAdvanceDays()),
    sample: "60",
    unusable: "0",
  },
  {
    key: "APPOINTMENT_SLOT_STEP_MINUTES",
    read: () => String(slotStepMinutes()),
    sample: "30",
    unusable: "1",
  },
  {
    key: "APPOINTMENT_REMINDER_LEAD_DAYS",
    read: () => String(reminderLeadDays()),
    sample: "2",
    unusable: "0",
  },
  {
    key: "APPOINTMENT_STAFF_ROUTING",
    read: staffRoutingText,
    // A sparse value: only the type it names moves, the rest keep the catalog's
    // staffing. That is the read-side rule a hand-edited row depends on.
    sample: "fitting: Alayna",
    sampleReads:
      "consultation: Alayna; fitting: Alayna; " +
      "design-review: Alexandra, Alayna; general: Alexandra, Alayna",
    // A name nobody on the roster answers to leaves the whole value with
    // nothing readable in it, so the catalog's staffing stands.
    unusable: "consultation: Nobody",
  },
  {
    key: "REFERRAL_CREDIT_AMOUNT",
    read: () => String(referralCreditAmount()),
    sample: "50",
    unusable: "-5",
  },
  {
    key: "REFERRAL_WELCOME_PERCENT",
    read: () => String(welcomeDiscountPercent()),
    sample: "15",
    unusable: "150",
  },
  {
    key: "RETURNING_DISCOUNT_PERCENT",
    read: () => String(returningDiscountPercent()),
    sample: "5",
    unusable: "150",
  },
  {
    key: "REWARD_CODE_EXPIRES_DAYS",
    read: () => String(rewardCodeExpiresDays()),
    sample: "30",
    unusable: "0",
  },
  {
    key: "ATELIER_INBOX_EMAIL",
    read: () => atelierInbox("orders"),
    sample: "orders@example.com",
  },
  {
    key: "ATELIER_CONTACT_INBOX_EMAIL",
    read: () => atelierInbox("contact"),
    sample: "hello@example.com",
  },
  {
    key: "ATELIER_APPOINTMENTS_INBOX_EMAIL",
    read: () => atelierInbox("appointments"),
    sample: "bookings@example.com",
  },
  {
    key: "ALERT_INBOX_EMAIL",
    read: alertInbox,
    sample: "alerts@example.com",
  },
];

const ENV_KEYS = SETTING_DEFINITIONS.map((definition) => definition.key);
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  __resetSettings();
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  __resetSettings();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("the settings catalog matches the getters it describes", () => {
  it("covers every setting exactly once", () => {
    const keys = SETTING_DEFINITIONS.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(CASES.map((testCase) => testCase.key).sort()).toEqual(
      [...keys].sort(),
    );
  });

  for (const testCase of CASES) {
    const definition = settingDefinition(testCase.key);

    it(`${testCase.key}: falls back to the default the catalog states`, () => {
      expect(definition).toBeDefined();
      expect(testCase.read()).toBe(
        testCase.expectedDefault ?? definition!.defaultValue,
      );
    });

    it(`${testCase.key}: honours a value from the settings snapshot`, () => {
      __setSettingsSnapshot({ [testCase.key]: testCase.sample });
      expect(testCase.read()).toBe(testCase.sampleReads ?? testCase.sample);
      expect(definition!.accepts(testCase.sample)).toBe(true);
    });

    if (testCase.unusable !== undefined) {
      it(`${testCase.key}: an unusable value is ignored, exactly as \`accepts\` reports`, () => {
        expect(definition!.accepts(testCase.unusable!)).toBe(false);
        __setSettingsSnapshot({ [testCase.key]: testCase.unusable! });
        expect(testCase.read()).toBe(
          testCase.expectedDefault ?? definition!.defaultValue,
        );
      });
    }
  }

  it("reads the environment when the snapshot has nothing to say", () => {
    process.env.RUSH_SURCHARGE_RATE = "0.25";
    expect(rushSurchargeRate()).toBe(0.25);
  });

  it("falls back to the DEFAULT — not the environment — when Notion holds an unusable value", () => {
    // The corner that makes the source chip worth rendering: the getters read
    // `settingValue(KEY) ?? process.env[KEY]`, so an unusable Notion value never
    // reaches the environment variable sitting behind it.
    process.env.RUSH_SURCHARGE_RATE = "0.25";
    __setSettingsSnapshot({ RUSH_SURCHARGE_RATE: "not a rate" });
    expect(rushSurchargeRate()).toBe(0.15);
  });
});

describe("write validation", () => {
  it("refuses a rush rate the runtime would accept but nobody means", () => {
    const rush = settingDefinition("RUSH_SURCHARGE_RATE")!;
    // 15 parses, and the runtime would price a 1500% surcharge with it.
    expect(rush.accepts("15")).toBe(true);
    expect(rush.validate("15")).toMatch(/between 0 and 1/);
    expect(rush.validate("0.2")).toBeNull();
  });

  it("refuses a palette entry that would be silently dropped", () => {
    const palette = settingDefinition("COLOR_PALETTE")!;
    // The runtime keeps the entries that parse, so this palette "works" — with
    // the mistyped colour missing and nothing said about it.
    expect(palette.accepts("Emerald #0B6E4F, Navy")).toBe(true);
    expect(palette.validate("Emerald #0B6E4F, Navy")).toMatch(/hex code/);
    expect(palette.validate("Emerald #0B6E4F, Navy #1F2A44")).toBeNull();
  });

  it("refuses a timezone the runtime would take and then throw on", () => {
    const timezone = settingDefinition("APPOINTMENT_TIMEZONE")!;
    expect(timezone.accepts("Mars/Olympus")).toBe(true);
    expect(timezone.validate("Mars/Olympus")).toMatch(/timezone/);
    expect(timezone.validate("Europe/London")).toBeNull();
    expect(isKnownTimeZone("America/Chicago")).toBe(true);
  });

  it("refuses an address that isn't one", () => {
    const inbox = settingDefinition("ATELIER_INBOX_EMAIL")!;
    expect(inbox.validate("orders at example.com")).toMatch(/email address/);
    expect(inbox.validate("orders@example.com")).toBeNull();
  });

  it("refuses a whole number where the setting only takes one", () => {
    const advance = settingDefinition("APPOINTMENT_MAX_ADVANCE_DAYS")!;
    expect(advance.validate("45.5")).toMatch(/whole number/);
    expect(advance.validate("45")).toBeNull();
  });
});
