import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The sweep reads pending carts, claims each due one (an atomic delete), and
// emails the ones it wins. Mock those seams so the tests drive the service's own
// logic (the delay window, expiry-before-due, claim-fail-closed) in isolation.
vi.mock("../../src/lib/db/abandoned-carts.repository.js", () => ({
  saveAbandonedCart: vi.fn(),
  findDueAbandonedCarts: vi.fn(),
  claimAbandonedCart: vi.fn(),
  clearAbandonedCart: vi.fn(),
  deleteExpiredAbandonedCarts: vi.fn(),
}));
vi.mock("../../src/lib/db/client.js", () => ({
  postgresConfigured: vi.fn(() => true),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import {
  cartReminderDelayHours,
  cancelCartReminderBestEffort,
  saveCartReminder,
  sweepAbandonedCarts,
  CART_REMINDER_MAX_AGE_DAYS,
} from "../../src/services/cart-recovery.service.js";
import {
  claimAbandonedCart,
  clearAbandonedCart,
  deleteExpiredAbandonedCarts,
  findDueAbandonedCarts,
  saveAbandonedCart,
} from "../../src/lib/db/abandoned-carts.repository.js";
import { postgresConfigured } from "../../src/lib/db/client.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";

const mockSave = vi.mocked(saveAbandonedCart);
const mockFindDue = vi.mocked(findDueAbandonedCarts);
const mockClaim = vi.mocked(claimAbandonedCart);
const mockClear = vi.mocked(clearAbandonedCart);
const mockExpire = vi.mocked(deleteExpiredAbandonedCarts);
const mockConfigured = vi.mocked(postgresConfigured);
const mockSend = vi.mocked(sendEmailBestEffort);

const NOW = new Date("2026-08-27T09:00:00Z");

function cart(overrides: Record<string, unknown> = {}) {
  return {
    email: "skater@example.com",
    items: [
      {
        variantId: "v1",
        name: "Bow Fleece Soaker",
        size: "S",
        quantity: 2,
        price: 24,
      },
    ],
    updatedAt: new Date("2026-08-25T10:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  mockConfigured.mockReturnValue(true);
  mockClaim.mockResolvedValue(true);
  mockFindDue.mockResolvedValue([]);
  mockExpire.mockResolvedValue(0);
});

afterEach(() => {
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.CART_REMINDER_DELAY_HOURS;
});

describe("cartReminderDelayHours", () => {
  it("defaults to 24 hours", () => {
    expect(cartReminderDelayHours()).toBe(24);
  });

  it("honours a numeric override", () => {
    process.env.CART_REMINDER_DELAY_HOURS = "48";
    expect(cartReminderDelayHours()).toBe(48);
  });

  it("falls back to the default for a non-numeric or non-positive value", () => {
    process.env.CART_REMINDER_DELAY_HOURS = "soon";
    expect(cartReminderDelayHours()).toBe(24);
    process.env.CART_REMINDER_DELAY_HOURS = "0";
    expect(cartReminderDelayHours()).toBe(24);
  });
});

describe("saveCartReminder", () => {
  it("stores the cart under the normalized email", async () => {
    const result = await saveCartReminder({
      email: "  Skater@Example.com ",
      items: cart().items as never,
    });

    expect(result).toEqual({ success: true });
    expect(mockSave).toHaveBeenCalledWith("skater@example.com", cart().items);
  });

  // The customer can't fix the studio's configuration, so the capture accepts
  // (and warns in the logs) rather than erroring the drawer.
  it("accepts without storing when Postgres isn't configured", async () => {
    mockConfigured.mockReturnValue(false);

    const result = await saveCartReminder({
      email: "skater@example.com",
      items: cart().items as never,
    });

    expect(result).toEqual({ success: true });
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe("cancelCartReminderBestEffort", () => {
  it("clears the pending row for the normalized email", async () => {
    await cancelCartReminderBestEffort("Skater@Example.com");
    expect(mockClear).toHaveBeenCalledWith("skater@example.com");
  });

  // Called from the Stripe webhook: a Postgres blip must never bubble into a
  // paid order's recording.
  it("swallows a Postgres failure", async () => {
    mockClear.mockRejectedValue(new Error("boom"));
    await expect(
      cancelCartReminderBestEffort("skater@example.com"),
    ).resolves.toBeUndefined();
  });
});

describe("sweepAbandonedCarts", () => {
  it("does nothing when Postgres isn't configured", async () => {
    mockConfigured.mockReturnValue(false);

    const result = await sweepAbandonedCarts(NOW);

    expect(result).toEqual({ remindersSent: 0, expired: 0 });
    expect(mockFindDue).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("expires aged-out carts before reading the due ones", async () => {
    mockExpire.mockResolvedValue(3);

    const result = await sweepAbandonedCarts(NOW);

    expect(result.expired).toBe(3);
    const expiredBefore = mockExpire.mock.calls[0][0] as Date;
    expect(NOW.getTime() - expiredBefore.getTime()).toBe(
      CART_REMINDER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    );
    // Expiry must run first, so an aged-out cart can't be swept as "due".
    expect(mockExpire.mock.invocationCallOrder[0]).toBeLessThan(
      mockFindDue.mock.invocationCallOrder[0],
    );
  });

  it("asks for carts abandoned past the delay window", async () => {
    process.env.CART_REMINDER_DELAY_HOURS = "48";

    await sweepAbandonedCarts(NOW);

    const abandonedBefore = mockFindDue.mock.calls[0][0] as Date;
    expect(NOW.getTime() - abandonedBefore.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it("claims then emails each due cart, with the shop link when configured", async () => {
    process.env.PUBLIC_BASE_URL = "https://a3iceanddance.com/";
    mockFindDue.mockResolvedValue([cart()]);

    const result = await sweepAbandonedCarts(NOW);

    expect(result.remindersSent).toBe(1);
    expect(mockClaim).toHaveBeenCalledWith(
      "skater@example.com",
      mockFindDue.mock.calls[0][0],
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    const message = mockSend.mock.calls[0][0] as {
      to: string;
      text: string;
    };
    expect(message.to).toBe("skater@example.com");
    expect(message.text).toContain("Bow Fleece Soaker · S × 2");
    expect(message.text).toContain("https://a3iceanddance.com/shop");
  });

  // Losing the claim means someone else resolved the row — another run, a paid
  // checkout, or a re-save. Never send on a lost claim.
  it("skips a cart whose claim is lost", async () => {
    mockFindDue.mockResolvedValue([cart()]);
    mockClaim.mockResolvedValue(false);

    const result = await sweepAbandonedCarts(NOW);

    expect(result.remindersSent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  // Claim fails CLOSED: an unclaimed send would repeat tomorrow, so a Postgres
  // error suppresses this send and the rest of the queue still drains.
  it("treats a claim error as not-claimed and continues", async () => {
    mockFindDue.mockResolvedValue([
      cart({ email: "first@example.com" }),
      cart({ email: "second@example.com" }),
    ]);
    mockClaim
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(true);

    const result = await sweepAbandonedCarts(NOW);

    expect(result.remindersSent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect((mockSend.mock.calls[0][0] as { to: string }).to).toBe(
      "second@example.com",
    );
  });

  it("omits the shop link when PUBLIC_BASE_URL is unset", async () => {
    mockFindDue.mockResolvedValue([cart()]);

    await sweepAbandonedCarts(NOW);

    const message = mockSend.mock.calls[0][0] as { text: string };
    expect(message.text).not.toContain("/shop");
  });
});
