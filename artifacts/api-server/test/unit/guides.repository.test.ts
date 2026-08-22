import { describe, it, expect, vi } from "vitest";
import {
  fetchGuideDocument,
  MAX_GUIDE_BYTES,
} from "../../src/lib/notion/guides.repository.js";
import type { GuideAttachment } from "../../src/lib/notion/guides.schema.js";

const attachment: GuideAttachment = {
  kind: "upload",
  name: "invoicing-guide.html",
  url: "https://files.notion.so/signed/invoicing-guide.html",
};

/** A `fetch` stand-in returning one canned response. */
function respond(
  body: string,
  init: { status?: number; contentLength?: string } = {},
): typeof fetch {
  const headers = new Headers();
  if (init.contentLength !== undefined) {
    headers.set("content-length", init.contentLength);
  }
  return vi.fn(async () =>
    Object.assign(new Response(body, { status: init.status ?? 200, headers })),
  ) as unknown as typeof fetch;
}

describe("fetchGuideDocument", () => {
  it("returns the markup for a readable file", async () => {
    const result = await fetchGuideDocument(
      attachment,
      respond("<h1>Invoicing</h1>"),
    );

    expect(result).toEqual({ ok: true, html: "<h1>Invoicing</h1>" });
  });

  it("decodes the file as UTF-8 so the atelier's own punctuation survives", async () => {
    const result = await fetchGuideDocument(
      attachment,
      respond("<p>Rose Gold — £12 · “quoted”</p>"),
    );

    expect(result).toEqual({
      ok: true,
      html: "<p>Rose Gold — £12 · “quoted”</p>",
    });
  });

  // Declared first, so an oversized file is refused without being pulled down.
  it("refuses a file whose Content-Length is over the cap", async () => {
    const fetchImpl = respond("<p>tiny</p>", {
      contentLength: String(MAX_GUIDE_BYTES + 1),
    });

    const result = await fetchGuideDocument(attachment, fetchImpl);

    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  // ...and again as the body streams, because a chunked response declares no
  // length. Buffering first and measuring after would be an unbounded read
  // wearing a cap: a 300 MB file would be fully materialized before rejection.
  it("refuses an oversized file that declared no length", async () => {
    const result = await fetchGuideDocument(
      attachment,
      respond("x".repeat(MAX_GUIDE_BYTES + 1)),
    );

    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("stops reading — and cancels the body — once the cap is passed", async () => {
    let produced = 0;
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024);

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(
      async () => new Response(body),
    ) as unknown as typeof fetch;

    const result = await fetchGuideDocument(attachment, fetchImpl);

    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect(cancelled).toBe(true);
    // Bounded at the cap plus the chunk that crossed it, plus one more the
    // stream's own read-ahead had already queued — the point being that an
    // endless stream stops rather than becoming an endless allocation.
    expect(produced).toBeLessThanOrEqual(
      MAX_GUIDE_BYTES + 2 * chunk.byteLength,
    );
  });

  // A pasted external link is never requested: the server returns what it
  // downloads, and the URL comes from a database whose editors are a Notion
  // permission rather than the studio staff allowlist.
  it("never fetches an attachment that isn't an upload", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await fetchGuideDocument(
      { kind: "external", name: "linked.html" },
      fetchImpl,
    );

    expect(result).toEqual({ ok: false, reason: "unreadable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes an abort signal, so a hung download can't stall the request", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("<p>ok</p>"),
    );

    await fetchGuideDocument(attachment, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports an aborted download as unreadable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    }) as unknown as typeof fetch;

    await expect(fetchGuideDocument(attachment, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("reports a non-ok download as unreadable", async () => {
    const result = await fetchGuideDocument(
      attachment,
      respond("gone", { status: 403 }),
    );

    expect(result).toEqual({ ok: false, reason: "unreadable" });
  });

  // A failure is a value, never a throw: one unreachable file degrades that
  // guide, not the whole panel.
  it("reports a network failure as unreadable rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    await expect(fetchGuideDocument(attachment, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
  });
});
