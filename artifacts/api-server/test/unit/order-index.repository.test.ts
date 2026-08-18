import { describe, it, expect } from "vitest";
import {
  writeOrderIndex,
  findOrderRefsByEmail,
} from "../../src/lib/db/order-index.repository.js";
import { upsertClientIndex } from "../../src/lib/db/clients.repository.js";
import { makeFakeDb } from "../support/fake-db.js";

describe("upsertClientIndex", () => {
  it("upserts by normalized email and returns the id", async () => {
    const db = makeFakeDb(() => [{ id: "client-1" }]);
    const id = await upsertClientIndex("Skater@Example.com", "notion-9", db);

    expect(id).toBe("client-1");
    const call = db.calls[0];
    expect(call.text).toMatch(/insert into clients/);
    expect(call.text).toMatch(/on conflict \(email\) do update/);
    // Email is lowercased; the Notion page id rides along.
    expect(call.params).toEqual(["skater@example.com", "notion-9"]);
  });

  it("returns null for a blank email without querying", async () => {
    const db = makeFakeDb(() => {
      throw new Error("should not query");
    });
    expect(await upsertClientIndex("   ", null, db)).toBeNull();
    expect(db.calls).toHaveLength(0);
  });
});

describe("writeOrderIndex", () => {
  it("inserts idempotently (on conflict do nothing) with a normalized email", async () => {
    const db = makeFakeDb(() => []);
    await writeOrderIndex(
      {
        orderNumber: "ORD-1",
        kind: "custom",
        email: "Skater@Example.com",
        notionPageId: "page-1",
        clientId: "client-1",
      },
      db,
    );

    const call = db.calls[0];
    expect(call.text).toMatch(/insert into order_index/);
    expect(call.text).toMatch(/on conflict \(order_number\) do nothing/);
    expect(call.params).toEqual([
      "ORD-1",
      "custom",
      "client-1",
      "skater@example.com",
      "page-1",
      null,
      null,
    ]);
  });

  it("carries the stripe session id for shop orders", async () => {
    const db = makeFakeDb(() => []);
    await writeOrderIndex(
      {
        orderNumber: "SHP-1",
        kind: "shop",
        email: "buyer@example.com",
        notionPageId: "page-2",
        stripeSessionId: "cs_123",
      },
      db,
    );
    expect(db.calls[0].params?.[1]).toBe("shop");
    expect(db.calls[0].params?.[6]).toBe("cs_123");
  });
});

describe("findOrderRefsByEmail", () => {
  it("returns order refs for a case-insensitive email match", async () => {
    const db = makeFakeDb((text) => {
      if (text.includes("from order_index"))
        return [
          { order_number: "ORD-2", notion_page_id: "p2" },
          { order_number: "ORD-1", notion_page_id: "p1" },
        ];
      return [];
    });

    const refs = await findOrderRefsByEmail("Skater@Example.com", "custom", db);

    expect(refs).toEqual([
      { orderNumber: "ORD-2", notionPageId: "p2" },
      { orderNumber: "ORD-1", notionPageId: "p1" },
    ]);
    expect(db.calls[0].params).toEqual(["skater@example.com", "custom"]);
  });

  it("returns [] for a blank email without querying", async () => {
    const db = makeFakeDb(() => {
      throw new Error("should not query");
    });
    expect(await findOrderRefsByEmail("  ", "shop", db)).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
});
