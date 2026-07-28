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

import {
  requestMagicLink,
  getAccountOverview,
} from "../../src/services/account.service.js";
import { findOrdersByEmail } from "../../src/lib/notion/orders.repository.js";
import { findShopOrdersByEmail } from "../../src/lib/notion/shop-orders.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";

const mockOrders = vi.mocked(findOrdersByEmail);
const mockShop = vi.mocked(findShopOrdersByEmail);
const mockSend = vi.mocked(sendEmailBestEffort);

const BASE_ENV = { ...process.env };
beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.PUBLIC_BASE_URL = "https://atelier.test";
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
    });
    expect(mockOrders).toHaveBeenCalledWith("skater@example.com");
    expect(mockShop).toHaveBeenCalledWith("skater@example.com");
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
