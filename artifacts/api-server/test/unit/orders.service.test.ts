import { describe, it, expect, vi, afterEach } from "vitest";
import { createOrderInput, orderRecord } from "@workspace/test-fixtures";
import type { OrderRecord } from "../../src/lib/notion/orders.schema.js";

// The service talks to the repository by direct import, so mock that module to
// exercise the service's own logic (the missing-order and out-of-list-stage
// branches) in isolation.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
  createOrder: vi.fn(),
}));

// The CRM upsert is a best-effort side effect; mock it so the service test can
// drive the link/skip/failure branches without touching Notion.
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn(),
}));

// The Order Form Submissions hub link is also a best-effort side effect; mock it
// so the service test can assert it's invoked (and that its failure is swallowed)
// without touching Notion.
vi.mock("../../src/lib/notion/order-form-submissions.repository.js", () => ({
  linkOrderFormSubmission: vi.fn(),
}));

// getOrderStatus enriches with the invoice balance; mock the invoice read but
// keep the real computeBalanceDue so the displayed balance math is exercised.
vi.mock("../../src/lib/notion/invoices.repository.js", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../src/lib/notion/invoices.repository.js")
    >();
  return { ...actual, findInvoiceById: vi.fn() };
});

// The confirmation email is a best-effort side effect; mock it so the service
// test asserts it is dispatched without touching the Resend transport.
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import {
  getOrderStatus,
  submitOrder,
} from "../../src/services/orders.service.js";
import {
  findOrderByNumber,
  createOrder,
} from "../../src/lib/notion/orders.repository.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";
import { linkOrderFormSubmission } from "../../src/lib/notion/order-form-submissions.repository.js";
import { findInvoiceById } from "../../src/lib/notion/invoices.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { NotFoundError, ValidationError } from "../../src/lib/errors.js";

const mockFind = vi.mocked(findOrderByNumber);
const mockCreate = vi.mocked(createOrder);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockLinkSubmission = vi.mocked(linkOrderFormSubmission);
const mockFindInvoice = vi.mocked(findInvoiceById);
const mockSend = vi.mocked(sendEmailBestEffort);

// createOrder now resolves { orderNumber, pageId }; a small helper keeps the
// per-test stubs readable.
const created = (orderNumber: string, pageId = "order-page-1") => ({
  orderNumber,
  pageId,
});

afterEach(() => {
  delete process.env.ATELIER_INBOX_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
});

