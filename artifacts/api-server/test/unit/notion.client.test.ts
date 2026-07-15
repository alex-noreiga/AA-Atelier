import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The client reads env at first use and memoises one instance per database, so
// each test re-imports the module for a clean singleton and restores env after.
let mod: typeof import("../../src/lib/notion/client.js");

const ENV_KEYS = [
  "NOTION_API_KEY",
  "NOTION_ORDERS_DATABASE_ID",
  "NOTION_CONTACT_DATABASE_ID",
  "NOTION_INVENTORY_DATABASE_ID",
  "NOTION_SHOP_ORDERS_DATABASE_ID",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  vi.resetModules();
  mod = await import("../../src/lib/notion/client.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Notion client factories", () => {
  it("each factory reads its own database id from the environment", () => {
    process.env.NOTION_ORDERS_DATABASE_ID = "orders-db";
    process.env.NOTION_CONTACT_DATABASE_ID = "contact-db";
    process.env.NOTION_INVENTORY_DATABASE_ID = "inventory-db";
    process.env.NOTION_SHOP_ORDERS_DATABASE_ID = "shop-orders-db";

    expect(mod.getNotionClient().databaseId).toBe("orders-db");
    expect(mod.getContactNotionClient().databaseId).toBe("contact-db");
    expect(mod.getInventoryNotionClient().databaseId).toBe("inventory-db");
    expect(mod.getShopOrdersNotionClient().databaseId).toBe("shop-orders-db");
  });

  it("defaults the database id to an empty string when the env var is unset", () => {
    expect(mod.getNotionClient().databaseId).toBe("");
  });

  it("memoises one instance per factory", () => {
    expect(mod.getNotionClient()).toBe(mod.getNotionClient());
    // Different factories are distinct clients.
    expect(mod.getNotionClient()).not.toBe(mod.getContactNotionClient());
  });
});

describe("NotionClient.fetch", () => {
  it("calls the Notion API with the base URL, bearer auth, and version headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    process.env.NOTION_API_KEY = "secret-key";
    process.env.NOTION_ORDERS_DATABASE_ID = "orders-db";

    await mod
      .getNotionClient()
      .fetch("/v1/pages", { method: "POST", body: "{}" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/pages");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer secret-key",
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    });
  });

  it("merges caller-supplied headers over the defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    process.env.NOTION_API_KEY = "secret-key";

    await mod
      .getNotionClient()
      .fetch("/v1/pages", { headers: { "X-Custom": "1" } });

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer secret-key",
      "X-Custom": "1",
    });
  });

  it("throws (without calling fetch) when NOTION_API_KEY is not set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // NOTION_API_KEY intentionally unset.

    await expect(mod.getNotionClient().fetch("/v1/pages")).rejects.toThrow(
      /NOTION_API_KEY environment variable is not set/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
