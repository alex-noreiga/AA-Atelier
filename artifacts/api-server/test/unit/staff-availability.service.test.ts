import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/staff-availability.repository.js", () => ({
  listStaffAvailability: vi.fn(),
  createStaffAvailability: vi.fn(),
  updateStaffAvailability: vi.fn(),
  archiveStaffAvailability: vi.fn(),
}));

import {
  getStaffAvailability,
  addStaffAvailability,
  editStaffAvailability,
  removeStaffAvailability,
  bookableStaff,
} from "../../src/services/staff-availability.service.js";
import {
  listStaffAvailability,
  createStaffAvailability,
  updateStaffAvailability,
  archiveStaffAvailability,
} from "../../src/lib/notion/staff-availability.repository.js";

const mockList = vi.mocked(listStaffAvailability);
const mockCreate = vi.mocked(createStaffAvailability);
const mockUpdate = vi.mocked(updateStaffAvailability);
const mockArchive = vi.mocked(archiveStaffAvailability);

const INPUT = {
  staff: "Alexandra",
  calendarEmail: "alexandra@atelier.test",
  weekdays: ["Monday", "Wednesday"],
  start: "10:00",
  end: "17:00",
  locations: ["in-person", "virtual"],
};

beforeEach(() => {
  mockCreate.mockImplementation(async (entry) => ({ id: "row-1", ...entry }));
  mockUpdate.mockImplementation(async (id, entry) => ({ id, ...entry }));
  mockArchive.mockResolvedValue(true);
});

describe("bookableStaff", () => {
  it("lists the staff the appointment catalog routes to", () => {
    expect(bookableStaff()).toEqual(["Alayna", "Alexandra"]);
  });
});

describe("getStaffAvailability", () => {
  it("returns the schedule with the staff it may be assigned to", async () => {
    mockList.mockResolvedValue([
      {
        id: "row-1",
        staff: "Alexandra",
        email: "alexandra@atelier.test",
        weekdays: ["Wednesday", "Monday"],
        start: "10:00",
        end: "17:00",
        locations: ["In person"],
      },
    ]);

    expect(await getStaffAvailability()).toEqual({
      entries: [
        {
          id: "row-1",
          staff: "Alexandra",
          calendarEmail: "alexandra@atelier.test",
          // Canonical week order + location ids, whatever the row holds.
          weekdays: ["Monday", "Wednesday"],
          start: "10:00",
          end: "17:00",
          locations: ["in-person"],
        },
      ],
      staff: ["Alayna", "Alexandra"],
    });
  });

  it("shows a hand-edited row as what it will actually do", async () => {
    mockList.mockResolvedValue([
      {
        id: "row-1",
        staff: "Alexandra",
        email: "alexandra@atelier.test",
        weekdays: ["Monday", "Someday"],
        start: "10:00",
        end: "17:00",
        locations: ["In person", "carrier pigeon"],
      },
    ]);
    const { entries } = await getStaffAvailability();
    expect(entries[0].weekdays).toEqual(["Monday"]);
    expect(entries[0].locations).toEqual(["in-person"]);
  });
});

describe("addStaffAvailability", () => {
  it("stores the entry canonically and echoes it back", async () => {
    const entry = await addStaffAvailability({
      ...INPUT,
      weekdays: ["Wed", "monday"],
      calendarEmail: "  Alexandra@Atelier.test ",
    });

    expect(mockCreate).toHaveBeenCalledWith({
      staff: "Alexandra",
      email: "alexandra@atelier.test",
      weekdays: ["Monday", "Wednesday"],
      start: "10:00",
      end: "17:00",
      // Stored as the atelier's own labels, read back as ids.
      locations: ["In person", "Virtual"],
    });
    expect(entry).toMatchObject({
      id: "row-1",
      locations: ["in-person", "virtual"],
    });
  });

  it("refuses a staff member the studio doesn't book", async () => {
    await expect(
      addStaffAvailability({ ...INPUT, staff: "Someone Else" }),
    ).rejects.toThrow(/isn't someone the studio books/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses hours that end before they start", async () => {
    await expect(
      addStaffAvailability({ ...INPUT, start: "17:00", end: "10:00" }),
    ).rejects.toThrow(/end time must be after the start time/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses an unrecognized day or location", async () => {
    await expect(
      addStaffAvailability({ ...INPUT, weekdays: ["Someday"] }),
    ).rejects.toThrow(/isn't a day of the week/);
    await expect(
      addStaffAvailability({ ...INPUT, locations: ["studio"] }),
    ).rejects.toThrow(/isn't a location we book/);
  });

  it("refuses an entry with nothing left after normalizing", async () => {
    await expect(
      addStaffAvailability({ ...INPUT, weekdays: [] }),
    ).rejects.toThrow(/at least one day/);
    await expect(
      addStaffAvailability({ ...INPUT, locations: [] }),
    ).rejects.toThrow(/at least one location/);
  });
});

describe("editStaffAvailability", () => {
  it("replaces the entry", async () => {
    const entry = await editStaffAvailability("row-7", INPUT);
    expect(mockUpdate).toHaveBeenCalledWith("row-7", expect.anything());
    expect(entry.id).toBe("row-7");
  });

  it("validates exactly as the create path does", async () => {
    await expect(
      editStaffAvailability("row-7", { ...INPUT, staff: "Nobody" }),
    ).rejects.toThrow(/isn't someone the studio books/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("reports a row that has since been deleted", async () => {
    mockUpdate.mockResolvedValue(null);
    await expect(editStaffAvailability("row-gone", INPUT)).rejects.toThrow(
      /no longer exists/,
    );
  });
});

describe("removeStaffAvailability", () => {
  it("removes the entry", async () => {
    await removeStaffAvailability("row-1");
    expect(mockArchive).toHaveBeenCalledWith("row-1");
  });

  it("reports a row that has since been deleted", async () => {
    mockArchive.mockResolvedValue(false);
    await expect(removeStaffAvailability("row-gone")).rejects.toThrow(
      /no longer exists/,
    );
  });
});
