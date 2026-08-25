import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  APPOINTMENT_TYPES,
  STAFF_ROSTER,
} from "../../src/lib/appointments/catalog.js";
import {
  STAFF_ROUTING_KEY,
  applyStaffRouting,
  formatStaffRouting,
  parseStaffRouting,
  resolveAppointmentType,
  resolveAppointmentTypes,
  staffRoutingProblem,
  withBookedStaff,
} from "../../src/lib/appointments/routing.js";
import {
  __setSettingsSnapshot,
  __resetSettings,
} from "../../src/lib/settings/store.js";

/**
 * The read side of appointment staffing.
 *
 * Everything here pulls in one direction: a value that can't be understood must
 * never leave a type with FEWER staff than the catalog gives it. A type nobody
 * is routed to offers no times at all and says nothing about why, so the
 * degradation has to widen, never narrow — the same call `resolveOrderPipeline`
 * makes, and the opposite of `orderDelivered`'s.
 */

const staffOf = (types: { id: string; staff: string[] }[], id: string) =>
  types.find((type) => type.id === id)?.staff;

const savedEnv = process.env[STAFF_ROUTING_KEY];

beforeEach(() => {
  __resetSettings();
  delete process.env[STAFF_ROUTING_KEY];
});

afterEach(() => {
  __resetSettings();
  if (savedEnv === undefined) delete process.env[STAFF_ROUTING_KEY];
  else process.env[STAFF_ROUTING_KEY] = savedEnv;
});

describe("parseStaffRouting", () => {
  it("reads the written form into a type -> staff map", () => {
    expect([
      ...parseStaffRouting("consultation: Alayna; fitting: Alexandra"),
    ]).toEqual([
      ["consultation", ["Alayna"]],
      ["fitting", ["Alexandra"]],
    ]);
  });

  it("accepts newlines, loose spelling, and a type's display name", () => {
    const routing = parseStaffRouting(
      "  Design Review : alexandra \n general:ALAYNA , Alexandra ",
    );
    expect(routing.get("design-review")).toEqual(["Alexandra"]);
    expect(routing.get("general")).toEqual(["Alayna", "Alexandra"]);
  });

  it("keeps the order the names are written in, since it decides who takes a no-preference slot", () => {
    expect(
      parseStaffRouting("general: Alayna, Alexandra").get("general"),
    ).toEqual(["Alayna", "Alexandra"]);
  });

  it("de-dupes a name repeated in one entry", () => {
    expect(parseStaffRouting("general: Alayna, alayna").get("general")).toEqual(
      ["Alayna"],
    );
  });

  it("drops an entry naming a type we don't offer", () => {
    expect(parseStaffRouting("photoshoot: Alayna").size).toBe(0);
  });

  it("drops a name off the roster, keeping the rest of the entry", () => {
    expect(
      parseStaffRouting("fitting: Alexandra, Marguerite").get("fitting"),
    ).toEqual(["Alexandra"]);
  });

  it("leaves a type whose names ALL failed out of the map, so it keeps its default", () => {
    // The load-bearing one: "fitting: Alexandre" is a typo, not an instruction
    // to stop offering fittings.
    expect(parseStaffRouting("fitting: Alexandre").has("fitting")).toBe(false);
  });

  it("ignores an entry with no colon, and a blank value entirely", () => {
    expect(parseStaffRouting("just some words").size).toBe(0);
    expect(parseStaffRouting("   ").size).toBe(0);
    expect(parseStaffRouting(undefined).size).toBe(0);
  });
});

describe("applyStaffRouting", () => {
  it("overrides only the types the routing names", () => {
    const applied = applyStaffRouting(
      APPOINTMENT_TYPES,
      new Map([["consultation", ["Alexandra"]]]),
    );
    expect(staffOf(applied, "consultation")).toEqual(["Alexandra"]);
    expect(staffOf(applied, "fitting")).toEqual(
      staffOf([...APPOINTMENT_TYPES], "fitting"),
    );
  });

  it("changes nothing else about a type", () => {
    const applied = applyStaffRouting(
      APPOINTMENT_TYPES,
      new Map([["fitting", ["Alayna"]]]),
    );
    const fitting = applied.find((type) => type.id === "fitting")!;
    expect(fitting.durationMinutes).toBe(60);
    expect(fitting.locations).toEqual(["in-person"]);
    expect(fitting.requiresOrder).toBe(true);
  });

  it("never mutates the catalog it reads", () => {
    const before = APPOINTMENT_TYPES.map((type) => [...type.staff]);
    applyStaffRouting(APPOINTMENT_TYPES, new Map([["fitting", ["Alayna"]]]));
    expect(APPOINTMENT_TYPES.map((type) => type.staff)).toEqual(before);
  });
});

