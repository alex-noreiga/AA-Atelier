import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrdersByEmail: vi.fn(),
  findOrdersByNumbers: vi.fn(),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrdersByEmail: vi.fn(),
  findShopOrdersByNumbers: vi.fn(),
  fetchLiveShopOrderStatuses: vi.fn(),
}));
// The Postgres order-index discovery; default to no extra refs so the non-PG
// tests below are unaffected (the PG path also self-gates on POSTGRES_URL).
vi.mock("../../src/lib/db/order-index.repository.js", () => ({
  findOrderRefsByEmail: vi.fn(async () => []),
}));
// Partial mock: keep the real EVENT_PROP_* constants (event-details.ts reads them)
// and only stub the calendar list so no Google I/O happens.
vi.mock(
  "../../src/lib/google/calendar.repository.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/lib/google/calendar.repository.js")
    >()),
    listUpcomingAppointmentsByEmail: vi.fn(),
  }),
);
// Referral info is a best-effort add to the overview; mock it (default: no
// referral) so most tests are unaffected and the referral branch is drivable.
vi.mock("../../src/services/rewards.service.js", () => ({
  ensureReferralCode: vi.fn(async () => null),
}));

import { getAccountOverview } from "../../src/services/account.service.js";
import {
  findOrdersByEmail,
  findOrdersByNumbers,
} from "../../src/lib/notion/orders.repository.js";
import {
  findShopOrdersByEmail,
  fetchLiveShopOrderStatuses,
} from "../../src/lib/notion/shop-orders.repository.js";
import { findOrderRefsByEmail } from "../../src/lib/db/order-index.repository.js";
import { listUpcomingAppointmentsByEmail } from "../../src/lib/google/calendar.repository.js";
import { ensureReferralCode } from "../../src/services/rewards.service.js";

const mockOrders = vi.mocked(findOrdersByEmail);
const mockOrdersByNumbers = vi.mocked(findOrdersByNumbers);
const mockShop = vi.mocked(findShopOrdersByEmail);
const mockShopStatuses = vi.mocked(fetchLiveShopOrderStatuses);
const mockRefs = vi.mocked(findOrderRefsByEmail);
const mockAppts = vi.mocked(listUpcomingAppointmentsByEmail);
const mockEnsureReferral = vi.mocked(ensureReferralCode);

const BASE_ENV = { ...process.env };
beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.PUBLIC_BASE_URL = "https://atelier.test";
  mockAppts.mockResolvedValue([]);
  mockShopStatuses.mockResolvedValue([
    "Payment Confirmed",
    "Shipped",
    "Delivered",
  ]);
});
afterEach(() => {
  process.env = { ...BASE_ENV };
});

describe("getAccountOverview", () => {
  it("gathers the customer's custom + shop orders under their email", async () => {
    mockOrders.mockResolvedValue([
      {
        orderNumber: "000002",
        orderName: "Ada – Custom Dress",
        currentStage: "Sewing",
        stages: ["Consultation", "Sewing", "Delivery"],
      },
    ]);
    mockShop.mockResolvedValue([
      { orderNumber: "SHP-ABC-1234", status: "Payment Confirmed", total: 42 },
    ]);

    const result = await getAccountOverview("skater@example.com");

    expect(result).toEqual({
      email: "skater@example.com",
      customOrders: [
        {
          orderNumber: "000002",
          orderName: "Ada – Custom Dress",
          currentStage: "Sewing",
          stages: ["Consultation", "Sewing", "Delivery"],
          state: "active",
        },
      ],
      shopOrders: [
        {
          orderNumber: "SHP-ABC-1234",
          status: "Payment Confirmed",
          total: 42,
          state: "active",
        },
      ],
      appointments: [],
    });
    expect(mockOrders).toHaveBeenCalledWith("skater@example.com");
    expect(mockShop).toHaveBeenCalledWith("skater@example.com");
  });

  it("includes the referral block when the CRM resolves one", async () => {
    mockOrders.mockResolvedValue([]);
    mockShop.mockResolvedValue([]);
    mockEnsureReferral.mockResolvedValueOnce({
      code: "AA-ABC123",
      creditAmount: 40,
    });

    const result = await getAccountOverview("skater@example.com");

    expect(mockEnsureReferral).toHaveBeenCalledWith("skater@example.com");
    expect(result.referral).toEqual({ code: "AA-ABC123", creditAmount: 40 });
  });

  it("omits the referral block (degrades) when referral resolution throws", async () => {
    mockOrders.mockResolvedValue([]);
    mockShop.mockResolvedValue([]);
    mockEnsureReferral.mockRejectedValueOnce(new Error("crm down"));

    const result = await getAccountOverview("skater@example.com");

    expect(result.referral).toBeUndefined();
    // The core orders view still resolves.
    expect(result.customOrders).toEqual([]);
  });

  it("maps upcoming appointments and tags each with a signed manage token", async () => {
    mockOrders.mockResolvedValue([]);
    mockShop.mockResolvedValue([]);
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mockAppts.mockResolvedValue([
      {
        staff: "Alayna",
        event: {
          id: "evt-1",
          status: "confirmed",
          start,
          end: new Date(start.getTime() + 30 * 60 * 1000),
          extended: {
            aptType: "consultation",
            aptLocation: "in-person",
            aptConfirmation: "APT-1",
          },
        },
      },
    ]);

    const result = await getAccountOverview("skater@example.com");

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      typeId: "consultation",
      typeName: "Consultation",
      staff: "Alayna",
      status: "confirmed",
      canModify: true,
    });
    expect(typeof result.appointments[0].manageToken).toBe("string");
    expect(result.appointments[0].manageToken.length).toBeGreaterThan(0);
  });

  it("skips a cancelled appointment", async () => {
    mockOrders.mockResolvedValue([]);
    mockShop.mockResolvedValue([]);
    mockAppts.mockResolvedValue([
      {
        staff: "Alayna",
        event: {
          id: "evt-x",
          status: "cancelled",
          start: new Date(Date.now() + 60 * 60 * 1000),
          end: new Date(Date.now() + 90 * 60 * 1000),
          extended: { aptType: "consultation" },
        },
      },
    ]);
    const result = await getAccountOverview("skater@example.com");
    expect(result.appointments).toEqual([]);
  });

  it("degrades to no appointments when the calendar can't be reached", async () => {
    mockOrders.mockResolvedValue([]);
    mockShop.mockResolvedValue([]);
    mockAppts.mockRejectedValue(new Error("google down"));
    const result = await getAccountOverview("skater@example.com");
    expect(result.appointments).toEqual([]);
    // The orders view is unaffected — the failure is swallowed.
    expect(mockOrders).toHaveBeenCalled();
  });
});

