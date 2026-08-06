import { describe, it, expect, vi, afterEach } from "vitest";
import { cancellationInput } from "@workspace/test-fixtures";

// Mock the two order lookups, the inbox writer, the CRM upsert, and the email
// transport. The gates run for real between them.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderVerification: vi.fn(),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderForCancellation: vi.fn(),
}));
vi.mock("../../src/lib/notion/cancellation.repository.js", () => ({
  createCancellationRequest: vi.fn(),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import {
  submitOrderCancellationRequest,
  submitShopOrderCancellationRequest,
} from "../../src/services/cancellation.service.js";
import { findOrderVerification } from "../../src/lib/notion/orders.repository.js";
import { findShopOrderForCancellation } from "../../src/lib/notion/shop-orders.repository.js";
import { createCancellationRequest } from "../../src/lib/notion/cancellation.repository.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../src/lib/errors.js";

const mockFindOrder = vi.mocked(findOrderVerification);
const mockFindShop = vi.mocked(findShopOrderForCancellation);
const mockWrite = vi.mocked(createCancellationRequest);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockSend = vi.mocked(sendEmailBestEffort);

const STAGES = ["Consultation", "Sketching", "Delivery"];

const preDelivery = (email = "ada@example.com") => ({
  email,
  pageId: "page-order-test",
  currentStage: "Sketching",
  stages: STAGES,
});

const shopOrder = (overrides: Record<string, unknown> = {}) => ({
  pageId: "shop-page",
  orderNumber: "SHP-1",
  email: "ada@example.com",
  sessionId: "cs_1",
  status: "Payment Confirmed",
  cancelled: false,
  ...overrides,
});

afterEach(() => {
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.ATELIER_INBOX_EMAIL;
});

describe("submitOrderCancellationRequest (custom)", () => {
  it("throws NotFoundError when the order does not exist", async () => {
    mockFindOrder.mockResolvedValue(null);
    await expect(
      submitOrderCancellationRequest("ORD-NOPE", cancellationInput()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError and never writes when the email doesn't match", async () => {
    mockFindOrder.mockResolvedValue(preDelivery("someone-else@example.com"));
    await expect(
      submitOrderCancellationRequest(
        "ORD-1",
        cancellationInput({ email: "ada@example.com" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("throws ConflictError when the order has already been delivered", async () => {
    mockFindOrder.mockResolvedValue({
      email: "ada@example.com",
      pageId: "page-order-test",
      currentStage: "Delivery",
      stages: STAGES,
    });
    await expect(
      submitOrderCancellationRequest("ORD-1", cancellationInput()),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("files the request marked verified (custom) when the email matches", async () => {
    mockFindOrder.mockResolvedValue(preDelivery("Ada@Example.com"));

    const result = await submitOrderCancellationRequest(
      "  ORD-1  ",
      cancellationInput({ email: "ada@example.com" }),
    );

    expect(result).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
    const row = mockWrite.mock.calls[0][0];
    expect(row.orderNumber).toBe("ORD-1");
    expect(row.orderType).toBe("custom");
    expect(row.emailVerified).toBe(true);
  });

  it("accepts a legacy order (no stored email) but flags it unverified", async () => {
    mockFindOrder.mockResolvedValue(preDelivery(""));
    await submitOrderCancellationRequest("ORD-1", cancellationInput());
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][0].emailVerified).toBe(false);
  });

  it("links the request to the customer's Client CRM record", async () => {
    mockFindOrder.mockResolvedValue(preDelivery());
    mockUpsertClient.mockResolvedValue("client-5");
    await submitOrderCancellationRequest("ORD-1", cancellationInput());
    expect(mockUpsertClient).toHaveBeenCalledWith({
      fullName: "",
      email: "ada@example.com",
    });
    expect(mockWrite.mock.calls[0][2]).toBe("client-5");
  });
});

describe("submitShopOrderCancellationRequest (shop)", () => {
  it("throws NotFoundError when the shop order does not exist", async () => {
    mockFindShop.mockResolvedValue(null);
    await expect(
      submitShopOrderCancellationRequest("SHP-NOPE", cancellationInput()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when the email doesn't match", async () => {
    mockFindShop.mockResolvedValue(
      shopOrder({ email: "someone-else@example.com" }),
    );
    await expect(
      submitShopOrderCancellationRequest("SHP-1", cancellationInput()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("has no delivery gate — files the request at any status", async () => {
    mockFindShop.mockResolvedValue(shopOrder({ status: "Shipped" }));
    const result = await submitShopOrderCancellationRequest(
      "SHP-1",
      cancellationInput(),
    );
    expect(result).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite.mock.calls[0][0].orderType).toBe("shop");
  });
});

describe("cancellation request — emails", () => {
  it("confirms to the customer (from the orders sender) after filing", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    mockFindOrder.mockResolvedValue(preDelivery());

    await submitOrderCancellationRequest(
      "ORD-1",
      cancellationInput({ email: "ada@example.com" }),
    );

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("ada@example.com");
    expect(mockSend.mock.calls[0][0].from).toBe(
      "A.A Atelier <orders@a3iceanddance.com>",
    );
  });

  it("also notifies the atelier inbox (reply-to the customer) when configured", async () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockFindOrder.mockResolvedValue(preDelivery());

    await submitOrderCancellationRequest("ORD-1", cancellationInput());

    expect(mockSend).toHaveBeenCalledTimes(2);
    const notification = mockSend.mock.calls
      .map((c) => c[0])
      .find((m) => m.to === "orders@a3iceanddance.com");
    expect(notification?.replyTo).toBe("ada@example.com");
  });

  it("sends no atelier notification when no inbox is configured", async () => {
    mockFindOrder.mockResolvedValue(preDelivery());
    await submitOrderCancellationRequest("ORD-1", cancellationInput());
    expect(mockSend).toHaveBeenCalledOnce();
  });
});