describe("formatStaffRouting", () => {
  it("round-trips through the parser", () => {
    const written = formatStaffRouting(
      new Map([
        ["consultation", ["Alexandra"]],
        ["general", ["Alayna", "Alexandra"]],
      ]),
    );
    expect(written).toBe("consultation: Alexandra; general: Alayna, Alexandra");
    expect([...parseStaffRouting(written)]).toEqual([
      ["consultation", ["Alexandra"]],
      ["general", ["Alayna", "Alexandra"]],
    ]);
  });

  it("writes an empty entry out as nothing at all", () => {
    expect(formatStaffRouting(new Map([["fitting", []]]))).toBe("");
  });
});

describe("resolveAppointmentTypes", () => {
  it("is the catalog when nothing is set", () => {
    expect(resolveAppointmentTypes().map((type) => type.staff)).toEqual(
      APPOINTMENT_TYPES.map((type) => type.staff),
    );
  });

  it("takes the settings snapshot over the environment, like every other getter", () => {
    process.env[STAFF_ROUTING_KEY] = "fitting: Alexandra";
    __setSettingsSnapshot({ [STAFF_ROUTING_KEY]: "fitting: Alayna" });
    expect(resolveAppointmentType("fitting")?.staff).toEqual(["Alayna"]);
  });

  it("falls back to the environment when nothing is in the snapshot", () => {
    process.env[STAFF_ROUTING_KEY] = "fitting: Alexandra";
    expect(resolveAppointmentType("fitting")?.staff).toEqual(["Alexandra"]);
  });

  it("falls back to the CATALOG, not the environment, when the stored value is unreadable", () => {
    // Mirrors the documented corner of every setting: the environment is only
    // consulted when the snapshot has nothing to say, so an unusable Notion
    // value lands on the built-in default rather than the env var.
    process.env[STAFF_ROUTING_KEY] = "fitting: Alexandra";
    __setSettingsSnapshot({ [STAFF_ROUTING_KEY]: "fitting: Alexandre" });
    expect(resolveAppointmentType("fitting")?.staff).toEqual([
      "Alexandra",
      "Alayna",
    ]);
  });

  it("has no opinion on a type id it doesn't know", () => {
    expect(resolveAppointmentType("photoshoot")).toBeUndefined();
  });
});

describe("withBookedStaff", () => {
  it("keeps the person who holds a booking eligible for their own type", () => {
    __setSettingsSnapshot({ [STAFF_ROUTING_KEY]: "fitting: Alayna" });
    const fitting = resolveAppointmentType("fitting")!;
    expect(withBookedStaff(fitting, "Alexandra").staff).toEqual([
      "Alayna",
      "Alexandra",
    ]);
  });

  it("returns the type untouched when they are already on it", () => {
    const fitting = resolveAppointmentType("fitting")!;
    expect(withBookedStaff(fitting, "Alayna")).toBe(fitting);
  });
});

describe("staffRoutingProblem (the write guard)", () => {
  it("accepts a value every part of which reads", () => {
    expect(
      staffRoutingProblem("consultation: Alayna; fitting: Alexandra"),
    ).toBe(null);
  });

  it("refuses a misspelt name the reader would silently drop", () => {
    expect(staffRoutingProblem("fitting: Alexandra, Alexandre")).toMatch(
      /Alexandre/,
    );
  });

  it("refuses an unknown type, a missing colon, and an empty value", () => {
    expect(staffRoutingProblem("photoshoot: Alayna")).toMatch(/photoshoot/);
    expect(staffRoutingProblem("Alayna")).toMatch(/consultation: Alayna/);
    expect(staffRoutingProblem("   ")).toMatch(/at least one appointment type/);
  });

  it("refuses a type left with nobody on it, which the reader merely ignores", () => {
    expect(staffRoutingProblem("fitting:")).toMatch(/at least one person/);
    expect(parseStaffRouting("fitting:").size).toBe(0);
  });
});

describe("the roster", () => {
  it("covers everyone the catalog's default routing names", () => {
    // The roster is the source of truth for who the studio books, so a person
    // in the catalog's defaults who isn't on it could never be saved back.
    for (const type of APPOINTMENT_TYPES) {
      for (const name of type.staff) {
        expect(STAFF_ROSTER).toContain(name);
      }
    }
  });
});
