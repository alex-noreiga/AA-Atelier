import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, type ReactNode } from "react";

// The reminder form asks only for an email and snapshots the cart itself. Mock
// the generated mutation to capture the submit payload and control the
// pending/success render states, no network.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  useRequestCartReminder: () => ({
    mutate: hoisted.mutate,
    isPending: hoisted.isPending,
    isSuccess: hoisted.isSuccess,
  }),
}));

import { CartProvider, useCart } from "@/lib/cart";
import { CartReminder } from "@/components/cart-reminder";

beforeEach(() => {
  localStorage.clear();
  hoisted.isPending = false;
  hoisted.isSuccess = false;
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

/** Seed the cart through the provider's own API, so the snapshot the form sends
 * comes from real cart state rather than a hand-built duplicate. */
function Seed() {
  const { items, addItem } = useCart();
  if (items.length === 0) {
    act(() =>
      addItem(
        { variantId: "v1", name: "Bow Fleece Soaker", size: "S", price: 24 },
        2,
      ),
    );
  }
  return null;
}

describe("CartReminder", () => {
  it("renders nothing for an empty cart", () => {
    render(<CartReminder />, { wrapper });
    expect(screen.queryByTestId("cart-reminder-form")).not.toBeInTheDocument();
  });

  it("submits the email with a snapshot of the cart lines", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Seed />
        <CartReminder />
      </>,
      { wrapper },
    );

    await user.type(
      screen.getByTestId("cart-reminder-email"),
      "grace@example.com",
    );
    await user.click(screen.getByTestId("cart-reminder-submit"));

    expect(hoisted.mutate).toHaveBeenCalledTimes(1);
    const { data } = hoisted.mutate.mock.calls[0][0];
    expect(data).toMatchObject({
      email: "grace@example.com",
      website: "", // honeypot left empty by a real user
      items: [
        {
          variantId: "v1",
          name: "Bow Fleece Soaker",
          size: "S",
          quantity: 2,
          price: 24,
        },
      ],
    });
    expect(typeof data.elapsedMs).toBe("number");
  });

  it("shows an inline error and does not submit a malformed email", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Seed />
        <CartReminder />
      </>,
      { wrapper },
    );

    await user.type(screen.getByTestId("cart-reminder-email"), "not-an-email");
    await user.click(screen.getByTestId("cart-reminder-submit"));

    expect(
      await screen.findByTestId("cart-reminder-error"),
    ).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("replaces the form with a confirmation once saved", () => {
    hoisted.isSuccess = true;
    render(
      <>
        <Seed />
        <CartReminder />
      </>,
      { wrapper },
    );

    expect(screen.getByTestId("cart-reminder-success")).toBeInTheDocument();
    expect(screen.queryByTestId("cart-reminder-form")).not.toBeInTheDocument();
  });
});
