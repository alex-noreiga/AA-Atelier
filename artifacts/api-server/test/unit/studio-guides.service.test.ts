import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/guides.repository.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/notion/guides.repository.js")
  >("../../src/lib/notion/guides.repository.js");
  return {
    // The real error class, so `instanceof` in the service means what it says.
    GuidesDatabaseUnreachableError: actual.GuidesDatabaseUnreachableError,
    guidesConfigured: vi.fn(),
    listGuides: vi.fn(),
    findGuideById: vi.fn(),
    fetchGuideDocument: vi.fn(),
  };
});

import {
  guidesConfigured,
  listGuides,
  findGuideById,
  fetchGuideDocument,
  GuidesDatabaseUnreachableError,
} from "../../src/lib/notion/guides.repository.js";
import {
  getStudioGuides,
  getStudioGuideContent,
  isHtmlAttachment,
  compareGuides,
  staticUnavailability,
  __resetStudioGuidesCache,
} from "../../src/services/studio-guides.service.js";
import type { GuideRecord } from "../../src/lib/notion/guides.schema.js";

const mockConfigured = vi.mocked(guidesConfigured);
const mockList = vi.mocked(listGuides);
const mockFind = vi.mocked(findGuideById);
const mockFetch = vi.mocked(fetchGuideDocument);

function guide(overrides: Partial<GuideRecord> = {}): GuideRecord {
  return {
    id: "guide-1",
    title: "Building an invoice",
    section: "Itemize an invoice",
    order: null,
    attachment: {
      kind: "upload",
      name: "invoicing-guide.html",
      url: "https://files/x.html",
    },
    ...overrides,
  };
}

beforeEach(() => {
  __resetStudioGuidesCache();
  mockConfigured.mockReturnValue(true);
  mockList.mockResolvedValue({ records: [guide()], truncated: false });
  mockFind.mockResolvedValue(guide());
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

describe("staticUnavailability", () => {
  it("passes a readable uploaded HTML file", () => {
    expect(staticUnavailability(guide())).toBeUndefined();
  });

  it("names each reason a row can't render, without a download", () => {
    expect(staticUnavailability(guide({ attachment: undefined }))).toBe(
      "no-file",
    );
    expect(
      staticUnavailability(
        guide({ attachment: { kind: "external", name: "guide.html" } }),
      ),
    ).toBe("not-uploaded");
    expect(
      staticUnavailability(
        guide({
          attachment: { kind: "upload", name: "guide.pdf", url: "https://x" },
        }),
      ),
    ).toBe("not-html");
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
  it("resolves the section and reports the file, without downloading it", async () => {
    const result = await getStudioGuides();

    expect(result.configured).toBe(true);
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({
      title: "Building an invoice",
      section: "invoice-lines",
      fileName: "invoicing-guide.html",
    });
    expect(result.guides[0].unavailable).toBeUndefined();
    // The whole point of the split: listing a dozen guides costs no downloads.
    expect(mockFetch).not.toHaveBeenCalled();
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

  it("marks the reasons a guide can't render before it is ever opened", async () => {
    mockList.mockResolvedValue({
      records: [
        guide({ id: "a", title: "A", order: 1, attachment: undefined }),
        guide({
          id: "b",
          title: "B",
          order: 2,
          attachment: { kind: "external", name: "linked.html" },
        }),
      ],
      truncated: false,
    });

    const result = await getStudioGuides();

    expect(result.guides.map((g) => g.unavailable)).toEqual([
      "no-file",
      "not-uploaded",
    ]);
  });

  it("reports configured:false without reading anything when unset", async () => {
    mockConfigured.mockReturnValue(false);

    const result = await getStudioGuides();

    expect(result).toMatchObject({ guides: [], configured: false });
    expect(result.sections.length).toBeGreaterThan(0);
    expect(mockList).not.toHaveBeenCalled();
  });

  // The likeliest setup mistake — id set, integration never shared — 404s every
  // query. Left as a throw it would be a permanent 500 plus an alert email on
  // every dashboard load, for something the "not connected" copy already tells
  // you how to fix.
  it("reads an unreachable database as not connected, not as an error", async () => {
    mockList.mockRejectedValue(
      new GuidesDatabaseUnreachableError("Notion returned 404"),
    );

    const result = await getStudioGuides();

    expect(result).toMatchObject({ guides: [], configured: false });
  });

  it("caches the listing so a refresh doesn't re-query Notion", async () => {
    await getStudioGuides();
    await getStudioGuides();

    expect(mockList).toHaveBeenCalledTimes(1);
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

  it("surfaces an unexpected failure when there is nothing cached", async () => {
    mockList.mockRejectedValue(new Error("Notion is down"));

    await expect(getStudioGuides()).rejects.toThrow("Notion is down");
  });

  it("passes truncation through so the panel can say the list is partial", async () => {
    mockList.mockResolvedValue({ records: [guide()], truncated: true });

    const result = await getStudioGuides();
    expect(result.truncated).toBe(true);
  });
});

describe("getStudioGuideContent", () => {
  it("re-reads the row and returns the downloaded markup", async () => {
    const content = await getStudioGuideContent("guide-1");

    expect(content).toEqual({ id: "guide-1", html: "<h1>How to</h1>" });
    // Re-read rather than trusted from the listing: the signed URL expires.
    expect(mockFind).toHaveBeenCalledWith("guide-1");
  });

  it("404s a guide that no longer exists", async () => {
    mockFind.mockResolvedValue(null);

    await expect(getStudioGuideContent("gone")).rejects.toThrow(
      "That guide no longer exists.",
    );
  });

  it("404s rather than reading Notion when the database is unset", async () => {
    mockConfigured.mockReturnValue(false);

    await expect(getStudioGuideContent("guide-1")).rejects.toThrow(
      "That guide no longer exists.",
    );
    expect(mockFind).not.toHaveBeenCalled();
  });

  // Never fetched: the URL is the atelier's, not Notion's, and the server
  // returns what it downloads.
  it("refuses a pasted link without requesting it", async () => {
    mockFind.mockResolvedValue(
      guide({ attachment: { kind: "external", name: "linked.html" } }),
    );

    const content = await getStudioGuideContent("guide-1");

    expect(content).toEqual({ id: "guide-1", unavailable: "not-uploaded" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a non-HTML attachment without downloading it", async () => {
    mockFind.mockResolvedValue(
      guide({
        attachment: { kind: "upload", name: "guide.pdf", url: "https://x" },
      }),
    );

    const content = await getStudioGuideContent("guide-1");

    expect(content).toEqual({ id: "guide-1", unavailable: "not-html" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes a download failure through as the reason", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "too-large" });

    const content = await getStudioGuideContent("guide-1");

    expect(content).toEqual({ id: "guide-1", unavailable: "too-large" });
  });
});
