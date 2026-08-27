// The stage board. The generated hooks are mocked, so what's tested is the
// panel's own job: saying where an order is in ITS pipeline, making the ordinary
// move one press, and — the half Notion could never show — saying whether the
// customer heard about it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({
  board: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  move: { mutate: vi.fn(), isPending: false },
  invalidate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListStudioOrders: () => h.board,
  useSetStudioOrderStage: () => h.move,
  getListStudioOrdersQueryKey: () => ["/api/studio/orders"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));

import { StudioOrders } from "@/components/studio-orders";

const moveMutate = h.move.mutate as unknown as Mock;

const STAGES = ["Consultation", "Sketching", "Sewing", "Fitting", "Delivered"];

const ORDER = {
  orderNumber: "ORD-000002",
  orderName: "Ada – Custom Costume",
  currentStage: "Sketching",
  stages: STAGES,
  nextStage: "Sewing",
  lastNotifiedStage: "Sketching",
  service: "Custom Costume",
  dueDate: "2026-09-10",
  notifiable: true,
};

function board(orders: unknown[]) {
  h.board.data = { orders };
}

beforeEach(() => {
  h.board = { data: undefined, isLoading: false, isError: false, error: null };
  h.move.isPending = false;
  moveMutate.mockReset();
  board([]);
});

describe("StudioOrders", () => {
  it("says where an order is, measured against its own pipeline", () => {
    board([ORDER]);
    render(<StudioOrders />);

    expect(screen.getByTestId("order-ORD-000002-stage")).toHaveTextContent(
      "Sketching — stage 2 of 5",
    );
    expect(screen.getByText(/Custom Costume · Due Sep 10/)).toBeInTheDocument();
  });

  it("makes the ordinary move one press, naming the stage it moves to", async () => {
    board([ORDER]);
    render(<StudioOrders />);

    const advance = screen.getByTestId("order-ORD-000002-advance");
    expect(advance).toHaveTextContent("Advance to Sewing");

    await userEvent.click(advance);

    expect(moveMutate).toHaveBeenCalledWith(
      {
        orderNumber: "ORD-000002",
        data: { stage: "Sewing", notify: true },
      },
      expect.anything(),
    );
  });

  // Moving an order back is the other reason the atelier used to open Notion, so
  // the picker offers every stage of this order's pipeline, not just later ones.
  it("offers every other stage of the pipeline, including earlier ones", () => {
    board([ORDER]);
    render(<StudioOrders />);

    const options = Array.from(
      screen.getByTestId("order-ORD-000002-picker").querySelectorAll("option"),
    ).map((option) => option.textContent);

    expect(options).toEqual([
      "Move to…",
      "Consultation",
      "Sewing",
      "Fitting",
      "Delivered",
    ]);
  });

  it("sends the stage picked in the dropdown", async () => {
    board([ORDER]);
    render(<StudioOrders />);

    await userEvent.selectOptions(
      screen.getByTestId("order-ORD-000002-picker"),
      "Consultation",
    );
    await userEvent.click(screen.getByTestId("order-ORD-000002-set"));

    expect(moveMutate).toHaveBeenCalledWith(
      {
        orderNumber: "ORD-000002",
        data: { stage: "Consultation", notify: true },
      },
      expect.anything(),
    );
  });

  it("sends notify:false when the atelier unticks the email", async () => {
    board([ORDER]);
    render(<StudioOrders />);

    await userEvent.click(screen.getByTestId("order-ORD-000002-notify"));
    await userEvent.click(screen.getByTestId("order-ORD-000002-advance"));

    expect(moveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stage: "Sewing", notify: false } }),
      expect.anything(),
    );
  });

  it("offers nothing to advance to at the end of the pipeline", () => {
    board([{ ...ORDER, currentStage: "Delivered", nextStage: undefined }]);
    render(<StudioOrders />);

    expect(
      screen.queryByTestId("order-ORD-000002-advance"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/last stage of this order's pipeline/),
    ).toBeInTheDocument();
  });

  // The stage still moves; it is the email that can't happen, and saying so
  // before the press is better than a result that reads as a failure.
  it("says an order with no email can't be told, and disables the toggle", () => {
    board([{ ...ORDER, notifiable: false }]);
    render(<StudioOrders />);

    expect(
      screen.getByTestId("order-ORD-000002-unreachable"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("order-ORD-000002-notify")).toBeDisabled();
  });

  describe("what the result says", () => {
    function succeedWith(result: unknown) {
      moveMutate.mockImplementation(
        (_vars: unknown, handlers: { onSuccess: (data: unknown) => void }) =>
          handlers.onSuccess(result),
      );
    }

    it("confirms the move and that the customer was emailed", async () => {
      board([ORDER]);
      succeedWith({
        order: { ...ORDER, currentStage: "Sewing", nextStage: "Fitting" },
        previousStage: "Sketching",
        changed: true,
        notification: "sent",
      });
      render(<StudioOrders />);

      await userEvent.click(screen.getByTestId("order-ORD-000002-advance"));

      const result = screen.getByTestId("order-ORD-000002-result");
      expect(result).toHaveTextContent("Moved from Sketching to Sewing.");
      expect(result).toHaveTextContent("has been emailed");
      expect(h.invalidate).toHaveBeenCalled();
    });

    it("says why nothing was sent rather than implying it was", async () => {
      board([ORDER]);
      succeedWith({
        order: { ...ORDER, currentStage: "Consultation" },
        previousStage: "Sketching",
        changed: true,
        notification: "skipped",
        notificationReason: "not a forward stage change",
      });
      render(<StudioOrders />);

      await userEvent.click(screen.getByTestId("order-ORD-000002-advance"));

      expect(screen.getByTestId("order-ORD-000002-result")).toHaveTextContent(
        "not a forward stage change",
      );
    });
  });

  it("shows the server's own refusal", async () => {
    board([ORDER]);
    moveMutate.mockImplementation(
      (_vars: unknown, handlers: { onError: (err: unknown) => void }) =>
        handlers.onError({
          status: 409,
          data: { error: "That order is cancelled." },
        }),
    );
    render(<StudioOrders />);

    await userEvent.click(screen.getByTestId("order-ORD-000002-advance"));

    expect(screen.getByTestId("order-ORD-000002-error")).toHaveTextContent(
      "That order is cancelled.",
    );
  });

  it("says plainly when there is nothing in production", () => {
    render(<StudioOrders />);
    expect(screen.getByTestId("orders-empty")).toBeInTheDocument();
  });

  it("reports a failed read rather than an empty workroom", () => {
    h.board.isError = true;
    h.board.data = undefined;
    render(<StudioOrders />);

    expect(screen.getByTestId("orders-error")).toBeInTheDocument();
    expect(screen.queryByTestId("orders-empty")).not.toBeInTheDocument();
  });
});
