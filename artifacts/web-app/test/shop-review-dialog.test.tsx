import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Capture the mutation call and the onError handler the dialog wires up, so we
// can assert the submit payload and drive the error-render path — all without
// the network. `vi.hoisted` makes these available inside the hoisted vi.mock.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  handlers: { onError: undefined as undefined | ((e: unknown) => void) },
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateShopOrderReview: (opts: {
    mutation?: { onError?: (e: unknown) => void };
  }) => {
    hoisted.handlers.onError = opts?.mutation?.onError;
    return { mutate: hoisted.mutate, isPending: false };
  },
}));

import { ShopReviewDialog } from "@/components/shop-review-dialog";

const ONE_PIECE = [{ id: "inv-a", name: "Aurora Soaker" }];
const TWO_PIECES = [
  { id: "inv-a", name: "Aurora Soaker" },
  { id: "inv-b", name: "Blade Towel" },
];

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

async function open(
  user: ReturnType<typeof userEvent.setup>,
  items = ONE_PIECE,
) {
  render(<ShopReviewDialog orderNumber="SHP-ABC-1234" items={items} />);
  await user.click(screen.getByTestId("button-review-piece"));
  await screen.findByTestId("shop-review-dialog");
}

afterEach(() => {
  hoisted.handlers.onError = undefined;
  hoisted.mutate.mockReset();
});

describe("ShopReviewDialog — which piece", () => {
  // With one piece on the order there is nothing to choose, so it is stated
  // rather than asked, and the customer never has to answer a settled question.
  it("pre-selects the only piece and asks nothing about it", async () => {
    const user = userEvent.setup();
    await open(user);

    expect(screen.queryByTestId("shop-review-piece-inv-a")).toBeNull();
    expect(screen.getByTestId("shop-review-dialog")).toHaveTextContent(
      "Aurora Soaker",
    );

    await user.type(byId("shop-review-email"), "ada@example.com");
    await user.click(screen.getByTestId("shop-review-rating-5"));
    await user.type(byId("shop-review-comment"), "Warm and well made.");
    await user.click(screen.getByTestId("shop-review-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    expect(hoisted.mutate.mock.calls[0][0].data.productId).toBe("inv-a");
  });

  it("offers a choice when the order holds several pieces", async () => {
    const user = userEvent.setup();
    await open(user, TWO_PIECES);

    await user.type(byId("shop-review-email"), "ada@example.com");
    await user.click(screen.getByTestId("shop-review-piece-inv-b"));
    await user.click(screen.getByTestId("shop-review-rating-4"));
    await user.type(byId("shop-review-comment"), "Dries overnight.");
    await user.click(screen.getByTestId("shop-review-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const { data, orderNumber } = hoisted.mutate.mock.calls[0][0];
    expect(orderNumber).toBe("SHP-ABC-1234");
    expect(data).toMatchObject({
      email: "ada@example.com",
      productId: "inv-b",
      rating: 4,
      comment: "Dries overnight.",
      consentToPublish: false,
    });
  });

  it("won't submit until a piece is chosen", async () => {
    const user = userEvent.setup();
    await open(user, TWO_PIECES);

    await user.type(byId("shop-review-email"), "ada@example.com");
    await user.click(screen.getByTestId("shop-review-rating-5"));
    await user.type(byId("shop-review-comment"), "Lovely.");
    await user.click(screen.getByTestId("shop-review-submit"));

    expect(
      await screen.findByText(/choose which piece you're reviewing/i),
    ).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });
});

describe("ShopReviewDialog — submission", () => {
  it("omits an empty display name and sends consent when ticked", async () => {
    const user = userEvent.setup();
    await open(user);

    await user.type(byId("shop-review-email"), "ada@example.com");
    await user.click(screen.getByTestId("shop-review-rating-5"));
    await user.type(byId("shop-review-comment"), "  Beautiful.  ");
    await user.click(screen.getByTestId("shop-review-consent"));
    await user.click(screen.getByTestId("shop-review-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const { data } = hoisted.mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("displayName");
    expect(data).not.toHaveProperty("photoIds");
    expect(data.comment).toBe("Beautiful.");
    expect(data.consentToPublish).toBe(true);
  });

  it("won't submit without a rating", async () => {
    const user = userEvent.setup();
    await open(user);

    await user.type(byId("shop-review-email"), "ada@example.com");
    await user.type(byId("shop-review-comment"), "Lovely.");
    await user.click(screen.getByTestId("shop-review-submit"));

    expect(
      await screen.findByText(/choose a star rating/i),
    ).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  // The server's refusals are the ones a customer can act on, so they are shown
  // in the form rather than thrown at a toast that scrolls away.
  it.each([
    [400, "That piece isn't on this order."],
    [403, "That email doesn't match the one on this order."],
    [409, "You can leave a review once your order has been delivered."],
  ])("shows the server's %i inline", async (status, error) => {
    const user = userEvent.setup();
    await open(user);

    await user.type(byId("shop-review-email"), "ada@example.com");
    await user.click(screen.getByTestId("shop-review-rating-5"));
    await user.type(byId("shop-review-comment"), "Lovely.");
    await user.click(screen.getByTestId("shop-review-submit"));
    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalled());

    hoisted.handlers.onError?.({ status, data: { error } });

    expect(await screen.findByTestId("shop-review-error")).toHaveTextContent(
      error,
    );
  });
});
