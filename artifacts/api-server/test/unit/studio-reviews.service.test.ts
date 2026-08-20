import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  listReviewsForModeration: vi.fn(),
  findReviewById: vi.fn(),
  setReviewStatus: vi.fn(),
  listReviewPhotos: vi.fn(),
}));

import {
  getReviewQueue,
  setReviewModeration,
  MODERATION_PHOTO_LIMIT,
  DECIDED_REVIEW_LIMIT,
} from "../../src/services/studio-reviews.service.js";
import {
  listReviewsForModeration,
  findReviewById,
  setReviewStatus,
  listReviewPhotos,
} from "../../src/lib/notion/reviews.repository.js";
import type { StudioReviewRecord } from "../../src/lib/notion/reviews.schema.js";

const mockList = vi.mocked(listReviewsForModeration);
const mockFind = vi.mocked(findReviewById);
const mockSet = vi.mocked(setReviewStatus);
const mockPhotos = vi.mocked(listReviewPhotos);

function record(
  overrides: Partial<StudioReviewRecord> = {},
): StudioReviewRecord {
  return {
    id: "rev-1",
    rating: 5,
    comment: "Beautiful work.",
    emailVerified: true,
    consentToPublish: true,
    status: "pending",
    submittedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockList.mockResolvedValue({ records: [], truncated: false });
  mockPhotos.mockResolvedValue([]);
});

describe("getReviewQueue", () => {
  it("splits pending from decided, and works the queue oldest first", async () => {
    // The repository reads newest-first.
    mockList.mockResolvedValue({
      records: [
        record({ id: "new-pending", submittedAt: "2026-08-03T00:00:00.000Z" }),
        record({ id: "published", status: "published" }),
        record({ id: "old-pending", submittedAt: "2026-08-01T00:00:00.000Z" }),
      ],
      truncated: false,
    });

    const queue = await getReviewQueue();

    expect(queue.pending.map((r) => r.id)).toEqual([
      "old-pending",
      "new-pending",
    ]);
    expect(queue.decided.map((r) => r.id)).toEqual(["published"]);
  });

  it("fetches photos for the pending rows only — a decision is made on those", async () => {
    mockList.mockResolvedValue({
      records: [
        record({ id: "waiting" }),
        record({ id: "done", status: "rejected" }),
      ],
      truncated: false,
    });
    mockPhotos.mockResolvedValue(["https://notion/a.png"]);

    const queue = await getReviewQueue();

    expect(mockPhotos).toHaveBeenCalledTimes(1);
    expect(mockPhotos).toHaveBeenCalledWith("waiting");
    expect(queue.pending[0].photos).toEqual(["https://notion/a.png"]);
    expect(queue.decided[0].photos).toEqual([]);
  });

  it("shows a review whose photos can't be read, rather than failing the queue", async () => {
    mockList.mockResolvedValue({ records: [record()], truncated: false });
    mockPhotos.mockRejectedValue(new Error("notion down"));

    const queue = await getReviewQueue();

    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0].photos).toEqual([]);
  });

  it("bounds how many photo reads one dashboard load can cost", async () => {
    const many = Array.from({ length: MODERATION_PHOTO_LIMIT + 5 }, (_, i) =>
      record({ id: `rev-${i}` }),
    );
    mockList.mockResolvedValue({ records: many, truncated: false });

    const queue = await getReviewQueue();

    // Every review is still listed; only the photo fetching is capped.
    expect(queue.pending).toHaveLength(many.length);
    expect(mockPhotos).toHaveBeenCalledTimes(MODERATION_PHOTO_LIMIT);
    expect(queue.pending.at(-1)?.photos).toEqual([]);
  });

  it("caps the decided list — it is a record, not a second queue", async () => {
    mockList.mockResolvedValue({
      records: Array.from({ length: DECIDED_REVIEW_LIMIT + 4 }, (_, i) =>
        record({ id: `d-${i}`, status: "published" }),
      ),
      truncated: false,
    });

    expect((await getReviewQueue()).decided).toHaveLength(DECIDED_REVIEW_LIMIT);
  });

  it("passes the read's truncation through, so the queue can say it's partial", async () => {
    mockList.mockResolvedValue({ records: [], truncated: true });
    expect((await getReviewQueue()).truncated).toBe(true);
  });
});

describe("setReviewModeration", () => {
  it("writes the decision and returns the row as it now stands", async () => {
    mockFind.mockResolvedValue(record());
    mockSet.mockResolvedValue(record({ status: "published" }));

    const review = await setReviewModeration("rev-1", "published");

    expect(mockSet).toHaveBeenCalledWith("rev-1", "published");
    expect(review.status).toBe("published");
    // The caller already has the photos it displayed; echoing them back would
    // double the cost of every click.
    expect(review.photos).toEqual([]);
    expect(mockPhotos).not.toHaveBeenCalled();
  });

  it("refuses to publish a review the customer didn't consent to", async () => {
    mockFind.mockResolvedValue(record({ consentToPublish: false }));

    await expect(setReviewModeration("rev-1", "published")).rejects.toThrow(
      /didn't agree/,
    );
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("still lets a non-consenting review be set aside or re-queued", async () => {
    mockFind.mockResolvedValue(record({ consentToPublish: false }));
    mockSet.mockResolvedValue(
      record({ consentToPublish: false, status: "rejected" }),
    );

    await expect(
      setReviewModeration("rev-1", "rejected"),
    ).resolves.toMatchObject({ status: "rejected" });
  });

  it("404s a review the queue listed but Notion no longer has", async () => {
    mockFind.mockResolvedValue(null);
    await expect(setReviewModeration("gone", "rejected")).rejects.toThrow(
      /no longer exists/,
    );
  });

  it("404s when the row disappears between the read and the write", async () => {
    mockFind.mockResolvedValue(record());
    mockSet.mockResolvedValue(null);
    await expect(setReviewModeration("rev-1", "rejected")).rejects.toThrow(
      /no longer exists/,
    );
  });
});
