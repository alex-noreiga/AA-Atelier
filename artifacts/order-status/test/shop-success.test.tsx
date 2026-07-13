import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactElement } from "react";

vi.mock("@workspace/api-client-react", () => ({
  useGetCheckoutSession: vi.fn(),
  getGetCheckoutSessionQueryKey: (n: string) => [n],
}));

import { useGetCheckoutSession } from "@workspace/api-client-react";
import ShopSuccess from "@/pages/shop-success";
import { CartProvider } from "@/lib/cart";

const mock = vi.mocked(useGetCheckoutSession);

function setData(data: unknown) {
  mock.mockReturnValue({ data } as never);
}

function renderPage(ui: ReactElement = <ShopSuccess />) {
  const { hook } = memoryLocation({ path: "/shop/success?session_id=cs_1" });
  return render(
    <CartProvider>
      <Router hook={hook}>{ui}</Router>
    </CartProvider>,
  );
}

describe("Shop success receipt", () => {
  it("renders an itemized receipt with subtotal, shipping, tax and total", () => {
    setData({
      status: "paid",
      email: "grace@example.com",
      currency: "usd",
      lineItems: [
        { description: "Bow Fleece Soaker", quantity: 2, amount: 44 },
      ],
      amountSubtotal: 44,
      amountShipping: 8,
      amountTax: 1.08,
      amountTotal: 53.08,
    });
    renderPage();

    expect(screen.getByTestId("shop-success")).toHaveTextContent(
      "grace@example.com",
    );

    const receipt = screen.getByTestId("receipt");
    expect(within(receipt).getByTestId("receipt-item")).toHaveTextContent(
      "2 × Bow Fleece Soaker",
    );
    expect(within(receipt).getByText("Shipping")).toBeInTheDocument();
    expect(within(receipt).getByText("$8")).toBeInTheDocument();
    expect(within(receipt).getByText("Tax")).toBeInTheDocument();
    expect(within(receipt).getByText("$1.08")).toBeInTheDocument();
    expect(screen.getByTestId("receipt-total")).toHaveTextContent("$53.08");
  });

  it("hides the shipping and tax rows when they're zero", () => {
    setData({
      status: "paid",
      lineItems: [{ description: "Cloth", quantity: 1, amount: 8 }],
      amountSubtotal: 8,
      amountShipping: 0,
      amountTax: 0,
      amountTotal: 8,
    });
    renderPage();

    expect(screen.queryByText("Shipping")).not.toBeInTheDocument();
    expect(screen.queryByText("Tax")).not.toBeInTheDocument();
    expect(screen.getByTestId("receipt-total")).toHaveTextContent("$8");
  });

  it("still confirms the order when no receipt detail is available", () => {
    setData({ status: "paid" });
    renderPage();

    expect(screen.getByTestId("shop-success")).toBeInTheDocument();
    expect(screen.queryByTestId("receipt")).not.toBeInTheDocument();
  });
});
