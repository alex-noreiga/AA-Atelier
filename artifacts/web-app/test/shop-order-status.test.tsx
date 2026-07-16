import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubHook } from "./support/mock-hook.js";

// Control the data-fetching hook so we can drive each render state directly.
vi.mock("@workspace/api-client-react", () => ({
  useGetShopOrderStatus: vi.fn(),
  getGetShopOrderStatusQueryKey: (n: string) => [n],
}));

import { useGetShopOrderStatus } from "@workspace/api-client-react";
import ShopOrderStatus from "@/pages/shop-order-status";

const mockHook = vi.mocked(useGetShopOrderStatus);

function setHook(state: {
  data?: unknown;
  isLoading?: boolean;
  error?: unknown;
}) {
  stubHook(mockHook, state);
}

async function submitLookup(orderNumber = "SHP-1") {
  render(<ShopOrderStatus />);
  await userEvent.type(screen.getByTestId("input-order-number"), orderNumber);
  await userEvent.click(screen.getByTestId("button-lookup"));
}

describe("ShopOrderStatus render states", () => {
  it("shows the loading state after a lookup", async () => {
    setHook({ isLoading: true });
    await submitLookup();
    expect(screen.getByTestId("status-loading")).toBeInTheDocument();
  });

  it("shows the server error message when the lookup fails", async () => {
    setHook({ error: { data: { message: "No shop order like that." } } });
    await submitLookup("SHP-NOPE");
    const errorEl = screen.getByTestId("status-error");
    expect(
      within(errorEl).getByText("No shop order like that."),
    ).toBeInTheDocument();
  });

  it("renders a status timeline, marking the current status active", async () => {
    setHook({
      data: {
        orderNumber: "SHP-ABC-1234",
        status: "Processing",
        statuses: ["Payment Confirmed", "Processing", "Shipped"],
        total: 44,
      },
    });
    await submitLookup("SHP-ABC-1234");

    const success = screen.getByTestId("status-success");
    expect(within(success).getByText(/SHP-ABC-1234/)).toBeInTheDocument();
    // One row per status.
    expect(within(success).getByText("Payment Confirmed")).toBeInTheDocument();
    expect(within(success).getByText("Processing")).toBeInTheDocument();
    expect(within(success).getByText("Shipped")).toBeInTheDocument();
    // The completed (earlier) status shows a "Completed" label.
    expect(within(success).getByText(/Completed/i)).toBeInTheDocument();
  });

  it("lets the customer reset and look up another order", async () => {
    setHook({
      data: {
        orderNumber: "SHP-ABC-1234",
        status: "Shipped",
        statuses: ["Payment Confirmed", "Processing", "Shipped"],
      },
    });
    await submitLookup("SHP-ABC-1234");

    await userEvent.click(screen.getByTestId("button-check-another"));

    // Back to the lookup form.
    expect(screen.getByTestId("input-order-number")).toBeInTheDocument();
  });
});
