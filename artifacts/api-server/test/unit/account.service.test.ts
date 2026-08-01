import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrdersByEmail: vi.fn(),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrdersByEmail: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn().mockResolvedValue(undefined),
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

import {
  requestMagicLink,
  getAccountOverview,
} from "../../src/services/account.service.js";
import { findOrdersByEmail } from "../../src/lib/notion/orders.repository.js";
import { findShopOrdersByEmail } from "../../src/lib/notion/shop-orders.repository.js";
import { listUpcomingAppointmentsByEmail } from "../../src/lib/google/calendar.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { ensureReferralCode } from "../../src/services/rewards.service.js";

const mockOrders = vi.mocked(findOrdersByEmail);
const mockShop = vi.mocked(findShopOrdersByEmail);
const mockAppts = vi.mocked(listUpcomingAppointmentsByEmail);
const mockSend = vi.mocked(sendEmailBestEffort);
const mockEnsureReferral = vi.mocked(ensureReferralCode);

const BASE_ENV = { ...process.env };
beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.PUBLIC_BASE_URL = "https://atelier.test";
  mockAppts.mockResolvedValue([]);
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
        },
      ],
      shopOrders: [
        { orderNumber: "SHP-ABC-1234", status: "Payment Confirmed", total: 42 },
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

describe("requestMagicLink", () => {
  it("emails a verify link to the customer when configured", async () => {
    await requestMagicLink("Skater@example.com");

    expect(mockSend).toHaveBeenCalledOnce();
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("Skater@example.com");
    expect(message.html).toContain(
      "https://atelier.test/api/account/verify?token=",
    );
    expect(message.text).toContain(
      "https://atelier.test/api/account/verify?token=",
    );
  });

  it("does nothing when SESSION_SECRET is unset", async () => {
    delete process.env.SESSION_SECRET;
    await requestMagicLink("a@b.com");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing when PUBLIC_BASE_URL is unset (can't build an absolute link)", async () => {
    delete process.env.PUBLIC_BASE_URL;
    await requestMagicLink("a@b.com");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("ignores a blank email", async () => {
    await requestMagicLink("   ");
    expect(mockSend).not.toHaveBeenCalled();
  });
});
