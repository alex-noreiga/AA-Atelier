import { describe, it, expect, vi, afterEach } from "vitest";
import { shopReviewInput } from "@workspace/test-fixtures";

// Mock the shop-order lookup (identity + delivery + piece source), the live
// status list, the reviews writer, the inventory name lookup, the CRM upsert and
// best-effort send. Every gate in between runs for real — they are the feature.
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderVerification: vi.fn(),
  fetchLiveShopOrderStatuses: vi.fn(),
}));
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  createReview: vi.fn(),
}));
vi.mock("../../src/services/products.service.js", () => ({
  findVariantNames: vi.fn(),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { submitShopOrderReview } from "../../src/services/shop-review.service.js";
import {
  findShopOrderVerification,
  fetchLiveShopOrderStatuses,
  type ShopOrderVerification,
} from "../../src/lib/notion/shop-orders.repository.js";
import { createReview } from "../../src/lib/notion/reviews.repository.js";
import { findVariantNames } from "../../src/services/products.service.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../src/lib/errors.js";
import { shopOrderVerification } from "../support/shop-order-verification.js";

const mockFind = vi.mocked(findShopOrderVerification);
const mockStatuses = vi.mocked(fetchLiveShopOrderStatuses);
const mockWrite = vi.mocked(createReview);
const mockNames = vi.mocked(findVariantNames);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockSend = vi.mocked(sendEmailBestEffort);

/** The atelier's live fulfilment workflow; "Delivered" is last, which is the
 * only thing the delivery gate knows about it. */
const STATUSES = ["Paid", "Packed", "Shipped", "Delivered"];

/** A delivered order whose email matches `shopReviewInput`, so a test names only
 * the gate it is about. */
function ready(overrides: Partial<ShopOrderVerification> = {}) {
  mockStatuses.mockResolvedValue(STATUSES);
  mockNames.mockResolvedValue(new Map([["inv-aurora", "Aurora Soaker"]]));
  mockFind.mockResolvedValue(
    shopOrderVerification({ email: "ada@example.com", ...overrides }),
  );
}

afterEach(() => {
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.ATELIER_INBOX_EMAIL;
});

describe("submitShopOrderReview — the gates", () => {
  it("throws NotFoundError when the order does not exist", async () => {
    mockStatuses.mockResolvedValue(STATUSES);
    mockFind.mockResolvedValue(null);
    await expect(
      submitShopOrderReview("SHP-NOPE", shopReviewInput()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("refuses a cancelled order, even one sitting at the final status", async () => {
    ready({ cancelled: true });
    await expect(
      submitShopOrderReview("SHP-1", shopReviewInput()),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("refuses an order that hasn't reached its final status", async () => {
    ready({ status: "Shipped" });
    await expect(
      submitShopOrderReview("SHP-1", shopReviewInput()),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  // The positional rule fails closed: a status the live list no longer holds
  // can't be confirmed as the end, and a review is one-way.
  it("refuses an order whose status isn't in the live list at all", async () => {
    ready({ status: "Archived" });
    await expect(
      submitShopOrderReview("SHP-1", shopReviewInput()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("throws ForbiddenError and never writes when the email doesn't match", async () => {
    ready({ email: "someone-else@example.com" });
    await expect(
      submitShopOrderReview("SHP-1", shopReviewInput()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("accepts a legacy order (no stored email) but flags it unverified", async () => {
    ready({ email: "" });
    await submitShopOrderReview("SHP-1", shopReviewInput());
    expect(mockWrite.mock.calls[0][0].emailVerified).toBe(false);
  });

  // The gate this flow has and the custom-order one doesn't: an order number is
  // not permission to rate a piece nobody bought.
  it("refuses a piece that isn't on the order", async () => {
    ready();
    await expect(
      submitShopOrderReview(
        "SHP-1",
        shopReviewInput({ productId: "inv-something-else" }),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("says so plainly when the order has no linked pieces at all", async () => {
    ready({ itemIds: [] });
    await expect(
      submitShopOrderReview("SHP-1", shopReviewInput()),
    ).rejects.toThrow(/can't tell which pieces are on this order/);
  });
});

describe("submitShopOrderReview — what it files", () => {
  it("files the review against the piece, with its name alongside", async () => {
    ready();
    mockUpsertClient.mockResolvedValue("client-9");

    const result = await submitShopOrderReview(
      "SHP-ABC-1234",
      shopReviewInput({ displayName: "Ada L." }),
    );

    expect(result).toEqual({ received: true });
    const [row, , clientPageId] = mockWrite.mock.calls[0];
    expect(row.orderNumber).toBe("SHP-ABC-1234");
    expect(row.emailVerified).toBe(true);
    expect(row.product).toEqual({
      pageId: "inv-aurora",
      name: "Aurora Soaker",
    });
    expect(clientPageId).toBe("client-9");
  });

  // The relation carries the piece; a second copy on the row is one more thing
  // that can disagree with itself.
  it("does not put productId on the review row itself", async () => {
    ready();
    await submitShopOrderReview("SHP-1", shopReviewInput());
    expect(mockWrite.mock.calls[0][0].request).not.toHaveProperty("productId");
  });

  // The name is a label from live inventory: absent for a piece the atelier has
  // unpublished since, and the review is still the customer's to leave.
  it("files the review even when the piece can't be named", async () => {
    ready();
    mockNames.mockResolvedValue(new Map());

    await submitShopOrderReview("SHP-1", shopReviewInput());

    expect(mockWrite.mock.calls[0][0].product).toEqual({
      pageId: "inv-aurora",
      name: "",
    });
  });

  it("still files the review when the CRM upsert fails", async () => {
    ready();
    mockUpsertClient.mockRejectedValue(new Error("Notion down"));

    await expect(
      submitShopOrderReview("SHP-1", shopReviewInput()),
    ).resolves.toEqual({ received: true });
    expect(mockWrite.mock.calls[0][2]).toBeUndefined();
  });

  it("emails the customer, and the atelier only when an inbox is set", async () => {
    process.env.RESEND_FROM_EMAIL = "orders@example.com";
    ready();

    await submitShopOrderReview("SHP-1", shopReviewInput());
    expect(mockSend).toHaveBeenCalledOnce();

    mockSend.mockClear();
    process.env.ATELIER_INBOX_EMAIL = "studio@example.com";
    await submitShopOrderReview("SHP-1", shopReviewInput());
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].to).toBe("studio@example.com");
  });
});
