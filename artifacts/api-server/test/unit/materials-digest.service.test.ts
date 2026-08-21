import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Notion read and the mail transport are the service's only I/O.
vi.mock("../../src/lib/notion/materials.repository.js", () => ({
  listMaterials: vi.fn(),
  materialsConfigured: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import {
  sendWeeklyMaterialsDigest,
  isDigestDay,
  materialsDigestWeekday,
} from "../../src/services/materials-digest.service.js";
import {
  listMaterials,
  materialsConfigured,
} from "../../src/lib/notion/materials.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import type { MaterialRecord } from "../../src/lib/notion/materials.schema.js";

const mockList = vi.mocked(listMaterials);
const mockConfigured = vi.mocked(materialsConfigured);
const mockSend = vi.mocked(sendEmailBestEffort);

function material(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: "mat-1",
    name: "Black Fleece",
    stockOnHand: 0.25,
    minimumStock: 0.5,
    alertsSuppressed: false,
    ...overrides,
  };
}

// 2026-08-24 is a Monday; 2026-08-25 a Tuesday. Late-UTC times so the
// timezone-shift case is real: 03:00 UTC Tuesday is still Monday in Chicago.
const MONDAY = new Date("2026-08-24T14:00:00Z");
const TUESDAY = new Date("2026-08-25T14:00:00Z");
const TUESDAY_EARLY_UTC = new Date("2026-08-25T03:00:00Z");

beforeEach(() => {
  process.env.ATELIER_INBOX_EMAIL = "studio@atelier.test";
  process.env.RESEND_FROM_EMAIL = "orders@atelier.test";
  process.env.APPOINTMENT_TIMEZONE = "America/Chicago";
  mockConfigured.mockReturnValue(true);
  mockList.mockResolvedValue([material()]);
});

afterEach(() => {
  delete process.env.ATELIER_INBOX_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.APPOINTMENT_TIMEZONE;
  delete process.env.MATERIALS_DIGEST_WEEKDAY;
});

describe("materialsDigestWeekday", () => {
  it("defaults to Monday", () => {
    expect(materialsDigestWeekday()).toBe("Monday");
  });

  it("takes the configured weekday", () => {
    process.env.MATERIALS_DIGEST_WEEKDAY = "Thursday";
    expect(materialsDigestWeekday()).toBe("Thursday");
  });
});

describe("isDigestDay", () => {
  it("is true on the configured weekday in the studio timezone", () => {
    expect(isDigestDay(MONDAY, "America/Chicago")).toBe(true);
    expect(isDigestDay(TUESDAY, "America/Chicago")).toBe(false);
  });

  // The whole reason the weekday is read in the studio's zone: 03:00 UTC
  // Tuesday is still Monday evening in Chicago.
  it("uses the studio timezone, not UTC", () => {
    expect(isDigestDay(TUESDAY_EARLY_UTC, "America/Chicago")).toBe(true);
    expect(isDigestDay(TUESDAY_EARLY_UTC, "UTC")).toBe(false);
  });

  it("matches the configured weekday case-insensitively", () => {
    process.env.MATERIALS_DIGEST_WEEKDAY = "monday";
    expect(isDigestDay(MONDAY, "America/Chicago")).toBe(true);
  });
});

describe("sendWeeklyMaterialsDigest", () => {
  it("emails the atelier the materials at or below their reorder point", async () => {
    const sent = await sendWeeklyMaterialsDigest(MONDAY);

    expect(sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("studio@atelier.test");
    expect(message.subject).toBe("Running low: 1 material to reorder");
    expect(message.text).toContain("Black Fleece");
    expect(message.text).toContain("0.25 left, reorder at 0.5");
  });

  it("sends nothing on any other day", async () => {
    await expect(sendWeeklyMaterialsDigest(TUESDAY)).resolves.toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    // It doesn't even read Notion on a non-digest day.
    expect(mockList).not.toHaveBeenCalled();
  });

  // A weekly "all good" would train the atelier to ignore the sender.
  it("stays silent when nothing is below its reorder point", async () => {
    mockList.mockResolvedValue([material({ stockOnHand: 5, minimumStock: 1 })]);

    await expect(sendWeeklyMaterialsDigest(MONDAY)).resolves.toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no-ops when the materials database is not configured", async () => {
    mockConfigured.mockReturnValue(false);

    await expect(sendWeeklyMaterialsDigest(MONDAY)).resolves.toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no-ops when no atelier inbox is configured", async () => {
    delete process.env.ATELIER_INBOX_EMAIL;

    await expect(sendWeeklyMaterialsDigest(MONDAY)).resolves.toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("lists the worst shortfall first and carries the reorder link", async () => {
    mockList.mockResolvedValue([
      material({ id: "a", name: "Satin", stockOnHand: 4, minimumStock: 5 }),
      material({
        id: "b",
        name: "Tulle",
        stockOnHand: 0,
        minimumStock: 10,
        link: "https://example.test/tulle",
      }),
    ]);

    const sent = await sendWeeklyMaterialsDigest(MONDAY);

    expect(sent).toBe(2);
    const text = mockSend.mock.calls[0][0].text as string;
    expect(text.indexOf("Tulle")).toBeLessThan(text.indexOf("Satin"));
    expect(text).toContain("https://example.test/tulle");
  });

  // It reports current state, so running it twice says the same true thing —
  // which is what lets it repeat weekly with no sent-marker store.
  it("is safe to run twice — no marker, same output", async () => {
    await sendWeeklyMaterialsDigest(MONDAY);
    await sendWeeklyMaterialsDigest(MONDAY);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].text).toEqual(
      mockSend.mock.calls[1][0].text,
    );
  });
});