describe("getAccountOverview — order lifecycle state", () => {
  const custom = (over: Record<string, unknown>) => ({
    orderNumber: "ORD-1",
    orderName: "Ada – Custom Dress",
    currentStage: "Sewing",
    stages: ["Consultation", "Sewing", "Delivered"],
    ...over,
  });

  it("marks a custom order completed once it reaches the final stage", async () => {
    mockOrders.mockResolvedValue([custom({ currentStage: "Delivered" })]);
    mockShop.mockResolvedValue([]);

    const result = await getAccountOverview("skater@example.com");

    expect(result.customOrders[0].state).toBe("completed");
  });

  it("marks a cancelled custom order cancelled, even at the final stage", async () => {
    mockOrders.mockResolvedValue([
      custom({ currentStage: "Delivered", cancelled: true }),
    ]);
    mockShop.mockResolvedValue([]);

    const result = await getAccountOverview("skater@example.com");

    expect(result.customOrders[0].state).toBe("cancelled");
  });

  it("marks a shop order completed at the final live fulfilment status", async () => {
    mockOrders.mockResolvedValue([]);
    mockShop.mockResolvedValue([
      { orderNumber: "SHP-1", status: "Delivered" },
      { orderNumber: "SHP-2", status: "Shipped" },
      { orderNumber: "SHP-3", status: "Delivered", cancelled: true },
    ]);

    const result = await getAccountOverview("skater@example.com");

    expect(result.shopOrders.map((o) => o.state)).toEqual([
      "completed",
      "active",
      "cancelled",
    ]);
  });

  it("falls back to active when the shop status list can't be read", async () => {
    mockOrders.mockResolvedValue([]);
    mockShop.mockResolvedValue([{ orderNumber: "SHP-1", status: "Delivered" }]);
    mockShopStatuses.mockRejectedValueOnce(new Error("notion down"));

    const result = await getAccountOverview("skater@example.com");

    // Never wrongly denote an order as finished on a failed read.
    expect(result.shopOrders[0].state).toBe("active");
  });

  it("skips the status read entirely when there are no shop orders", async () => {
    mockOrders.mockResolvedValue([]);
    mockShop.mockResolvedValue([]);

    await getAccountOverview("skater@example.com");

    expect(mockShopStatuses).not.toHaveBeenCalled();
  });
});

describe("getAccountOverview — Postgres order-index augmentation", () => {
  afterEach(() => {
    delete process.env.POSTGRES_URL;
  });

  it("adds index-discovered orders the Notion by-email lookup missed", async () => {
    process.env.POSTGRES_URL = "postgres://test";
    mockOrders.mockResolvedValue([
      {
        orderNumber: "ORD-1",
        orderName: "One",
        currentStage: "A",
        stages: ["A"],
      },
    ]);
    mockShop.mockResolvedValue([]);
    mockRefs.mockImplementation(async (_email, kind) =>
      kind === "custom"
        ? [
            { orderNumber: "ORD-1", notionPageId: "p1" },
            { orderNumber: "ORD-LEGACY", notionPageId: "p9" },
          ]
        : [],
    );
    mockOrdersByNumbers.mockResolvedValue([
      {
        orderNumber: "ORD-LEGACY",
        orderName: "Legacy",
        currentStage: "B",
        stages: ["A", "B"],
      },
    ]);

    const result = await getAccountOverview("skater@example.com");

    // Base (ORD-1) + the index-only extra (ORD-LEGACY), deduped.
    expect(result.customOrders.map((o) => o.orderNumber)).toEqual([
      "ORD-1",
      "ORD-LEGACY",
    ]);
    // Only the number the base lookup missed is fetched for live detail.
    expect(mockOrdersByNumbers).toHaveBeenCalledWith(["ORD-LEGACY"]);
  });

  it("degrades to the Notion-only baseline when the index query fails", async () => {
    process.env.POSTGRES_URL = "postgres://test";
    mockOrders.mockResolvedValue([
      {
        orderNumber: "ORD-1",
        orderName: "One",
        currentStage: "A",
        stages: ["A"],
      },
    ]);
    mockShop.mockResolvedValue([]);
    mockRefs.mockRejectedValue(new Error("db down"));

    const result = await getAccountOverview("skater@example.com");

    expect(result.customOrders.map((o) => o.orderNumber)).toEqual(["ORD-1"]);
    expect(mockOrdersByNumbers).not.toHaveBeenCalled();
  });
});
