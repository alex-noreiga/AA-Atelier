import { describe, it, expect } from "vitest";
import { scanDatabase, MAX_SCAN_PAGES } from "../../src/lib/notion/scan.js";
import {
  NotionRequestError,
  isNotionNotFound,
} from "../../src/lib/notion/errors.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

/** A paged query response carrying `count` rows and (optionally) a next cursor. */
function page(rows: number, nextCursor: string | null, start: number) {
  return {
    results: Array.from({ length: rows }, (_, i) => ({
      id: `row-${start + i}`,
    })),
    has_more: nextCursor !== null,
    next_cursor: nextCursor,
  };
}

describe("scanDatabase", () => {
  it("follows the cursor until the database is exhausted", async () => {
    let call = 0;
    const client = makeFakeClient(() => {
      call += 1;
      if (call === 1) return jsonResponse(page(2, "cursor-1", 0));
      if (call === 2) return jsonResponse(page(2, "cursor-2", 2));
      return jsonResponse(page(1, null, 4));
    });

    const rows = await scanDatabase<{ id: string }>(client, "test");

    expect(rows.map((r) => r.id)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-3",
      "row-4",
    ]);
    // Only the follow-up calls carry a cursor; the first must not.
    const bodies = client.calls.map(
      (c) => JSON.parse(c.init!.body as string) as { start_cursor?: string },
    );
    expect(bodies.map((b) => b.start_cursor)).toEqual([
      undefined,
      "cursor-1",
      "cursor-2",
    ]);
  });

  it("passes the caller's query body through on every page", async () => {
    let call = 0;
    const client = makeFakeClient(() => {
      call += 1;
      return jsonResponse(page(1, call === 1 ? "cursor-1" : null, call));
    });

    await scanDatabase(client, "test", { page_size: 50 });

    for (const made of client.calls) {
      const body = JSON.parse(made.init!.body as string) as {
        page_size?: number;
      };
      expect(body.page_size).toBe(50);
    }
  });

  it("stops at the page cap rather than following a cursor forever", async () => {
    // Always claims there's more — an unbounded loop without the cap.
    const client = makeFakeClient(() => jsonResponse(page(1, "next", 0)));

    const rows = await scanDatabase(client, "runaway");

    expect(client.calls).toHaveLength(MAX_SCAN_PAGES);
    expect(rows).toHaveLength(MAX_SCAN_PAGES);
  });

  it("throws on a failed query", async () => {
    const client = makeFakeClient(() => errorResponse(503, "unavailable"));
    await expect(scanDatabase(client, "test")).rejects.toThrow(/503/);
  });

  // The status alone is what a failed scan used to say. Whoever reads the alert
  // email needs to know WHICH database, and what to do about it.
  it("names the database, the id and Notion's own reason", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(
        {
          object: "error",
          status: 404,
          code: "object_not_found",
          message:
            "Could not find database with ID: test-db-id. Make sure the relevant pages and databases are shared with your integration.",
        },
        404,
      ),
    );

    const error = await scanDatabase(client, "materials inventory").catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(NotionRequestError);
    expect((error as NotionRequestError).status).toBe(404);
    expect((error as NotionRequestError).code).toBe("object_not_found");
    const message = (error as Error).message;
    expect(message).toContain("materials inventory");
    expect(message).toContain("test-db-id");
    expect(message).toContain("object_not_found");
    // The actionable half: a 404 is configuration, not an outage.
    expect(message).toMatch(/shared with that database/);
    expect(isNotionNotFound(error)).toBe(true);
  });

  it("reports a non-404 failure as not-found's opposite", async () => {
    const client = makeFakeClient(() => errorResponse(502, "bad gateway"));

    const error = await scanDatabase(client, "test").catch(
      (err: unknown) => err,
    );

    expect(isNotionNotFound(error)).toBe(false);
    expect((error as Error).message).toContain("bad gateway");
  });
});
