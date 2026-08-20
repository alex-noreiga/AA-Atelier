// The review moderation queue. The generated hooks are mocked, so what's tested
// is the panel's own job: showing what the atelier decides on, sending the
// decision, and — the case that matters — never offering to publish a review
// the customer didn't consent to publishing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({
  queue: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  decide: { mutate: vi.fn(), isPending: false },
  invalidate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListStudioReviews: () => h.queue,
  useSetStudioReviewStatus: () => h.decide,
  getListStudioReviewsQueryKey: () => ["/api/studio/reviews"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));

import { StudioReviews } from "@/components/studio-reviews";

const decideMutate = h.decide.mutate as unknown as Mock;

const REVIEW = {
  id: "rev-1",
  rating: 5,
  comment: "The fit was perfect.",
  customerName: "Ada L.",
  orderNumber: "000002",
  email: "ada@example.com",
  emailVerified: true,
  consentToPublish: true,
  status: "pending",
  rawStatus: "New",
  submittedAt: "2026-08-01T12:00:00.000Z",
  notionUrl: "https://notion.so/rev-1",
  photos: [] as string[],
};

function queue(pending: unknown[], decided: unknown[] = [], truncated = false) {
  h.queue.data = { pending, decided, truncated };
}

beforeEach(() => {
  h.queue = { data: undefined, isLoading: false, isError: false, error: null };
  h.decide.isPending = false;
  decideMutate.mockReset();
  queue([]);
});

describe("StudioReviews", () => {
  it("shows the words, the stars, and who wrote them", () => {
    queue([REVIEW]);
    render(<StudioReviews />);

    expect(screen.getByText("The fit was perfect.")).toBeInTheDocument();
    expect(screen.getByLabelText("5 out of 5 stars")).toBeInTheDocument();
    expect(
      screen.getByText(/Ada L\..*000002.*ada@example\.com/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("reviews-pending-count")).toHaveTextContent(
      "1 waiting",
    );
  });

  it("renders the customer's photographs of the finished piece", () => {
    queue([{ ...REVIEW, photos: ["https://notion/a.png"] }]);
    render(<StudioReviews />);

    const photos = screen.getByTestId("review-photos-rev-1");
    expect(photos.querySelectorAll("img")).toHaveLength(1);
  });

  it("publishes a review in one press", async () => {
    queue([REVIEW]);
    render(<StudioReviews />);

    await userEvent.click(screen.getByTestId("review-publish-rev-1"));

    expect(decideMutate).toHaveBeenCalledWith(
      { reviewId: "rev-1", data: { status: "published" } },
      expect.anything(),
    );
  });

  it("sets a review aside in one press", async () => {
    queue([REVIEW]);
    render(<StudioReviews />);

    await userEvent.click(screen.getByTestId("review-reject-rev-1"));

    expect(decideMutate).toHaveBeenCalledWith(
      { reviewId: "rev-1", data: { status: "rejected" } },
      expect.anything(),
    );
  });

  // The gate the site enforces, surfaced before the button rather than after
  // the press: the atelier cannot consent on a customer's behalf.
  it("offers no publish button without the customer's consent, and says why", () => {
    queue([{ ...REVIEW, consentToPublish: false }]);
    render(<StudioReviews />);

    expect(screen.queryByTestId("review-publish-rev-1")).toBeNull();
    expect(screen.getByTestId("review-no-consent-rev-1")).toHaveTextContent(
      /didn't agree/,
    );
    // Setting it aside is still available.
    expect(screen.getByTestId("review-reject-rev-1")).toBeInTheDocument();
  });

  it("flags a review whose email didn't match the order", () => {
    queue([{ ...REVIEW, emailVerified: false }]);
    render(<StudioReviews />);

    expect(screen.getByTestId("review-flags-rev-1")).toHaveTextContent(
      /doesn't match one stored on the order/,
    );
  });

  it("says nothing about a verified, consenting review", () => {
    queue([REVIEW]);
    render(<StudioReviews />);
    expect(screen.queryByTestId("review-flags-rev-1")).toBeNull();
  });

  it("lets a decision be undone", async () => {
    queue([], [{ ...REVIEW, status: "published" }]);
    render(<StudioReviews />);

    expect(screen.getByTestId("review-status-rev-1")).toHaveTextContent(
      "On the site",
    );
    await userEvent.click(screen.getByTestId("review-requeue-rev-1"));

    expect(decideMutate).toHaveBeenCalledWith(
      { reviewId: "rev-1", data: { status: "pending" } },
      expect.anything(),
    );
  });

  it("offers to take a published review back off the site", () => {
    queue([], [{ ...REVIEW, status: "published" }]);
    render(<StudioReviews />);
    expect(screen.getByTestId("review-reject-rev-1")).toHaveTextContent(
      "Take down",
    );
  });

  it("says so when nothing is waiting", () => {
    queue([]);
    render(<StudioReviews />);
    expect(screen.getByTestId("reviews-empty")).toBeInTheDocument();
  });

  it("shows the server's refusal verbatim when a decision is rejected", async () => {
    queue([REVIEW]);
    decideMutate.mockImplementation((_vars, opts) =>
      opts.onError({ data: { error: "That review is locked." } }),
    );
    render(<StudioReviews />);

    await userEvent.click(screen.getByTestId("review-reject-rev-1"));

    expect(screen.getByTestId("review-error-rev-1")).toHaveTextContent(
      "That review is locked.",
    );
  });

  it("refreshes the queue once a decision lands", async () => {
    queue([REVIEW]);
    decideMutate.mockImplementation((_vars, opts) => opts.onSuccess());
    render(<StudioReviews />);

    await userEvent.click(screen.getByTestId("review-reject-rev-1"));

    expect(h.invalidate).toHaveBeenCalled();
  });

  it("admits when the list is partial rather than looking complete", () => {
    queue([REVIEW], [], true);
    render(<StudioReviews />);
    expect(
      screen.getByText(/Only the most recent reviews are listed/),
    ).toBeInTheDocument();
  });

  it("shows the server's message when the queue can't be read", () => {
    h.queue.isError = true;
    h.queue.error = { data: { error: "Notion is unavailable." } };
    render(<StudioReviews />);
    expect(screen.getByTestId("reviews-error")).toHaveTextContent(
      "Notion is unavailable.",
    );
  });
});
