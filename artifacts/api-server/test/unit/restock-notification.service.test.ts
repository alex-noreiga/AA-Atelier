import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The sweep reads live inventory and the waiting requests, claims each answerable
// request, and emails the ones it wins. Mock those seams so the test drives the
// service's own logic (scope, availability, size gating, the claim) in isolation.
vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn(),
}));
vi.mock("../../src/lib/notion/notify.repository.js", () => ({
  findPendingBackInStockRequests: vi.fn(),
}));
vi.mock("../../src/lib/db/restock-alerts.repository.js", () => ({
  claimRestockAlert: vi.fn(),
}));
vi.mock("../../src/lib/db/client.js", () => ({
  postgresConfigured: vi.fn(() => true),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { notifyRestock } from "../../src/services/restock-notification.service.js";
import { listVariants } from "../../src/lib/notion/products.repository.js";
import { findPendingBackInStockRequests } from "../../src/lib/notion/notify.repository.js";
import { claimRestockAlert } from "../../src/lib/db/restock-alerts.repository.js";
import { postgresConfigured } from "../../src/lib/db/client.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";

const mockVariants = vi.mocked(listVariants);
const mockRequests = vi.mocked(findPendingBackInStockRequests);
const mockClaim = vi.mocked(claimRestockAlert);
const mockConfigured = vi.mocked(postgresConfigured);
const mockSend = vi.mocked(sendEmailBestEffort);

function variant(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: "inv-1",
    name: "Bow Fleece Soaker — Black",
    available: true,
    photos: [],
    sizes: [],
    addOnIds: [],
    category: "Skate Soakers",
    group: null,
    ...overrides,
  };
}

function request(overrides: Record<string, string> = {}) {
  return {
    pageId: "req-1",
    email: "skater@example.com",
    item: "Bow Fleece Soaker — Black",
    size: "",
    ...overrides,
  };
}

beforeEach(() => {
  mockConfigured.mockReturnValue(true);
  mockClaim.mockResolvedValue(true);
  mockVariants.mockResolvedValue([]);
  mockRequests.mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.PUBLIC_BASE_URL;
});

describe("notifyRestock — configuration", () => {
  // Without somewhere to record who has been told, a nightly sweep would email
  // the same people every night. Doing nothing and saying so is the safe answer.
  it("does nothing when Postgres isn't configured", async () => {
    mockConfigured.mockReturnValue(false);

    const result = await notifyRestock();

    expect(result.status).toBe("unconfigured");
    expect(result.reason).toMatch(/POSTGRES_URL/);
    expect(mockVariants).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("notifyRestock — scope", () => {
  it("reads inventory fresh, bypassing the shop's 60s cache", async () => {
    await notifyRestock();

    expect(mockVariants).toHaveBeenCalledWith(undefined, { fresh: true });
  });

  it("sweeps every available piece when no item is named", async () => {
    mockVariants.mockResolvedValue([
      variant({ id: "inv-1", name: "Soaker" }),
      variant({ id: "inv-2", name: "Towel" }),
      variant({ id: "inv-3", name: "Sold Out Thing", available: false }),
    ]);
    mockRequests.mockResolvedValue([
      request({ pageId: "req-1", item: "Soaker" }),
      request({ pageId: "req-2", item: "Towel" }),
      request({ pageId: "req-3", item: "Sold Out Thing" }),
    ]);

    const result = await notifyRestock();

    expect(result.status).toBe("sent");
    expect(result.notified).toBe(2);
    expect(result.items).toEqual([
      { item: "Soaker", notified: 1 },
      { item: "Towel", notified: 1 },
    ]);
  });

  it("narrows to one piece when named, leaving the rest alone", async () => {
    mockVariants.mockResolvedValue([
      variant({ id: "inv-1", name: "Soaker" }),
      variant({ id: "inv-2", name: "Towel" }),
    ]);
    mockRequests.mockResolvedValue([
      request({ pageId: "req-1", item: "Soaker" }),
      request({ pageId: "req-2", item: "Towel" }),
    ]);

    const result = await notifyRestock({ item: "Soaker" });

    expect(result.notified).toBe(1);
    expect(result.item).toBe("Soaker");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("reports not_found for a name no piece carries", async () => {
    mockVariants.mockResolvedValue([variant({ name: "Soaker" })]);

    const result = await notifyRestock({ item: "Nothing Here" });

    expect(result.status).toBe("not_found");
    expect(mockSend).not.toHaveBeenCalled();
  });

  // Naming a piece never asserts it is in stock — the sweep still decides.
  it("refuses to alert on a named piece that isn't in stock", async () => {
    mockVariants.mockResolvedValue([
      variant({ name: "Soaker", available: false }),
    ]);
    mockRequests.mockResolvedValue([request({ item: "Soaker" })]);

    const result = await notifyRestock({ item: "Soaker" });

    expect(result).toMatchObject({ status: "skipped", reason: "not in stock" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips without reading requests when nothing at all is in stock", async () => {
    mockVariants.mockResolvedValue([variant({ available: false })]);

    const result = await notifyRestock();

    expect(result.status).toBe("skipped");
    expect(mockRequests).not.toHaveBeenCalled();
  });
});

describe("notifyRestock — sending", () => {
  it("emails each waiting customer and claims their request", async () => {
    process.env.PUBLIC_BASE_URL = "https://a3iceanddance.com";
    mockVariants.mockResolvedValue([variant()]);
    mockRequests.mockResolvedValue([
      request({ pageId: "req-1", email: "a@example.com" }),
      request({ pageId: "req-2", email: "b@example.com" }),
    ]);

    const result = await notifyRestock();

    expect(result).toMatchObject({ status: "sent", notified: 2 });
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0]).toMatchObject({
      to: "a@example.com",
      subject: "Back in stock: Bow Fleece Soaker — Black",
    });
    expect(mockSend.mock.calls[0][0].html).toContain(
      "https://a3iceanddance.com/shop/inv-1",
    );
    expect(mockClaim.mock.calls.map((c) => c[0].requestPageId)).toEqual([
      "req-1",
      "req-2",
    ]);
  });

  it("claims before it sends, so a lost claim sends nothing", async () => {
    mockVariants.mockResolvedValue([variant()]);
    mockRequests.mockResolvedValue([request()]);
    mockClaim.mockResolvedValue(false);

    const result = await notifyRestock();

    expect(result).toMatchObject({
      status: "skipped",
      notified: 0,
      alreadyAlerted: 1,
      reason: "everyone waiting has already been told",
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  // Fail closed: an unrecorded alert repeats on the next run, so an outage must
  // suppress the send rather than risk a duplicate.
  it("skips the send when the claim itself errors", async () => {
    mockVariants.mockResolvedValue([variant()]);
    mockRequests.mockResolvedValue([request()]);
    mockClaim.mockRejectedValue(new Error("postgres down"));

    const result = await notifyRestock();

    expect(result.notified).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("alerts only the sizes that actually came back", async () => {
    mockVariants.mockResolvedValue([
      variant({
        sizes: [
          { name: "S", available: false },
          { name: "M", available: true },
        ],
      }),
    ]);
    mockRequests.mockResolvedValue([
      request({ pageId: "req-1", email: "m@example.com", size: "M" }),
      request({ pageId: "req-2", email: "s@example.com", size: "S" }),
    ]);

    const result = await notifyRestock();

    expect(result).toMatchObject({ status: "sent", notified: 1, unmatched: 1 });
    expect(mockSend.mock.calls[0][0].to).toBe("m@example.com");
    // The unanswered request is never claimed, so it stays in the queue.
    expect(mockClaim.mock.calls.map((c) => c[0].requestPageId)).toEqual([
      "req-1",
    ]);
  });

  it("names the size in the alert it does send", async () => {
    mockVariants.mockResolvedValue([
      variant({ sizes: [{ name: "M", available: true }] }),
    ]);
    mockRequests.mockResolvedValue([request({ size: "M" })]);

    await notifyRestock();

    expect(mockSend.mock.calls[0][0].subject).toBe(
      "Back in stock: Bow Fleece Soaker — Black · M",
    );
  });

  it("explains a sweep that found nobody waiting on what's in stock", async () => {
    mockVariants.mockResolvedValue([variant()]);
    mockRequests.mockResolvedValue([request({ item: "Something Else" })]);

    const result = await notifyRestock();

    expect(result).toMatchObject({
      status: "skipped",
      reason: "there was nobody waiting on what's in stock",
    });
  });

  it("omits the shop link when PUBLIC_BASE_URL is unset", async () => {
    mockVariants.mockResolvedValue([variant()]);
    mockRequests.mockResolvedValue([request()]);

    await notifyRestock();

    expect(mockSend.mock.calls[0][0].html).not.toContain("View it in the shop");
  });
});
