import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/requests.repository.js", () => ({
  listOpenRequests: vi.fn(),
  listClosedRequests: vi.fn(),
  findRequestById: vi.fn(),
  setRequestStage: vi.fn(),
}));

import {
  getRequestQueue,
  setRequestQueueState,
} from "../../src/services/studio-requests.service.js";
import {
  listOpenRequests,
  listClosedRequests,
  findRequestById,
  setRequestStage,
} from "../../src/lib/notion/requests.repository.js";
import type { StudioRequestRecord } from "../../src/lib/notion/requests.schema.js";
import { NotFoundError } from "../../src/lib/errors.js";

const mockOpen = vi.mocked(listOpenRequests);
const mockClosed = vi.mocked(listClosedRequests);
const mockFind = vi.mocked(findRequestById);
const mockSet = vi.mocked(setRequestStage);

function record(
  overrides: Partial<StudioRequestRecord> = {},
): StudioRequestRecord {
  return {
    id: "req-1",
    kind: "cancellation",
    subject: "Cancellation: ORD-000002",
    state: "new",
    orderNumber: "ORD-000002",
    action: { tool: "cancellation-refund", orderNumber: "ORD-000002" },
    ...overrides,
  };
}

beforeEach(() => {
  mockOpen.mockResolvedValue({ records: [], truncated: false });
  mockClosed.mockResolvedValue([]);
});

describe("getRequestQueue", () => {
  it("serves the open queue and the closed record as the repository ordered them", async () => {
    mockOpen.mockResolvedValue({
      records: [record({ id: "oldest" }), record({ id: "newer" })],
      truncated: true,
    });
    mockClosed.mockResolvedValue([record({ id: "done", state: "closed" })]);

    const queue = await getRequestQueue();

    expect(queue.open.map((r) => r.id)).toEqual(["oldest", "newer"]);
    expect(queue.closed.map((r) => r.id)).toEqual(["done"]);
    expect(queue.truncated).toBe(true);
  });

  // The closed list is the undo history; the open one is the feature. Losing
  // the first must not cost the atelier the second.
  it("still serves the queue when the closed rows can't be read", async () => {
    mockOpen.mockResolvedValue({ records: [record()], truncated: false });
    mockClosed.mockRejectedValue(new Error("Notion is having a moment"));

    const queue = await getRequestQueue();

    expect(queue.open).toHaveLength(1);
    expect(queue.closed).toEqual([]);
  });

  it("fails loudly when the open queue itself can't be read", async () => {
    mockOpen.mockRejectedValue(new Error("Notion is having a moment"));

    await expect(getRequestQueue()).rejects.toThrow(
      "Notion is having a moment",
    );
  });
});

describe("setRequestQueueState", () => {
  it("writes the state and returns the row as it now stands", async () => {
    mockFind.mockResolvedValue(record());
    mockSet.mockResolvedValue(record({ state: "closed" }));

    const updated = await setRequestQueueState("req-1", "closed");

    expect(mockSet).toHaveBeenCalledWith("req-1", "closed");
    expect(updated.state).toBe("closed");
  });

  it("404s for a request deleted in Notion since the queue loaded", async () => {
    mockFind.mockResolvedValue(null);

    await expect(setRequestQueueState("gone", "closed")).rejects.toThrow(
      NotFoundError,
    );
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("404s when the row disappears between the read and the write", async () => {
    mockFind.mockResolvedValue(record());
    mockSet.mockResolvedValue(null);

    await expect(setRequestQueueState("req-1", "closed")).rejects.toThrow(
      NotFoundError,
    );
  });
});