describe("getOrderStatus", () => {
  it("throws NotFoundError when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);
    await expect(getOrderStatus("ORD-MISSING")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("returns the record unchanged when the current stage is in the list", async () => {
    const record: OrderRecord = orderRecord({
      orderNumber: "000002",
      currentStage: "Sewing",
      stages: ["Consultation", "Sewing", "Delivery"],
    });
    mockFind.mockResolvedValue(record);

    const result = await getOrderStatus("000002");
    expect(result.stages).toEqual(["Consultation", "Sewing", "Delivery"]);
  });

  it("appends the current stage when it is missing from the live list", async () => {
    // Guards against a stage option that was renamed/removed in Notion after
    // the order was set to it — the timeline must still show where it is.
    mockFind.mockResolvedValue(
      orderRecord({
        orderNumber: "000002",
        currentStage: "Archived",
        stages: ["Consultation", "Sewing", "Delivery"],
      }),
    );

    const result = await getOrderStatus("000002");
    expect(result.stages).toEqual([
      "Consultation",
      "Sewing",
      "Delivery",
      "Archived",
    ]);
  });

  it("enriches the status with the payable balance from the linked invoice", async () => {
    mockFind.mockResolvedValue({
      ...orderRecord({
        orderNumber: "000002",
        currentStage: "Sewing",
        stages: ["Consultation", "Sewing", "Delivery"],
        depositAmount: 200,
        depositPaid: true,
      }),
      invoicePageId: "inv-1",
    });
    mockFindInvoice.mockResolvedValue({
      finalBalance: 800,
      balancePaid: false,
      invoiceReady: true,
    });

    const result = await getOrderStatus("000002");

    // 800 final − 200 paid deposit = 600, and it's ready to pay.
    expect(result.balanceAmount).toBe(600);
    expect(result.balanceReady).toBe(true);
    expect(result.balancePaid).toBe(false);
    // The internal invoice id is never exposed on the response.
    expect(result).not.toHaveProperty("invoicePageId");
  });

  it("shows no balance action while a set deposit is unpaid", async () => {
    mockFind.mockResolvedValue({
      ...orderRecord({
        orderNumber: "000002",
        currentStage: "Sewing",
        stages: ["Consultation", "Sewing", "Delivery"],
        depositAmount: 200,
        depositPaid: false,
      }),
      invoicePageId: "inv-1",
    });
    mockFindInvoice.mockResolvedValue({
      finalBalance: 800,
      balancePaid: false,
      invoiceReady: true,
    });

    const result = await getOrderStatus("000002");
    expect(result.balanceReady).toBe(false);
  });
});

describe("submitOrder", () => {
  it("delegates to the repository and returns the new order number", async () => {
    mockCreate.mockResolvedValue(created("ORD-XYZ-987"));
    const result = await submitOrder(
      createOrderInput({ email: "ada@example.com" }),
    );
    expect(result).toEqual({ orderNumber: "ORD-XYZ-987" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("upserts a Client CRM record by email and links the order to it", async () => {
    mockUpsertClient.mockResolvedValue("client-123");
    mockCreate.mockResolvedValue(created("ORD-XYZ-987"));
    const input = createOrderInput({ email: "ada@example.com" });

    await submitOrder(input);

    expect(mockUpsertClient).toHaveBeenCalledWith({
      fullName: input.fullName,
      email: "ada@example.com",
      phone: input.phone,
    });
    // The resolved client page id is threaded into createOrder as the link.
    expect(mockCreate).toHaveBeenCalledWith(input, undefined, "client-123");
  });

  it("still creates the order (unlinked) when the CRM upsert fails", async () => {
    mockUpsertClient.mockRejectedValue(new Error("Notion CRM down"));
    mockCreate.mockResolvedValue(created("ORD-XYZ-987"));

    const result = await submitOrder(
      createOrderInput({ email: "ada@example.com" }),
    );

    expect(result).toEqual({ orderNumber: "ORD-XYZ-987" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      undefined,
    );
  });

  it("links the created order into the Order Form Submissions hub with its page id", async () => {
    mockCreate.mockResolvedValue(created("ORD-XYZ-987", "order-page-42"));
    const input = createOrderInput({ email: "ada@example.com" });

    await submitOrder(input);

    expect(mockLinkSubmission).toHaveBeenCalledWith(input, "order-page-42");
  });

  it("still returns the order when the hub link fails", async () => {
    mockCreate.mockResolvedValue(created("ORD-XYZ-987"));
    mockLinkSubmission.mockRejectedValue(new Error("hub down"));

    const result = await submitOrder(
      createOrderInput({ email: "ada@example.com" }),
    );

    expect(result).toEqual({ orderNumber: "ORD-XYZ-987" });
  });

  it("accepts an order with no measurements when an appointment is requested", async () => {
    mockCreate.mockResolvedValue(created("ORD-APPT-001"));
    const {
      waist,
      bust,
      hips,
      height,
      bodyGirth,
      measurementUnit,
      ...contact
    } = createOrderInput();

    const result = await submitOrder({
      ...contact,
      measurementAppointment: true,
    });

    expect(result).toEqual({ orderNumber: "ORD-APPT-001" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("rejects an order with neither measurements nor an appointment", async () => {
    const {
      waist,
      bust,
      hips,
      height,
      bodyGirth,
      measurementUnit,
      ...contact
    } = createOrderInput();

    await expect(submitOrder(contact)).rejects.toBeInstanceOf(ValidationError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("dispatches a confirmation email to the customer after creating the order", async () => {
    mockCreate.mockResolvedValue(created("ORD-XYZ-987"));

    await submitOrder(createOrderInput({ email: "ada@example.com" }));

    expect(mockSend).toHaveBeenCalledOnce();
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("ada@example.com");
    expect(message.subject).toContain("ORD-XYZ-987");
  });

  it("also notifies the atelier inbox (reply-to the customer) when ATELIER_INBOX_EMAIL is set", async () => {
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockCreate.mockResolvedValue(created("ORD-XYZ-987"));

    await submitOrder(createOrderInput({ email: "ada@example.com" }));

    expect(mockSend).toHaveBeenCalledTimes(2);
    const notification = mockSend.mock.calls
      .map((c) => c[0])
      .find((m) => m.to === "orders@a3iceanddance.com");
    expect(notification).toBeDefined();
    expect(notification?.replyTo).toBe("ada@example.com");
    expect(notification?.subject).toContain("ORD-XYZ-987");
  });

  it("does not notify the atelier when ATELIER_INBOX_EMAIL is unset", async () => {
    mockCreate.mockResolvedValue(created("ORD-XYZ-987"));

    await submitOrder(createOrderInput({ email: "ada@example.com" }));

    // Only the customer confirmation goes out.
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("sends both customer and atelier mail from the orders sender", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    process.env.ATELIER_INBOX_EMAIL = "orders@a3iceanddance.com";
    mockCreate.mockResolvedValue(created("ORD-XYZ-987"));

    await submitOrder(createOrderInput({ email: "ada@example.com" }));

    expect(mockSend).toHaveBeenCalledTimes(2);
    for (const [message] of mockSend.mock.calls) {
      expect(message.from).toBe("A.A Atelier <orders@a3iceanddance.com>");
    }
  });
});
