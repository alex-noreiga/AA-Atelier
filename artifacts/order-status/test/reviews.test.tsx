import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { reviewRecord } from "@workspace/test-fixtures";
import { stubHook } from "./support/mock-hook.js";

// The reviews page reads one query hook (the list) and one mutation hook (the
// submit). Mock both; drive the list through its render states and capture what
// the form submits.
const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useListReviews: vi.fn(),
  useCreateReview: () => ({ mutate, isPending: false }),
}));

import { useListReviews } from "@workspace/api-client-react";
import Reviews from "@/pages/reviews";

const mockList = vi.mocked(useListReviews);

beforeEach(() => {
  mutate.mockReset();
  stubHook(mockList, { data: { reviews: [] } });
});

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

describe("Reviews — display states", () => {
  it("shows a loading indicator while the list loads", () => {
    stubHook(mockList, { isLoading: true });
    render(<Reviews />);
    expect(screen.getByTestId("reviews-loading")).toBeInTheDocument();
  });

  it("shows an empty state when there are no reviews", () => {
    stubHook(mockList, { data: { reviews: [] } });
    render(<Reviews />);
    expect(screen.getByTestId("reviews-empty")).toBeInTheDocument();
  });

  it("renders published reviews", () => {
    stubHook(mockList, {
      data: {
        reviews: [
          reviewRecord({ id: "r1", name: "Ada", body: "Beautiful dress." }),
        ],
      },
    });
    render(<Reviews />);
    expect(screen.getByTestId("review-r1")).toBeInTheDocument();
    expect(screen.getByText("Beautiful dress.")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("shows an error state without hiding the form", () => {
    stubHook(mockList, { isError: true });
    render(<Reviews />);
    expect(screen.getByTestId("reviews-error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit Review" }),
    ).toBeInTheDocument();
  });
});

describe("Reviews — submission mapping", () => {
  async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
    await user.type(byId("orderNumber"), "ORD-1");
    await user.type(byId("email"), "ada@example.com");
    await user.type(byId("name"), "Ada Lovelace");
    await user.click(screen.getByRole("radio", { name: "5 stars" }));
    await user.type(byId("body"), "The dress was exquisite.");
  }

  it("omits an empty title from the payload", async () => {
    const user = userEvent.setup();
    render(<Reviews />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Submit Review" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("title");
    expect(data).toMatchObject({
      orderNumber: "ORD-1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      rating: 5,
      body: "The dress was exquisite.",
    });
  });

  it("includes the title when provided", async () => {
    const user = userEvent.setup();
    render(<Reviews />);
    await fillRequired(user);
    await user.type(byId("title"), "Loved it");
    await user.click(screen.getByRole("button", { name: "Submit Review" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].data.title).toBe("Loved it");
  });

  it("omits the order number for a shop review (blank)", async () => {
    const user = userEvent.setup();
    render(<Reviews />);
    // Leave order number blank — the shop path is verified by email server-side.
    await user.type(byId("email"), "ada@example.com");
    await user.type(byId("name"), "Ada Lovelace");
    await user.click(screen.getByRole("radio", { name: "5 stars" }));
    await user.type(byId("body"), "The dress was exquisite.");
    await user.click(screen.getByRole("button", { name: "Submit Review" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("orderNumber");
    expect(data).toMatchObject({
      email: "ada@example.com",
      name: "Ada Lovelace",
      rating: 5,
    });
  });

  it("does not submit without a rating", async () => {
    const user = userEvent.setup();
    render(<Reviews />);
    await user.type(byId("orderNumber"), "ORD-1");
    await user.type(byId("email"), "ada@example.com");
    await user.type(byId("name"), "Ada Lovelace");
    await user.type(byId("body"), "The dress was exquisite.");
    await user.click(screen.getByRole("button", { name: "Submit Review" }));

    await waitFor(() =>
      expect(screen.getByText("Please select a rating")).toBeInTheDocument(),
    );
    expect(mutate).not.toHaveBeenCalled();
  });
});
