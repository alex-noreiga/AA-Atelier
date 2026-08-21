import { describe, it, expect, vi } from "vitest";
import {
  fetchGuideDocument,
  MAX_GUIDE_BYTES,
} from "../../src/lib/notion/guides.repository.js";
import type { GuideAttachment } from "../../src/lib/notion/guides.schema.js";

const attachment: GuideAttachment = {
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

  // ...and again on what arrived, because a chunked response declares no length.
  it("refuses an oversized file that declared no length", async () => {
    const result = await fetchGuideDocument(
      attachment,
      respond("x".repeat(MAX_GUIDE_BYTES + 1)),
    );

    expect(result).toEqual({ ok: false, reason: "too-large" });
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
