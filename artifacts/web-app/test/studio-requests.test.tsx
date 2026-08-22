// The customer-request queue panel. The generated hooks are mocked, so what's
// tested is the panel's own job: what each kind of request offers, that the
// hand-off carries the request's OWN argument rather than anything typed, and
// that working the queue down writes the state the button says it does.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({
  queue: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListStudioRequests: () => h.queue,
  useSetStudioRequestState: () => ({
    mutate: h.mutate,
    isPending: h.isPending,
  }),
  getListStudioRequestsQueryKey: () => ["studio-requests"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { StudioRequests } from "@/components/studio-requests";

const mutate = h.mutate as unknown as Mock;

type Request = Record<string, unknown>;

function cancellation(overrides: Request = {}): Request {
  return {
    id: "req-1",
    kind: "cancellation",
    subject: "Cancellation: ORD-000002",
    email: "skater@example.com",
    message: "Cancellation requested for custom order ORD-000002.",
    orderNumber: "ORD-000002",
    state: "new",
    submittedAt: "2026-08-01T12:00:00.000Z",
    notionUrl: "https://notion.so/req-1",
    action: { tool: "cancellation-refund", orderNumber: "ORD-000002" },
    ...overrides,
  };
}

function withQueue(open: Request[], closed: Request[] = [], truncated = false) {
  h.queue = {
    data: { open, closed, truncated },
    isLoading: false,
    isError: false,
    error: null,
  };
}

beforeEach(() => {
  h.isPending = false;
  mutate.mockReset();
  withQueue([]);
});

describe("StudioRequests", () => {
  it("says when nothing is waiting, and counts what is", () => {
    render(<StudioRequests onHandoff={vi.fn()} />);
    expect(screen.getByTestId("requests-empty")).toHaveTextContent(
      /Nothing waiting/i,
    );

    withQueue([cancellation()]);
    render(<StudioRequests onHandoff={vi.fn()} />);
    expect(screen.getByTestId("requests-open-count")).toHaveTextContent(
      "1 open",
    );
  });

  // The whole point of the queue: the order number travels with the request,
  // so nothing is re-typed into a tool that moves money.
  it("hands the request's own order number to the tool that actions it", async () => {
    const onHandoff = vi.fn();
    withQueue([cancellation()]);
    render(<StudioRequests onHandoff={onHandoff} />);

    await userEvent.click(screen.getByTestId("request-action-req-1"));

    expect(onHandoff).toHaveBeenCalledWith({
      tool: "cancellation-refund",
      orderNumber: "ORD-000002",
      item: undefined,
    });
  });

  it("hands a back-in-stock request its item instead", async () => {
    const onHandoff = vi.fn();
    withQueue([
      cancellation({
        id: "req-2",
        kind: "back-in-stock",
        subject: "Back in stock: Aurora Dress",
        orderNumber: undefined,
        item: "Aurora Dress",
        size: "Youth 12",
        action: { tool: "restock-alert", item: "Aurora Dress" },
      }),
    ]);
    render(<StudioRequests onHandoff={onHandoff} />);

    expect(screen.getByTestId("request-item-req-2")).toHaveTextContent(
      "Aurora Dress · Youth 12",
    );
    await userEvent.click(screen.getByTestId("request-action-req-2"));
    expect(onHandoff).toHaveBeenCalledWith({
      tool: "restock-alert",
      orderNumber: undefined,
      item: "Aurora Dress",
    });
  });

  // A button that did nothing would be worse than no button; the panel says
  // what to do instead.
  it("offers no tool for the kinds the atelier answers by hand", () => {
    withQueue([
      cancellation({
        id: "req-3",
        kind: "measurement",
        subject: "Measurement update: ORD-000002",
        action: undefined,
      }),
    ]);
    render(<StudioRequests onHandoff={vi.fn()} />);

    expect(screen.queryByTestId("request-action-req-3")).toBeNull();
    expect(screen.getByTestId("request-guidance-req-3")).toHaveTextContent(
      /Apply the new measurements to the order in Notion/i,
    );
  });

  it("offers a reply link addressed to the customer", () => {
    withQueue([
      cancellation({
        id: "req-4",
        kind: "inquiry",
        subject: "Ada – Website inquiry",
        email: "ada@example.com",
        action: undefined,
      }),
    ]);
    render(<StudioRequests onHandoff={vi.fn()} />);

    expect(screen.getByTestId("request-email-req-4")).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:ada@example.com"),
    );
  });

  it("names an unrecognized request type rather than hiding it", () => {
    withQueue([
      cancellation({
        id: "req-5",
        kind: "other",
        rawType: "Alteration quote",
        action: undefined,
      }),
    ]);
    render(<StudioRequests onHandoff={vi.fn()} />);

    expect(screen.getByTestId("request-req-5")).toHaveTextContent(
      "Alteration quote",
    );
  });

  describe("working the queue down", () => {
    it("marks a request replied or closed", async () => {
      withQueue([cancellation()]);
      render(<StudioRequests onHandoff={vi.fn()} />);

      await userEvent.click(screen.getByTestId("request-replied-req-1"));
      expect(mutate).toHaveBeenCalledWith(
        { requestId: "req-1", data: { state: "replied" } },
        expect.anything(),
      );

      await userEvent.click(screen.getByTestId("request-close-req-1"));
      expect(mutate).toHaveBeenCalledWith(
        { requestId: "req-1", data: { state: "closed" } },
        expect.anything(),
      );
    });

    it("offers a closed request the way back, and nothing else to close", async () => {
      withQueue([], [cancellation({ id: "req-9", state: "closed" })]);
      render(<StudioRequests onHandoff={vi.fn()} />);

      expect(screen.queryByTestId("request-close-req-9")).toBeNull();
      await userEvent.click(screen.getByTestId("request-reopen-req-9"));
      expect(mutate).toHaveBeenCalledWith(
        { requestId: "req-9", data: { state: "new" } },
        expect.anything(),
      );
    });

    it("shows the server's reason when a state change fails", async () => {
      mutate.mockImplementation((_vars, opts) =>
        opts.onError({ data: { error: "That request no longer exists." } }),
      );
      withQueue([cancellation()]);
      render(<StudioRequests onHandoff={vi.fn()} />);

      await userEvent.click(screen.getByTestId("request-close-req-1"));
      expect(screen.getByTestId("request-error-req-1")).toHaveTextContent(
        "That request no longer exists.",
      );
    });
  });

  it("says when the read was cut short instead of looking complete", () => {
    withQueue([cancellation()], [], true);
    render(<StudioRequests onHandoff={vi.fn()} />);
    expect(screen.getByTestId("requests-truncated")).toBeInTheDocument();
  });

  it("reports a failed read rather than an empty queue", () => {
    h.queue = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { data: { error: "Notion is unreachable." } },
    };
    render(<StudioRequests onHandoff={vi.fn()} />);
    expect(screen.getByTestId("requests-error")).toHaveTextContent(
      "Notion is unreachable.",
    );
  });
});
