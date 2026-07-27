import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Capture the mutation call and the onError handler the dialog wires up, so we
// can assert the submit payload and drive the error-render path — all without
// the network. `vi.hoisted` makes these available inside the hoisted vi.mock.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  handlers: { onError: undefined as undefined | ((e: unknown) => void) },
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateOrderReview: (opts: {
    mutation?: { onError?: (e: unknown) => void };
  }) => {
    hoisted.handlers.onError = opts?.mutation?.onError;
    return { mutate: hoisted.mutate, isPending: false };
  },
}));

import { ReviewDialog } from "@/components/review-dialog";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  render(<ReviewDialog orderNumber="000002" />);
  await user.click(screen.getByTestId("button-leave-review"));
  await screen.findByTestId("review-dialog");
}

afterEach(() => {
  hoisted.handlers.onError = undefined;
});

describe("ReviewDialog submission mapping", () => {
  it("sends the orderNumber, rating, comment and consent, omitting an empty display name", async () => {
    const user = userEvent.setup();
    await open(user);

    await user.type(byId("review-email"), "ada@example.com");
    await user.click(screen.getByTestId("review-rating-5"));
    await user.type(byId("review-comment"), "Beautiful work!");
    await user.click(screen.getByTestId("review-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const arg = hoisted.mutate.mock.calls[0][0];
    expect(arg.orderNumber).toBe("000002");
    expect(arg.data).not.toHaveProperty("displayName");
    expect(arg.data).not.toHaveProperty("photoIds");
    expect(arg.data).toMatchObject({
      email: "ada@example.com",
      rating: 5,
      comment: "Beautiful work!",
      consentToPublish: false,
    });
  });

  it("includes the display name and consent when provided", async () => {
    const user = userEvent.setup();
    await open(user);

    await user.type(byId("review-email"), "ada@example.com");
    await user.click(screen.getByTestId("review-rating-4"));
    await user.type(byId("review-comment"), "Lovely fit");
    await user.type(byId("review-display-name"), "Ada L.");
    await user.click(screen.getByTestId("review-consent"));
    await user.click(screen.getByTestId("review-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const arg = hoisted.mutate.mock.calls[0][0];
    expect(arg.data.rating).toBe(4);
    expect(arg.data.displayName).toBe("Ada L.");
    expect(arg.data.consentToPublish).toBe(true);
  });
});

describe("ReviewDialog validation & errors", () => {
  it("blocks submission and asks for a rating when none is chosen", async () => {
    const user = userEvent.setup();
    await open(user);

    await user.type(byId("review-email"), "ada@example.com");
    await user.type(byId("review-comment"), "Great!");
    await user.click(screen.getByTestId("review-submit"));

    expect(
      await screen.findByText("Please choose a star rating"),
    ).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("blocks submission and shows a message for an invalid email", async () => {
    const user = userEvent.setup();
    await open(user);

    fireEvent.change(byId("review-email"), { target: { value: "nope" } });
    await user.click(screen.getByTestId("review-rating-5"));
    await user.type(byId("review-comment"), "Great!");
    await user.click(screen.getByTestId("review-submit"));

    expect(
      await screen.findByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("surfaces a 403/409 error inline in the form", async () => {
    const user = userEvent.setup();
    await open(user);

    act(() => {
      hoisted.handlers.onError?.({
        status: 409,
        data: {
          error: "You can leave a review once your order has been delivered.",
        },
      });
    });

    expect(await screen.findByTestId("review-error")).toHaveTextContent(
      "You can leave a review once your order has been delivered.",
    );
  });
});
