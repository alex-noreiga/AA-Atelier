import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";

// CartButton instantiates the checkout mutation hook; mock the generated module
// so no QueryClient/network is needed and we can capture what it submits. The
// SizeSelector pulls in the notify dialog's mutation hook transitively, so it's
// stubbed here too.
vi.mock("@workspace/api-client-react", () => ({
  useCreateCheckoutSession: vi.fn(),
  useCreateBackInStockRequest: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

import { useCreateCheckoutSession } from "@workspace/api-client-react";
import { CartProvider, useCart } from "@/lib/cart";
import { AddToCartButton } from "@/components/add-to-cart";
import { SizeSelector } from "@/components/size-selector";
import { CartButton } from "@/components/cart-drawer";

// The size picker now lives in SizeSelector and feeds AddToCartButton a `size`
// prop — the same wiring ProductCard does. This harness mirrors that so the
// standalone add-to-cart tests can drive a real size selection.
function SizedControls({ variant }: { variant: never }) {
  const [size, setSize] = useState("");
  return (
    <>
      <SizeSelector
        variant={variant}
        selectedSize={size}
        onSelectSize={setSize}
        selectable
      />
      <AddToCartButton variant={variant} size={size} />
    </>
  );
}

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

  it("clamps a merged quantity to the variant's stock ceiling", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      // Three adds of a two-in-stock item can't exceed the ceiling.
      for (let i = 0; i < 3; i++) {
        result.current.addItem({
          variantId: "v1",
          name: "Soaker",
          price: 22,
          quantityAvailable: 2,
        });
      }
    });

    expect(result.current.count).toBe(2);
  });

  it("clamps updateQuantity to the stored stock ceiling", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({
        variantId: "v1",
        name: "Soaker",
        price: 22,
        quantityAvailable: 3,
      });
      result.current.updateQuantity("v1", undefined, 10);
    });

    expect(result.current.count).toBe(3);
  });

  it("leaves quantity uncapped when no stock ceiling is known", () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => {
      result.current.addItem({ variantId: "v1", name: "Soaker", price: 22 });
      result.current.updateQuantity("v1", undefined, 99);
    });

    expect(result.current.count).toBe(99);
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
        <SizedControls variant={dress} />
      </CartProvider>,
    );

    expect(screen.getByTestId("add-to-cart-d1")).toBeDisabled();

    await userEvent.click(screen.getByTestId("size-d1-adult-s"));
    expect(screen.getByTestId("add-to-cart-d1")).toBeEnabled();
  });
});

describe("Cart drawer interactions", () => {
  async function openDrawerWithOneItem() {
    render(
      <CartProvider>
        <AddToCartButton variant={variant()} />
        <CartButton />
      </CartProvider>,
    );
    await userEvent.click(screen.getByTestId("add-to-cart-v1"));
    await userEvent.click(screen.getByTestId("cart-button"));
  }

  // The one-size line's key is `${variantId}::` (empty size segment).
  const key = "v1::";

  it("increases a line's quantity and updates its line total and subtotal", async () => {
    await openDrawerWithOneItem();

    await userEvent.click(screen.getByTestId(`cart-increase-${key}`));

    expect(screen.getByTestId(`cart-qty-${key}`)).toHaveTextContent("2");
    expect(screen.getByTestId("cart-subtotal")).toHaveTextContent("$44");
  });

  it("decreases a line's quantity", async () => {
    await openDrawerWithOneItem();
    await userEvent.click(screen.getByTestId(`cart-increase-${key}`));

    await userEvent.click(screen.getByTestId(`cart-decrease-${key}`));

    expect(screen.getByTestId(`cart-qty-${key}`)).toHaveTextContent("1");
  });

  it("removes the line and shows the empty state when quantity drops below one", async () => {
    await openDrawerWithOneItem();

    // One decrease from qty 1 takes it to 0, which removes the line.
    await userEvent.click(screen.getByTestId(`cart-decrease-${key}`));

    expect(screen.getByTestId("cart-empty")).toBeInTheDocument();
  });

  it("removes the line when the trash button is clicked", async () => {
    await openDrawerWithOneItem();

    await userEvent.click(screen.getByTestId(`cart-remove-${key}`));

    expect(screen.getByTestId("cart-empty")).toBeInTheDocument();
  });

  it("disables the increase button once the line hits its stock ceiling", async () => {
    render(
      <CartProvider>
        <AddToCartButton variant={variant({ quantityAvailable: 1 })} />
        <CartButton />
      </CartProvider>,
    );
    await userEvent.click(screen.getByTestId("add-to-cart-v1"));
    await userEvent.click(screen.getByTestId("cart-button"));

    expect(screen.getByTestId(`cart-increase-${key}`)).toBeDisabled();
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
        <SizedControls variant={dress} />
        <CartButton />
      </CartProvider>,
    );

    await userEvent.click(screen.getByTestId("add-to-cart-v1"));
    await userEvent.click(screen.getByTestId("size-d1-adult-s"));
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
