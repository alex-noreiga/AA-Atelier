import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/notion/orders.repository.js")
  >("../../src/lib/notion/orders.repository.js");
  return { ...actual, listOpenOrderServices: vi.fn() };
});

import request from "supertest";
import app from "../../src/app.js";
import { listOpenOrderServices } from "../../src/lib/notion/orders.repository.js";
import { __resetCapacityCache } from "../../src/services/capacity.service.js";
import { DEFAULT_CLOSED_MESSAGE } from "../../src/services/capacity.js";

// Settings are configured through the ENVIRONMENT here, not the snapshot: the
// prime middleware in `app.ts` refreshes the snapshot at the start of every
// request, so anything `__setSettingsSnapshot` put there is gone by the time a
// handler runs. Resolution is Notion -> env -> default, and with no settings
// database configured the env half is exactly what the app reads.
const ENV_KEYS = [
  "COMMISSION_CAPACITY",
  "COMMISSION_INTAKE",
  "COMMISSION_CLOSED_MESSAGE",
];
const savedEnv = new Map<string, string | undefined>();

function configure(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

const mockOpenOrders = vi.mocked(listOpenOrderServices);

beforeEach(() => {
  __resetCapacityCache();
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  __resetCapacityCache();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("GET /api/capacity", () => {
  it("reports open with no capacity configured, without reading Notion", async () => {
    const res = await request(app).get("/api/capacity");

    expect(res.status).toBe(200);
    expect(res.body.open).toBe(true);
    expect(res.body.waitlistOpen).toBe(false);
    // Nothing to explain when the books are open, and the closed wording is
    // deliberately not shipped to every visitor.
    expect(res.body.message).toBe("");
    // The default path for every studio that hasn't turned this on: no cap, so
    // there is no count worth paying for.
    expect(mockOpenOrders).not.toHaveBeenCalled();
  });

  it("closes the books once the counted commissions reach the cap", async () => {
    configure({ COMMISSION_CAPACITY: "2" });
    mockOpenOrders.mockResolvedValue([
      "Bespoke Commission",
      "Bespoke Commission",
      // Not gated — a repair must not count against the commission book.
      "Repairs & Restoration",
    ]);

    const res = await request(app).get("/api/capacity");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      open: false,
      waitlistOpen: true,
      message: DEFAULT_CLOSED_MESSAGE,
    });
  });

  it("does not count a repair against the commission book", async () => {
    configure({ COMMISSION_CAPACITY: "2" });
    mockOpenOrders.mockResolvedValue([
      "Bespoke Commission",
      "Repairs & Restoration",
      "Fittings & Alterations",
      "Rhinestoning & Embellishment",
    ]);

    const res = await request(app).get("/api/capacity");
    expect(res.body.open).toBe(true);
  });

  it("counts a legacy order with no stored service as a commission", async () => {
    // An order placed before the Service property existed resolves to the
    // bespoke commission everywhere else in the app; capacity has to agree, or
    // the studio's own history would be invisible to the count.
    configure({ COMMISSION_CAPACITY: "1" });
    mockOpenOrders.mockResolvedValue([""]);

    const res = await request(app).get("/api/capacity");
    expect(res.body.open).toBe(false);
  });

  it("stays OPEN when the order count can't be read", async () => {
    configure({ COMMISSION_CAPACITY: "1" });
    mockOpenOrders.mockRejectedValue(new Error("Notion is down"));

    const res = await request(app).get("/api/capacity");

    expect(res.status).toBe(200);
    expect(res.body.open).toBe(true);
    expect(res.body.message).toBe("");
  });

  it("honours the atelier's manual close under the cap", async () => {
    configure({
      COMMISSION_INTAKE: "closed",
      COMMISSION_CAPACITY: "10",
      COMMISSION_CLOSED_MESSAGE: "Back in March for 2027-28.",
    });

    const res = await request(app).get("/api/capacity");

    expect(res.body.open).toBe(false);
    expect(res.body.message).toBe("Back in March for 2027-28.");
    // The switch is the atelier saying so; no need to go and count.
    expect(mockOpenOrders).not.toHaveBeenCalled();
  });

  it("never reports how much work the studio is holding", async () => {
    configure({ COMMISSION_CAPACITY: "2" });
    mockOpenOrders.mockResolvedValue(["Bespoke Commission"]);

    const res = await request(app).get("/api/capacity");

    // This endpoint is anonymous — "1 of 2 slots left" is a figure anyone can
    // poll. The numbers live behind the staff gate.
    expect(Object.keys(res.body).sort()).toEqual([
      "message",
      "open",
      "waitlistOpen",
    ]);
  });
});
