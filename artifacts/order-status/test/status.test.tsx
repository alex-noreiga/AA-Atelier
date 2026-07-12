import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { orderRecord } from "@workspace/test-fixtures";
import { stubHook } from "./support/mock-hook.js";

// Control the data-fetching hook so we can drive each render state directly.
vi.mock("@workspace/api-client-react", () => ({
  useGetOrderStatus: vi.fn(),
  getGetOrderStatusQueryKey: (n: string) => [n],
}));

import { useGetOrderStatus } from "@workspace/api-client-react";
import Status from "@/pages/status";

const mockHook = vi.mocked(useGetOrderStatus);

function setHook(state: {
  data?: unknown;
  isLoading?: boolean;
  error?: unknown;
}) {
  stubHook(mockHook, state);
}

async function submitLookup(orderNumber = "ORD-1") {
  render(<Status />);
  await userEvent.type(screen.getByTestId("input-order-number"), orderNumber);
  await userEvent.click(screen.getByTestId("button-lookup"));
}

describe("Status page render states", () => {
  it("shows the loading state after a lookup", async () => {
    setHook({ isLoading: true });
    await submitLookup();
    expect(screen.getByTestId("status-loading")).toBeInTheDocument();
    expect(screen.getByText(/Finding your order/i)).toBeInTheDocument();
  });

  it("shows the server error message when the lookup fails", async () => {
    setHook({ error: { data: { message: "No order like that." } } });
    await submitLookup("ORD-NOPE");
    const errorEl = screen.getByTestId("status-error");
    expect(errorEl).toBeInTheDocument();
    expect(
      within(errorEl).getByText("No order like that."),
    ).toBeInTheDocument();
  });

  it("falls back to a generic error message when none is provided", async () => {
    setHook({ error: {} });
    await submitLookup("ORD-NOPE");
    expect(screen.getByTestId("status-error")).toHaveTextContent(
      /couldn't find an order with that number/i,
    );
  });
});

describe("Status timeline completed/active/future computation", () => {
  it("marks stages before the current one completed and the current one active", async () => {
    setHook({ data: orderRecord({ currentStage: "Sewing/Construction" }) });
    await submitLookup();

    expect(screen.getByText("Order ORD-1")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Ada – Custom Dress" }),
    ).toBeInTheDocument();

    // Completed (index 0), active (index 1 shows its description), future (2).
    expect(screen.getByTestId("row-stage-0")).toHaveTextContent("Completed");
    expect(screen.getByTestId("row-stage-1")).toHaveTextContent(
      /sewing and constructing/i,
    );
    expect(screen.getByTestId("row-stage-2")).not.toHaveTextContent(
      "Completed",
    );
  });

  it("marks nothing completed when the current stage is the first", async () => {
    setHook({ data: orderRecord({ currentStage: "Consultation" }) });
    await submitLookup();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-stage-0")).toHaveTextContent(
      /still discussing your vision/i,
    );
  });

  it("marks every earlier stage completed when the current stage is the last", async () => {
    setHook({ data: orderRecord({ currentStage: "Delivery" }) });
    await submitLookup();
    expect(screen.getByTestId("row-stage-0")).toHaveTextContent("Completed");
    expect(screen.getByTestId("row-stage-1")).toHaveTextContent("Completed");
    expect(screen.getByTestId("row-stage-2")).toHaveTextContent(/delivered/i);
  });
});

describe("Status reset", () => {
  it("returns to the lookup form after 'Check another order'", async () => {
    setHook({
      data: orderRecord({
        currentStage: "Delivery",
        stages: ["Consultation", "Delivery"],
      }),
    });
    await submitLookup();
    expect(screen.getByTestId("status-success")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-check-another"));
    await waitFor(() =>
      expect(screen.getByTestId("input-order-number")).toBeInTheDocument(),
    );
  });
});
