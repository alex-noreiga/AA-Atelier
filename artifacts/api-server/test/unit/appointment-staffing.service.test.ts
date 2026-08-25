import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Notion adapter is faked: this suite is about what the editor refuses and
// what it writes, which is the half the raw settings row can't do for itself.
vi.mock("../../src/lib/notion/settings.repository.js", () => ({
  fetchSettingRows: vi.fn(),
  settingsConfigured: vi.fn(),
  saveSetting: vi.fn(),
}));

import {
  getAppointmentStaffing,
  saveAppointmentStaffing,
} from "../../src/services/appointment-staffing.service.js";
import {
  settingsConfigured,
  saveSetting,
} from "../../src/lib/notion/settings.repository.js";
import { STAFF_ROUTING_KEY } from "../../src/lib/appointments/routing.js";
import {
  __setSettingsSnapshot,
  __resetSettings,
} from "../../src/lib/settings/store.js";
import { BadRequestError, ConflictError } from "../../src/lib/errors.js";

const mockConfigured = vi.mocked(settingsConfigured);
const mockSave = vi.mocked(saveSetting);

const savedEnv = process.env[STAFF_ROUTING_KEY];

/** The value written to the settings row on the last save. */
const written = () => mockSave.mock.calls.at(-1)?.[1];

const staffFor = (
  view: { types: Array<{ id: string; staff: string[] }> },
  id: string,
) => view.types.find((type) => type.id === id)?.staff;

beforeEach(() => {
  __resetSettings();
  delete process.env[STAFF_ROUTING_KEY];
  mockConfigured.mockReturnValue(true);
  mockSave.mockResolvedValue(undefined);
});

afterEach(() => {
  __resetSettings();
  if (savedEnv === undefined) delete process.env[STAFF_ROUTING_KEY];
  else process.env[STAFF_ROUTING_KEY] = savedEnv;
});

describe("getAppointmentStaffing", () => {
  it("reports the catalog's staffing, and says it is the default", () => {
    const view = getAppointmentStaffing();
    expect(view.usingDefaults).toBe(true);
    expect(staffFor(view, "consultation")).toEqual(["Alayna"]);
    expect(staffFor(view, "fitting")).toEqual(["Alexandra", "Alayna"]);
  });

  it("carries the roster, not only the people currently assigned", () => {
    __setSettingsSnapshot({
      [STAFF_ROUTING_KEY]:
        "consultation: Alayna; fitting: Alayna; design-review: Alayna; general: Alayna",
    });
    // Alexandra takes nothing at all, and is still offered as a column — that
    // is how she is put back on something.
    expect(getAppointmentStaffing().staff).toEqual(["Alexandra", "Alayna"]);
  });

  it("shows the override alongside the default it moved away from", () => {
    __setSettingsSnapshot({ [STAFF_ROUTING_KEY]: "consultation: Alexandra" });
    const view = getAppointmentStaffing();
    expect(view.usingDefaults).toBe(false);
    const consultation = view.types.find((type) => type.id === "consultation")!;
    expect(consultation.staff).toEqual(["Alexandra"]);
    expect(consultation.defaultStaff).toEqual(["Alayna"]);
    // Everything else about the type is context, not something to edit.
    expect(consultation.durationMinutes).toBe(30);
  });

  it("reports an unconfigured settings database rather than an empty editor", () => {
    mockConfigured.mockReturnValue(false);
    const view = getAppointmentStaffing();
    expect(view.configured).toBe(false);
    expect(staffFor(view, "fitting")).toEqual(["Alexandra", "Alayna"]);
  });
});

describe("saveAppointmentStaffing", () => {
  it("writes the routing in the form the reader parses", async () => {
    const view = await saveAppointmentStaffing({
      types: [{ id: "consultation", staff: ["Alexandra", "Alayna"] }],
    });
    expect(written()).toBe("consultation: Alexandra, Alayna");
    expect(staffFor(view, "consultation")).toEqual(["Alexandra", "Alayna"]);
    expect(view.usingDefaults).toBe(false);
  });

  it("leaves the types it wasn't told about alone", async () => {
    __setSettingsSnapshot({ [STAFF_ROUTING_KEY]: "fitting: Alayna" });
    await saveAppointmentStaffing({
      types: [{ id: "consultation", staff: ["Alexandra"] }],
    });
    expect(written()).toBe("consultation: Alexandra; fitting: Alayna");
  });

  it("stores staffing that matches the catalog as BLANK, so the default keeps applying", async () => {
    __setSettingsSnapshot({ [STAFF_ROUTING_KEY]: "consultation: Alexandra" });
    const view = await saveAppointmentStaffing({
      types: [{ id: "consultation", staff: ["Alayna"] }],
    });
    // Not "consultation: Alayna": a blank value reads as unset, so a change to
    // the built-in defaults still reaches an atelier that never differed.
    expect(written()).toBe("");
    expect(view.usingDefaults).toBe(true);
  });

  it("refuses a type left with nobody on it", async () => {
    await expect(
      saveAppointmentStaffing({ types: [{ id: "fitting", staff: [] }] }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("accepts a PERSON with nothing to do — that's how a season off is said", async () => {
    const view = await saveAppointmentStaffing({
      types: [
        { id: "consultation", staff: ["Alayna"] },
        { id: "fitting", staff: ["Alayna"] },
        { id: "design-review", staff: ["Alayna"] },
        { id: "general", staff: ["Alayna"] },
      ],
    });
    expect(view.staff).toContain("Alexandra");
    expect(written()).not.toContain("Alexandra");
  });

  it("refuses a type we don't offer and a name off the roster", async () => {
    await expect(
      saveAppointmentStaffing({
        types: [{ id: "photoshoot", staff: ["Alayna"] }],
      }),
    ).rejects.toThrow(/photoshoot/);
    await expect(
      saveAppointmentStaffing({
        types: [{ id: "fitting", staff: ["Marguerite"] }],
      }),
    ).rejects.toThrow(/Marguerite/);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("normalizes a name's casing and de-dupes it rather than refusing", async () => {
    await saveAppointmentStaffing({
      types: [{ id: "general", staff: ["alayna", "ALAYNA "] }],
    });
    expect(written()).toBe("general: Alayna");
  });

  it("answers 409 rather than offering a Save with nowhere to write", async () => {
    mockConfigured.mockReturnValue(false);
    await expect(
      saveAppointmentStaffing({
        types: [{ id: "fitting", staff: ["Alayna"] }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
