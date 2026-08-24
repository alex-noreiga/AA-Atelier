// The internal tools panel. The mutation hook is mocked, so what's tested is the
// panel's own job: what it sends, what it refuses to send until confirmed, and
// how it renders a result the server worded.
//
// The confirmation step on the two refund tools is the one behavior worth being
// strict about — a mis-typed order number there refunds a real customer, and the
// retired links had no such step.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));
vi.mock("@workspace/api-client-react", () => ({
  useRunStudioTool: () => ({ mutate: h.mutate, isPending: h.isPending }),
  // Each tool card carries the guides filed against it; that panel has its own
  // test file, so here it just needs an inert hook. An empty list renders
  // nothing at all, which is the behaviour these tests assume.
  useGetStudioGuides: () => ({
    data: { guides: [], sections: [], configured: true },
    isLoading: false,
    isError: false,
    error: null,
  }),
  getGetStudioGuidesQueryKey: () => ["studio-guides"],
}));

import { StudioTools } from "@/components/studio-tools";
import { toolHandoff } from "@/lib/studio-handoff";

// jsdom has no layout, so it doesn't implement scrollIntoView. The hand-off
// calls it to bring the filled card into view; stub it so the effect runs.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

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

  // The flat quote is the one tool whose amount is REQUIRED — a $0 quote is an
  // invoice nobody can pay — so the button stays disabled until it is a real
  // price, rather than letting the atelier make the round trip to find out.
  it("keeps the quote button disabled until a positive price is entered", async () => {
    render(<StudioTools />);
    const run = screen.getByTestId("tool-quote-run");

    await userEvent.type(screen.getByTestId("tool-quote-order"), "ORD-000002");
    expect(run).toBeDisabled();

    await userEvent.type(screen.getByTestId("tool-quote-amount"), "0");
    expect(run).toBeDisabled();

    await userEvent.clear(screen.getByTestId("tool-quote-amount"));
    await userEvent.type(screen.getByTestId("tool-quote-amount"), "85");
    expect(run).toBeEnabled();
  });

  it("sends a quote's price as a number and its description as typed", async () => {
    succeedWith({
      tool: "quote",
      status: "ok",
      title: "Quote sent",
      message: 'Priced "Re-stone bodice" at $85.00 on invoice ORD-000002.',
    });
    render(<StudioTools />);

    await userEvent.type(screen.getByTestId("tool-quote-order"), "ORD-000002");
    await userEvent.type(screen.getByTestId("tool-quote-amount"), "85");
    await userEvent.type(
      screen.getByTestId("tool-quote-description"),
      "Re-stone bodice",
    );
    await userEvent.click(screen.getByTestId("tool-quote-run"));

    expect(mutate).toHaveBeenCalledWith(
      {
        tool: "quote",
        data: {
          orderNumber: "ORD-000002",
          amount: 85,
          description: "Re-stone bodice",
        },
      },
      expect.anything(),
    );
    expect(screen.getByTestId("tool-quote-result")).toHaveTextContent(
      "Quote sent",
    );
  });

  // Blank ⇒ omitted, so the server names the line after the order's service
  // rather than writing an empty title onto a customer's invoice.
  it("omits a blank quote description rather than sending an empty string", async () => {
    succeedWith({
      tool: "quote",
      status: "ok",
      title: "Quote sent",
      message: "Priced the work.",
    });
    render(<StudioTools />);

    await userEvent.type(screen.getByTestId("tool-quote-order"), "ORD-000002");
    await userEvent.type(screen.getByTestId("tool-quote-amount"), "40");
    await userEvent.type(screen.getByTestId("tool-quote-description"), "   ");
    await userEvent.click(screen.getByTestId("tool-quote-run"));

    expect(mutate).toHaveBeenCalledWith(
      { tool: "quote", data: { orderNumber: "ORD-000002", amount: 40 } },
      expect.anything(),
    );
  });

  // Quoting is not a refund, so it deliberately has no confirmation step — but
  // it is also not undoable from here, which the idempotency guard covers.
  it("quotes without asking for confirmation", async () => {
    succeedWith({
      tool: "quote",
      status: "ok",
      title: "Quote sent",
      message: "Priced the work.",
    });
    render(<StudioTools />);

    await userEvent.type(screen.getByTestId("tool-quote-order"), "ORD-000002");
    await userEvent.type(screen.getByTestId("tool-quote-amount"), "40");
    await userEvent.click(screen.getByTestId("tool-quote-run"));

    expect(screen.queryByTestId("tool-quote-confirm")).toBeNull();
    expect(mutate).toHaveBeenCalledTimes(1);
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

// The restock alert is the one tool whose subject isn't an order number, so it
// exercises the card's generalized field: a different label, a different request
// key, and no confirmation step (it moves no money).
describe("StudioTools — back-in-stock alerts", () => {
  it("sends the item name under `item`, not `orderNumber`", async () => {
    succeedWith({
      tool: "restock-alert",
      status: "ok",
      title: "Back-in-stock alerts sent",
      message: "Emailed 2 customers waiting on Bow Fleece Soaker — Black.",
    });
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-restock-alert-item"),
      "  Bow Fleece Soaker — Black  ",
    );
    await userEvent.click(screen.getByTestId("tool-restock-alert-run"));

    expect(mutate).toHaveBeenCalledWith(
      {
        tool: "restock-alert",
        data: { item: "Bow Fleece Soaker — Black" },
      },
      expect.anything(),
    );
    expect(screen.getByTestId("tool-restock-alert-result")).toHaveTextContent(
      "Emailed 2 customers waiting on Bow Fleece Soaker — Black.",
    );
  });

  // Blank means "every piece currently in stock" — the only tool whose field is
  // optional, so it must NOT be disabled the way the order-scoped ones are.
  it("runs with the item blank, omitting the field entirely", async () => {
    succeedWith({
      tool: "restock-alert",
      status: "ok",
      title: "Back-in-stock alerts sent",
      message: "Emailed 4 customers across 2 pieces.",
    });
    render(<StudioTools />);

    expect(screen.getByTestId("tool-restock-alert-run")).toBeEnabled();
    await userEvent.click(screen.getByTestId("tool-restock-alert-run"));

    expect(mutate).toHaveBeenCalledWith(
      { tool: "restock-alert", data: {} },
      expect.anything(),
    );
  });

  it("labels the field for an item, not an order", () => {
    render(<StudioTools />);

    expect(screen.getByLabelText("Item name (optional)")).toBeInTheDocument();
  });

  it("runs without a confirmation step — it moves no money", async () => {
    succeedWith({
      tool: "restock-alert",
      status: "noop",
      title: "Nothing sent",
      message: "No alerts went out for Bow Fleece Soaker.",
      details: ["not in stock"],
    });
    render(<StudioTools />);

    await userEvent.type(
      screen.getByTestId("tool-restock-alert-item"),
      "Bow Fleece Soaker",
    );
    await userEvent.click(screen.getByTestId("tool-restock-alert-run"));

    expect(screen.queryByTestId("tool-restock-alert-confirm")).toBeNull();
    expect(mutate).toHaveBeenCalled();
    expect(screen.getByTestId("tool-restock-alert-result")).toHaveTextContent(
      "not in stock",
    );
  });
});

// The receiving end of the customer-request queue's hand-off. A request carries
// its own order number here so nothing is re-typed — but it only ever PREPARES
// a run: the confirmation the refunds ask for is what makes a wrong number
// impossible rather than merely unlikely, and a hand-off must not skip it.
describe("a hand-off from the request queue", () => {
  it("fills the named tool's field without running anything", () => {
    render(
      <StudioTools
        handoff={toolHandoff({
          tool: "cancellation-refund",
          orderNumber: "ORD-000002",
        })}
      />,
    );

    expect(screen.getByTestId("tool-cancellation-refund-order")).toHaveValue(
      "ORD-000002",
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("tool-cancellation-refund-confirm")).toBeNull();
  });

  it("still asks before refunding a handed-off order", async () => {
    render(
      <StudioTools
        handoff={toolHandoff({
          tool: "return-refund",
          orderNumber: "SHP-1A2B",
        })}
      />,
    );

    await userEvent.click(screen.getByTestId("tool-return-refund-run"));

    expect(screen.getByTestId("tool-return-refund-confirm")).toHaveTextContent(
      "SHP-1A2B",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("fills only the tool it names", () => {
    render(
      <StudioTools
        handoff={toolHandoff({ tool: "restock-alert", item: "Aurora Dress" })}
      />,
    );

    expect(screen.getByTestId("tool-restock-alert-item")).toHaveValue(
      "Aurora Dress",
    );
    expect(screen.getByTestId("tool-cancellation-refund-order")).toHaveValue(
      "",
    );
  });

  // A result left under a freshly filled field would read as this request
  // having been actioned, which it hasn't.
  it("clears a previous run's result when a new request arrives", async () => {
    succeedWith({
      tool: "cancellation-refund",
      status: "ok",
      title: "Cancellation processed",
      message: "Order ORD-000002: refunded 1 payment totalling $120.00.",
    });
    const { rerender } = render(
      <StudioTools
        handoff={toolHandoff({
          tool: "cancellation-refund",
          orderNumber: "ORD-000002",
        })}
      />,
    );

    await userEvent.click(screen.getByTestId("tool-cancellation-refund-run"));
    await userEvent.click(
      screen.getByTestId("tool-cancellation-refund-confirm-yes"),
    );
    expect(
      screen.getByTestId("tool-cancellation-refund-result"),
    ).toBeInTheDocument();

    rerender(
      <StudioTools
        handoff={toolHandoff({
          tool: "cancellation-refund",
          orderNumber: "ORD-000009",
        })}
      />,
    );

    expect(screen.queryByTestId("tool-cancellation-refund-result")).toBeNull();
    expect(screen.getByTestId("tool-cancellation-refund-order")).toHaveValue(
      "ORD-000009",
    );
  });
});
