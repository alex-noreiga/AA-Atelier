import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// CartButton instantiates the checkout mutation hook; mock the generated module
// so no QueryClient/network is needed and we can capture what it submits.
vi.mock("@workspace/api-client-react", () => ({
  useCreateCheckoutSession: vi.fn(),
}));

import { useCreateCheckoutSession } from "@workspace/api-client-react";
import { CartProvider, useCart } from "@/lib/cart";
import { AddToCartButton } from "@/components/add-to-cart";
import { CartButton } from "@/components/cart-drawer";

const mockCheckout = vi.mocked(useCreateCheckoutSession);
const checkoutMutate = vi.fn();

beforeEach(() => {
  localStorage.clear();
  checkoutMutate.mockReset();
  mockCheckout.mockReturnValue({
    mutate: checkoutMutate,
    isPending: false,
  } as never);
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    name: "Bow Fleece Soaker",
    available: true,
    price: 22,
    photos: [],
    sizes: [],
    ...overrides,
  } as never;
}

describe("cart context", () => {
  it("merges the same variant+size into one line and sums quantity", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({ variantId: "v1", name: "Soaker", price: 22 });
      result.current.addItem({ variantId: "v1", name: "Soaker", price: 22 });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.count).toBe(2);
    expect(result.current.subtotal).toBe(44);
  });

  it("keeps different sizes of the same variant as separate lines", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        variantId: "v1",
        name: "Dress",
        price: 100,
        size: "S",
      });
      result.current.addItem({
        variantId: "v1",
        name: "Dress",
        price: 100,
        size: "M",
      });
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.count).toBe(2);
  });

  it("removes a line when its quantity drops to zero", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({ variantId: "v1", name: "Soaker", price: 22 });
      result.current.updateQuantity("v1", undefined, 0);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("persists the cart to localStorage across provider remounts", () => {
    const first = renderHook(() => useCart(), { wrapper });
    act(() => {
      first.result.current.addItem({
        variantId: "v2",
        name: "Cloth",
        price: 8,
      });
    });
    first.unmount();

    // A fresh provider hydrates from localStorage.
    const second = renderHook(() => useCart(), { wrapper });
    expect(second.result.current.count).toBe(1);
    expect(second.result.current.items[0].variantId).toBe("v2");
  });
});

describe("Add to cart", () => {
  it("adds a one-size item and reflects it in the cart drawer", async () => {
    render(
      <CartProvider>
        <AddToCartButton variant={variant()} />
        <CartButton />
      </CartProvider>,
    );

    await userEvent.click(screen.getByTestId("add-to-cart-v1"));
    expect(screen.getByTestId("cart-count")).toHaveTextContent("1");

    await userEvent.click(screen.getByTestId("cart-button"));
    expect(screen.getByTestId("cart-subtotal")).toHaveTextContent("$22");
  });

  it("stays disabled for a sized item until a size is chosen", async () => {
    const dress = variant({
      id: "d1",
      name: "Keyhole Dress",
      price: 100,
      sizes: [{ name: "Adult S", available: true }],
    });
    render(
      <CartProvider>
        <AddToCartButton variant={dress} />
      </CartProvider>,
    );

    expect(screen.getByTestId("add-to-cart-d1")).toBeDisabled();

    await userEvent.selectOptions(
      screen.getByTestId("size-select-d1"),
      "Adult S",
    );
    expect(screen.getByTestId("add-to-cart-d1")).toBeEnabled();
  });
});

describe("Checkout", () => {
  it("submits the cart as { variantId, size?, quantity } line items", async () => {
    const dress = variant({
      id: "d1",
      name: "Keyhole Dress",
      price: 100,
      sizes: [{ name: "Adult S", available: true }],
    });
    render(
      <CartProvider>
        <AddToCartButton variant={variant()} />
        <AddToCartButton variant={dress} />
        <CartButton />
      </CartProvider>,
    );

    await userEvent.click(screen.getByTestId("add-to-cart-v1"));
    await userEvent.selectOptions(
      screen.getByTestId("size-select-d1"),
      "Adult S",
    );
    await userEvent.click(screen.getByTestId("add-to-cart-d1"));

    await userEvent.click(screen.getByTestId("cart-button"));
    await userEvent.click(screen.getByTestId("cart-checkout"));

    expect(checkoutMutate).toHaveBeenCalledWith({
      data: {
        items: [
          { variantId: "v1", quantity: 1 },
          { variantId: "d1", size: "Adult S", quantity: 1 },
        ],
      },
    });
  });
});
