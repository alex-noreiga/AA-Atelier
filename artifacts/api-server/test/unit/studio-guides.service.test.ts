import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/guides.repository.js", () => ({
  guidesConfigured: vi.fn(),
  listGuides: vi.fn(),
  fetchGuideDocument: vi.fn(),
}));

import {
  guidesConfigured,
  listGuides,
  fetchGuideDocument,
} from "../../src/lib/notion/guides.repository.js";
import {
  getStudioGuides,
  isHtmlAttachment,
  compareGuides,
  __resetStudioGuidesCache,
} from "../../src/services/studio-guides.service.js";
import type { GuideRecord } from "../../src/lib/notion/guides.schema.js";

const mockConfigured = vi.mocked(guidesConfigured);
const mockList = vi.mocked(listGuides);
const mockFetch = vi.mocked(fetchGuideDocument);

function guide(overrides: Partial<GuideRecord> = {}): GuideRecord {
  return {
    id: "guide-1",
    title: "Building an invoice",
    section: "Itemize an invoice",
    order: null,
    attachment: { name: "invoicing-guide.html", url: "https://files/x.html" },
    ...overrides,
  };
}

beforeEach(() => {
  __resetStudioGuidesCache();
  mockConfigured.mockReturnValue(true);
  mockList.mockResolvedValue({ records: [guide()], truncated: false });
  mockFetch.mockResolvedValue({ ok: true, html: "<h1>How to</h1>" });
});

describe("isHtmlAttachment", () => {
  it("accepts the html spellings", () => {
    expect(isHtmlAttachment("guide.html")).toBe(true);
    expect(isHtmlAttachment("guide.HTM")).toBe(true);
    expect(isHtmlAttachment(" guide.xhtml ")).toBe(true);
  });

  // Decided on the name because the storage host serves everything as a generic
  // binary type — there is no content type to trust.
  it("rejects anything else, including a file with no extension", () => {
    expect(isHtmlAttachment("guide.pdf")).toBe(false);
    expect(isHtmlAttachment("guide.docx")).toBe(false);
    expect(isHtmlAttachment("guide")).toBe(false);
    expect(isHtmlAttachment("")).toBe(false);
  });
});

describe("compareGuides", () => {
  it("puts an unordered guide after every ordered one, not at zero", () => {
    const ordered = [
      guide({ id: "a", title: "Zebra", order: null }),
      guide({ id: "b", title: "Apple", order: 2 }),
      guide({ id: "c", title: "Mango", order: 1 }),
    ].sort(compareGuides);

    expect(ordered.map((g) => g.title)).toEqual(["Mango", "Apple", "Zebra"]);
  });

  it("falls back to the title when neither carries an order", () => {
    const ordered = [
      guide({ id: "a", title: "Refunds" }),
      guide({ id: "b", title: "Invoicing" }),
    ].sort(compareGuides);

    expect(ordered.map((g) => g.title)).toEqual(["Invoicing", "Refunds"]);
  });
});

describe("getStudioGuides", () => {
  it("resolves the section and serves the file's markup", async () => {
    const result = await getStudioGuides();

    expect(result.configured).toBe(true);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({
      title: "Building an invoice",
      section: "invoice-lines",
      html: "<h1>How to</h1>",
      fileName: "invoicing-guide.html",
    });
    expect(result.guides[0].unavailable).toBeUndefined();
  });

  it("serves the vocabulary so an empty panel can still say where a guide goes", async () => {
    mockList.mockResolvedValue({ records: [], truncated: false });

    const result = await getStudioGuides();

    expect(result.guides).toEqual([]);
    expect(result.sections.map((s) => s.id)).toContain("invoice-lines");
    expect(result.sections.at(-1)?.id).toBe("general");
  });

  // Failing open: a guide filed against a name nobody recognized is still a
  // guide the atelier wrote.
  it("files an unrecognized section under general rather than dropping it", async () => {
    mockList.mockResolvedValue({
      records: [guide({ section: "Fabric ordering" })],
      truncated: false,
    });

    const result = await getStudioGuides();
    expect(result.guides[0].section).toBe("general");
  });

  it("lists a row with no file, saying why, instead of hiding it", async () => {
    mockList.mockResolvedValue({
      records: [guide({ attachment: undefined })],
      truncated: false,
    });

    const result = await getStudioGuides();

    expect(result.guides[0].unavailable).toBe("no-file");
    expect(result.guides[0].html).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a non-HTML attachment without downloading it", async () => {
    mockList.mockResolvedValue({
      records: [
        guide({
          attachment: { name: "guide.pdf", url: "https://files/x.pdf" },
        }),
      ],
      truncated: false,
    });

    const result = await getStudioGuides();

    expect(result.guides[0].unavailable).toBe("not-html");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes a download failure through as the reason", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "too-large" });

    const result = await getStudioGuides();

    expect(result.guides[0].unavailable).toBe("too-large");
    expect(result.guides[0].html).toBeUndefined();
  });

  it("keeps the readable guides when one of them fails", async () => {
    mockList.mockResolvedValue({
      records: [
        guide({ id: "a", title: "Alpha", order: 1 }),
        guide({ id: "b", title: "Beta", order: 2 }),
      ],
      truncated: false,
    });
    mockFetch
      .mockResolvedValueOnce({ ok: true, html: "<p>ok</p>" })
      .mockResolvedValueOnce({ ok: false, reason: "unreadable" });

    const result = await getStudioGuides();

    expect(result.guides[0].html).toBe("<p>ok</p>");
    expect(result.guides[1].unavailable).toBe("unreadable");
  });

  it("reports configured:false without reading anything when unset", async () => {
    mockConfigured.mockReturnValue(false);

    const result = await getStudioGuides();

    expect(result).toMatchObject({ guides: [], configured: false });
    expect(result.sections.length).toBeGreaterThan(0);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("caches the assembled result so a refresh doesn't re-download every file", async () => {
    await getStudioGuides();
    await getStudioGuides();

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // Stale guides are still the right procedures; no guides reads as though none
  // were ever written.
  it("falls back to the cached result when a later read fails", async () => {
    const first = await getStudioGuides();

    // Age past the 60s TTL without waiting a real minute.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    mockList.mockRejectedValue(new Error("Notion is down"));

    await expect(getStudioGuides()).resolves.toEqual(first);
    vi.useRealTimers();
  });

  it("surfaces the failure when there is nothing cached to fall back to", async () => {
    mockList.mockRejectedValue(new Error("Notion is down"));

    await expect(getStudioGuides()).rejects.toThrow("Notion is down");
  });

  it("passes truncation through so the panel can say the list is partial", async () => {
    mockList.mockResolvedValue({ records: [guide()], truncated: true });

    const result = await getStudioGuides();
    expect(result.truncated).toBe(true);
  });
});
