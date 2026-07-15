import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { orderRecord } from "@workspace/test-fixtures";
import { stubHook } from "./support/mock-hook.js";

// Control the data-fetching hook so we can drive each render state directly.
// The deposit mutation hook is mocked too — the status page's DepositSection
// calls it on every render of a found order.
// The success view also renders the measurement-change dialog, which calls the
// create mutation hook — stub it so the page renders without the network.
vi.mock("@workspace/api-client-react", () => ({
  useGetOrderStatus: vi.fn(),
  useCreateOrderDeposit: vi.fn(),
  getGetOrderStatusQueryKey: (n: string) => [n],
  useCreateMeasurementChangeRequest: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import {
  useGetOrderStatus,
  useCreateOrderDeposit,
} from "@workspace/api-client-react";
import Status from "@/pages/status";

const mockHook = vi.mocked(useGetOrderStatus);
const mockDeposit = vi.mocked(useCreateOrderDeposit);
const depositMutate = vi.fn();

beforeEach(() => {
  depositMutate.mockReset();
  mockDeposit.mockReturnValue({
    mutate: depositMutate,
    isPending: false,
  } as never);
});

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

describe("Status deposit", () => {
  it("shows nothing about a deposit until the atelier sets one", async () => {
    setHook({ data: orderRecord({ currentStage: "Consultation" }) });
    await submitLookup();
    expect(screen.queryByTestId("deposit-due")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deposit-paid")).not.toBeInTheDocument();
  });

  it("invites payment when a deposit is due, and pays it for that order", async () => {
    setHook({
      data: orderRecord({ depositAmount: 150, depositPaid: false }),
    });
    await submitLookup("ORD-1");

    const card = screen.getByTestId("deposit-due");
    expect(within(card).getByText("$150")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-pay-deposit"));
    expect(depositMutate).toHaveBeenCalledWith({ orderNumber: "ORD-1" });
  });

  it("confirms once the deposit is paid and offers no button", async () => {
    setHook({ data: orderRecord({ depositAmount: 150, depositPaid: true }) });
    await submitLookup();
    expect(screen.getByTestId("deposit-paid")).toBeInTheDocument();
    expect(screen.queryByTestId("button-pay-deposit")).not.toBeInTheDocument();
  });
});

describe("Status measurement-change lock", () => {
  it("offers the measurement-change request while measurements are unlocked", async () => {
    setHook({ data: orderRecord({ measurementsLocked: false }) });
    await submitLookup();
    expect(
      screen.getByTestId("button-request-measurement-change"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("measurements-locked")).not.toBeInTheDocument();
  });

  it("replaces the request affordance with a locked notice once in production", async () => {
    setHook({ data: orderRecord({ measurementsLocked: true }) });
    await submitLookup();
    expect(screen.getByTestId("measurements-locked")).toHaveTextContent(
      /locked now that your garment is in production/i,
    );
    expect(
      screen.queryByTestId("button-request-measurement-change"),
    ).not.toBeInTheDocument();
  });
});

describe("Status estimated completion", () => {
  it("shows nothing when the atelier hasn't set a due date", async () => {
    setHook({ data: orderRecord() });
    await submitLookup();
    expect(
      screen.queryByTestId("estimated-completion"),
    ).not.toBeInTheDocument();
  });

  it("shows the formatted estimated completion date when set", async () => {
    setHook({ data: orderRecord({ estimatedCompletion: "2026-08-01" }) });
    await submitLookup();
    expect(screen.getByTestId("estimated-completion")).toHaveTextContent(
      "August 1, 2026",
    );
  });
});

describe("Status per-stage milestone dates", () => {
  it("renders a target date under each stage that has one", async () => {
    setHook({
      data: orderRecord({
        milestones: [
          { stage: "Sewing/Construction", targetDate: "2026-08-01" },
          { stage: "Delivery", targetDate: "2026-08-10" },
        ],
      }),
    });
    await submitLookup();

    expect(
      within(screen.getByTestId("row-stage-1")).getByTestId("stage-target-1"),
    ).toHaveTextContent("August 1, 2026");
    expect(
      within(screen.getByTestId("row-stage-2")).getByTestId("stage-target-2"),
    ).toHaveTextContent("August 10, 2026");
    // A stage without a milestone shows no target line.
    expect(screen.queryByTestId("stage-target-0")).not.toBeInTheDocument();
  });

  it("shows no target lines when milestones haven't been generated", async () => {
    setHook({ data: orderRecord() });
    await submitLookup();
    expect(screen.queryByTestId("stage-target-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stage-target-1")).not.toBeInTheDocument();
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
