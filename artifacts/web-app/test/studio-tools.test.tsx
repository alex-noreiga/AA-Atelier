// The internal tools panel. The mutation hook is mocked, so what's tested is the
// panel's own job: what it sends, what it refuses to send until confirmed, and
// how it renders a result the server worded.
//
// The confirmation step on the two refund tools is the one behavior worth being
// strict about — a mis-typed order number there refunds a real customer, and the
// retired links had no such step.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
vi.mock("@workspace/api-client-react", () => ({
  useRunStudioTool: () => ({ mutate: h.mutate, isPending: h.isPending }),
}));

import { StudioTools } from "@/components/studio-tools";

const mutate = h.mutate as unknown as Mock;

/** Resolve the mutation's onSuccess with a server-shaped run result. */
function succeedWith(run: {
  tool: string;
  status: "ok" | "noop" | "attention";
  title: string;
  message: string;
  details?: string[];
}): void {
  mutate.mockImplementation((_vars, opts) =>
    opts.onSuccess({ details: [], ...run }),
  );
}

beforeEach(() => {
  h.isPending = false;
  mutate.mockReset();
});

describe("StudioTools", () => {
  it("runs a tool that takes no arguments straight away", async () => {
    succeedWith({
      tool: "milestones",
      status: "ok",
      title: "Milestones reconciled",
      message: "Generated 4 milestones across 1 order.",
    });
    render(<StudioTools />);

    await userEvent.click(screen.getByTestId("tool-milestones-run"));

    expect(mutate).toHaveBeenCalledWith(
      { tool: "milestones", data: {} },
      expect.anything(),
    );
    expect(screen.getByTestId("tool-milestones-result")).toHaveTextContent(
      "Generated 4 milestones across 1 order.",
    );
  });

  it("keeps a tool that needs an order number disabled until one is typed", async () => {
    render(<StudioTools />);

    const run = screen.getByTestId("tool-invoice-lines-run");
    expect(run).toBeDisabled();

    await userEvent.type(
      screen.getByTestId("tool-invoice-lines-order"),
      "ORD-000002",
    );

    expect(run).toBeEnabled();
  });

  it("sends the order number and the resend override", async () => {
    succeedWith({
      tool: "status-email",
      status: "ok",
      title: "Status update sent",
      message: "On its way.",
    });
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-status-email-order"),
      "ORD-000002",
    );
    await userEvent.click(screen.getByTestId("tool-status-email-force"));
    await userEvent.click(screen.getByTestId("tool-status-email-run"));

    expect(mutate).toHaveBeenCalledWith(
      {
        tool: "status-email",
        data: { orderNumber: "ORD-000002", force: true },
      },
      expect.anything(),
    );
  });

  it("omits the resend flag when it isn't ticked", async () => {
    succeedWith({
      tool: "status-email",
      status: "noop",
      title: "Nothing sent",
      message: "No update was sent.",
    });
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-status-email-order"),
      "ORD-000002",
    );
    await userEvent.click(screen.getByTestId("tool-status-email-run"));

    expect(mutate).toHaveBeenCalledWith(
      { tool: "status-email", data: { orderNumber: "ORD-000002" } },
      expect.anything(),
    );
  });

  it("asks before refunding, and sends nothing until it is confirmed", async () => {
    succeedWith({
      tool: "cancellation-refund",
      status: "ok",
      title: "Cancellation processed",
      message: "Refunded 1 payment.",
    });
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-cancellation-refund-order"),
      "ORD-000002",
    );
    await userEvent.click(screen.getByTestId("tool-cancellation-refund-run"));

    // The order number is echoed back, so a typo is visible before money moves.
    expect(
      screen.getByTestId("tool-cancellation-refund-confirm"),
    ).toHaveTextContent("ORD-000002");
    expect(mutate).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByTestId("tool-cancellation-refund-confirm-yes"),
    );

    expect(mutate).toHaveBeenCalledWith(
      { tool: "cancellation-refund", data: { orderNumber: "ORD-000002" } },
      expect.anything(),
    );
  });

  it("abandons a refund when the confirmation is declined", async () => {
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-cancellation-refund-order"),
      "ORD-000002",
    );
    await userEvent.click(screen.getByTestId("tool-cancellation-refund-run"));
    await userEvent.click(
      screen.getByTestId("tool-cancellation-refund-confirm-no"),
    );

    expect(
      screen.queryByTestId("tool-cancellation-refund-confirm"),
    ).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("re-asks when the order number is edited after confirming was opened", async () => {
    render(<StudioTools />);

    const order = screen.getByTestId("tool-cancellation-refund-order");
    await userEvent.type(order, "ORD-000002");
    await userEvent.click(screen.getByTestId("tool-cancellation-refund-run"));
    await userEvent.type(order, "9");

    expect(
      screen.queryByTestId("tool-cancellation-refund-confirm"),
    ).not.toBeInTheDocument();
  });

  it("sends a partial refund amount as a number, and omits a blank one", async () => {
    succeedWith({
      tool: "return-refund",
      status: "ok",
      title: "Refund processed",
      message: "Refunded $45.50.",
    });
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-return-refund-order"),
      "SHP-ABC123",
    );
    await userEvent.click(screen.getByTestId("tool-return-refund-run"));
    await userEvent.click(screen.getByTestId("tool-return-refund-confirm-yes"));

    expect(mutate).toHaveBeenCalledWith(
      { tool: "return-refund", data: { orderNumber: "SHP-ABC123" } },
      expect.anything(),
    );

    mutate.mockClear();
    await userEvent.type(
      screen.getByTestId("tool-return-refund-amount"),
      "45.5",
    );
    await userEvent.click(screen.getByTestId("tool-return-refund-run"));
    await userEvent.click(screen.getByTestId("tool-return-refund-confirm-yes"));

    expect(mutate).toHaveBeenCalledWith(
      {
        tool: "return-refund",
        data: { orderNumber: "SHP-ABC123", amount: 45.5 },
      },
      expect.anything(),
    );
  });

  it("shows the server's notes under a run that needs attention", async () => {
    succeedWith({
      tool: "cancellation-refund",
      status: "attention",
      title: "Refund needs attention",
      message: "Order ORD-000002 could not be fully refunded.",
      details: ["Balance: no such session in live mode"],
    });
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-cancellation-refund-order"),
      "ORD-000002",
    );
    await userEvent.click(screen.getByTestId("tool-cancellation-refund-run"));
    await userEvent.click(
      screen.getByTestId("tool-cancellation-refund-confirm-yes"),
    );

    const result = screen.getByTestId("tool-cancellation-refund-result");
    expect(result).toHaveTextContent("Refund needs attention");
    expect(result).toHaveTextContent("no such session in live mode");
  });

  it("shows the server's own message when a run is refused", async () => {
    mutate.mockImplementation((_vars, opts) =>
      opts.onError({
        data: { error: "We couldn't find an order with that number." },
      }),
    );
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-invoice-lines-order"),
      "ORD-NOPE",
    );
    await userEvent.click(screen.getByTestId("tool-invoice-lines-run"));

    expect(screen.getByTestId("tool-invoice-lines-error")).toHaveTextContent(
      "We couldn't find an order with that number.",
    );
  });

  it("falls back to a generic message when the failure carries none", async () => {
    mutate.mockImplementation((_vars, opts) =>
      opts.onError(new Error("network")),
    );
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-invoice-lines-order"),
      "ORD-000002",
    );
    await userEvent.click(screen.getByTestId("tool-invoice-lines-run"));

    expect(screen.getByTestId("tool-invoice-lines-error")).toHaveTextContent(
      "Something went wrong",
    );
  });

  it("disables the run buttons while a run is in flight", () => {
    h.isPending = true;
    render(<StudioTools />);

    expect(screen.getByTestId("tool-milestones-run")).toBeDisabled();
  });
});
