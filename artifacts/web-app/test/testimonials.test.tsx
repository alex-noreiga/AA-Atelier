import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useGetPublishedReviews } from "@workspace/api-client-react";
import { Testimonials } from "@/components/testimonials";
import { stubHook } from "./support/mock-hook";

vi.mock("@workspace/api-client-react", () => ({
  useGetPublishedReviews: vi.fn(),
}));

const mockHook = vi.mocked(useGetPublishedReviews);

const review = (overrides: Record<string, unknown> = {}) => ({
  id: "rev-1",
  rating: 5,
  comment: "The fit was perfect the first time on the ice.",
  customerName: "Ada L.",
  publishedAt: "2026-07-04T09:30:00.000Z",
  ...overrides,
});

describe("Testimonials", () => {
  it("renders each published testimonial with its rating", () => {
    stubHook(mockHook as never, {
      data: {
        reviews: [
          review(),
          review({ id: "rev-2", rating: 4, comment: "Worth every stitch." }),
        ],
      },
    });

    render(<Testimonials />);

    expect(screen.getAllByTestId("testimonial")).toHaveLength(2);
    expect(
      screen.getByText(/the fit was perfect the first time/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "4 out of 5 stars" }),
    ).toBeInTheDocument();
  });

  it("credits the customer and dates the quote by month", () => {
    stubHook(mockHook as never, { data: { reviews: [review()] } });

    render(<Testimonials />);

    expect(screen.getByText("Ada L. · July 2026")).toBeInTheDocument();
  });

  it("leaves the quote unattributed when the customer wasn't credited", () => {
    stubHook(mockHook as never, {
      data: { reviews: [review({ customerName: undefined })] },
    });

    render(<Testimonials />);

    expect(screen.getByTestId("testimonial")).toBeInTheDocument();
    expect(screen.getByText("July 2026")).toBeInTheDocument();
  });

  it("shows no byline at all when there is neither a name nor a date", () => {
    stubHook(mockHook as never, {
      data: {
        reviews: [review({ customerName: undefined, publishedAt: undefined })],
      },
    });

    render(<Testimonials />);

    expect(screen.getByTestId("testimonial")).toBeInTheDocument();
    expect(screen.queryByText("·")).not.toBeInTheDocument();
  });

  // The whole section is optional garnish on pages that stand on their own, so
  // every non-happy path must render nothing rather than a hole or an empty state.
  it.each([
    ["nothing is published yet", { data: { reviews: [] } }],
    ["the request is still loading", { isLoading: true }],
    ["the request failed", { isError: true }],
  ])("renders nothing when %s", (_label, state) => {
    stubHook(mockHook as never, state);

    const { container } = render(<Testimonials />);

    expect(screen.queryByTestId("testimonials")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("asks for only a strip's worth of testimonials", () => {
    stubHook(mockHook as never, { data: { reviews: [] } });

    render(<Testimonials />);

    expect(mockHook).toHaveBeenCalledWith({ limit: 3 });
  });

  it("lets a page supply its own section heading", () => {
    stubHook(mockHook as never, { data: { reviews: [review()] } });

    render(<Testimonials eyebrow="In Their Words" title="What skaters say" />);

    expect(
      screen.getByRole("heading", { name: "What skaters say" }),
    ).toBeInTheDocument();
  });
});
