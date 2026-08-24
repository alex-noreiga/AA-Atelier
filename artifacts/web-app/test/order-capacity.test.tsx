import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { serviceList } from "@workspace/test-fixtures";

const { mutate, joinMutate, servicesResult, capacityResult, refusal } =
  vi.hoisted(() => ({
    mutate: vi.fn(),
    joinMutate: vi.fn(),
    servicesResult: { current: { data: undefined as unknown } },
    capacityResult: { current: { data: undefined as unknown } },
    // When set, the create-order mutation calls `onError` with it.
    refusal: { current: undefined as unknown },
  }));

vi.mock("@workspace/api-client-react", () => ({
  // `mutate` fires the mutation's `onError` when a test has armed a refusal, so
  // the 409 recovery path can be driven without a network.
  useCreateOrder: (opts?: {
    mutation?: { onError?: (error: unknown) => void };
  }) => ({
    isPending: false,
    mutate: (variables: unknown) => {
      mutate(variables);
      if (refusal.current) opts?.mutation?.onError?.(refusal.current);
    },
  }),
  useSubscribeNewsletter: () => ({ mutate: vi.fn(), isPending: false }),
  useGetColors: () => ({ data: undefined }),
  useGetServices: () => servicesResult.current,
  useGetCapacity: () => capacityResult.current,
  useJoinWaitlist: () => ({
    mutate: joinMutate,
    isPending: false,
    isSuccess: false,
  }),
}));

import OrderForm from "@/pages/order-form";

const CLOSED = {
  open: false,
  waitlistOpen: true,
  message: "Full for the 2026-27 season.",
  events: [],
};

beforeEach(() => {
  servicesResult.current = { data: serviceList() };
  capacityResult.current = { data: undefined };
  refusal.current = undefined;
});

/** Fill step 0 and walk to the final step, where the order is placed. */
async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("service-option-bespoke"));
  const byId = (id: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`no element with id ${id}`);
    return el;
  };
  await user.type(byId("fullName"), "Ada Skater");
  await user.type(byId("email"), "ada@example.com");
  await user.type(byId("phone"), "555-0100");
  await user.click(screen.getByRole("button", { name: "Email" }));
  await user.type(byId("waist"), "26");
  await user.type(byId("bust"), "34");
  await user.type(byId("hips"), "36");
  await user.type(byId("height"), "64");
  await user.type(byId("bodyGirth"), "58");
  await user.click(
    screen.getByRole("button", { name: /continue to your piece/i }),
  );
  await screen.findByRole("button", { name: /continue to timeline/i });
  await user.click(
    screen.getByRole("button", { name: /continue to timeline/i }),
  );
  const submit = await screen.findByRole("button", { name: /submit order/i });
  await user.click(submit);
}

describe("OrderForm — seasonal capacity", () => {
  it("shows the intake form while the capacity answer is still unknown", async () => {
    // Degrading toward the form is the safe direction: the server still refuses
    // the submit, so the cost of being wrong here is a 409, not a lost order.
    render(<OrderForm />);

    expect(screen.getByTestId("service-picker")).toBeTruthy();
    expect(screen.queryByTestId("waitlist-form")).toBeNull();
  });

  it("shows the intake form when the books are open", () => {
    capacityResult.current = { data: { ...CLOSED, open: true, message: "" } };
    render(<OrderForm />);

    expect(screen.queryByTestId("waitlist-form")).toBeNull();
  });

  it("keeps the picker on show before a service is chosen, even with the books closed", () => {
    // The closed sign is an answer about a service, and none has been picked —
    // announcing it first would turn away someone who came for a repair.
    capacityResult.current = { data: CLOSED };
    render(<OrderForm />);

    expect(screen.getByTestId("service-picker")).toBeTruthy();
    expect(screen.queryByTestId("waitlist-form")).toBeNull();
  });

  it("offers the waitlist once a commission is picked and the books are closed", async () => {
    const user = userEvent.setup();
    capacityResult.current = { data: CLOSED };
    render(<OrderForm />);

    await user.click(screen.getByTestId("service-option-bespoke"));

    expect(screen.getByTestId("waitlist-form")).toBeTruthy();
    // The atelier's own wording, not a generic notice.
    expect(screen.getByText("Full for the 2026-27 season.")).toBeTruthy();
  });

  it("still takes a repair while the commission book is closed", async () => {
    const user = userEvent.setup();
    capacityResult.current = { data: CLOSED };
    render(<OrderForm />);

    await user.click(screen.getByTestId("service-option-repairs"));

    expect(screen.queryByTestId("waitlist-form")).toBeNull();
    expect(screen.getByTestId("service-picker")).toBeTruthy();
  });

  it("leaves the picker reachable from the waitlist, so switching to a repair is one click", async () => {
    const user = userEvent.setup();
    capacityResult.current = { data: CLOSED };
    render(<OrderForm />);

    await user.click(screen.getByTestId("service-option-bespoke"));
    expect(screen.getByTestId("waitlist-form")).toBeTruthy();

    await user.click(screen.getByTestId("service-option-repairs"));
    expect(screen.queryByTestId("waitlist-form")).toBeNull();
  });

  it("asks for a date when no competitions are dated, and a picker when they are", async () => {
    const user = userEvent.setup();
    capacityResult.current = { data: CLOSED };
    const { unmount } = render(<OrderForm />);
    await user.click(screen.getByTestId("service-option-bespoke"));
    // The state the Competitions database is in today: nothing dated ahead.
    expect(screen.getByTestId("input-waitlist-needed-by")).toBeTruthy();
    expect(screen.queryByTestId("select-waitlist-event")).toBeNull();
    unmount();

    capacityResult.current = {
      data: {
        ...CLOSED,
        events: [{ id: "c1", name: "Rocket City Classic", date: "2027-01-16" }],
      },
    };
    render(<OrderForm />);
    await user.click(screen.getByTestId("service-option-bespoke"));
    expect(screen.getByTestId("select-waitlist-event")).toBeTruthy();
    expect(screen.queryByTestId("input-waitlist-needed-by")).toBeNull();
    expect(
      screen.getByRole("option", {
        name: /Rocket City Classic — Jan 16, 2027/,
      }),
    ).toBeTruthy();
  });

  it("moves a customer to the waitlist when the server refuses with 409", async () => {
    // Capacity was reached while they were filling the form in, or the tab was
    // stale. A toast saying "we're full" with the form still in front of them
    // would be a dead end; the waitlist is the recovery.
    const user = userEvent.setup();
    capacityResult.current = { data: { ...CLOSED, open: true, message: "" } };
    refusal.current = { status: 409, data: { error: "Books are closed." } };
    render(<OrderForm />);

    await fillAndSubmit(user);

    expect(mutate).toHaveBeenCalledOnce();
    expect(await screen.findByTestId("waitlist-form")).toBeTruthy();
  });

  it("sends the picked event id, letting the server resolve its name", async () => {
    const user = userEvent.setup();
    capacityResult.current = {
      data: {
        ...CLOSED,
        events: [{ id: "c1", name: "Rocket City Classic", date: "2027-01-16" }],
      },
    };
    render(<OrderForm />);
    await user.click(screen.getByTestId("service-option-bespoke"));

    await user.type(screen.getByTestId("input-waitlist-name"), "Ada Skater");
    await user.type(
      screen.getByTestId("input-waitlist-email"),
      "ada@example.com",
    );
    await user.selectOptions(screen.getByTestId("select-waitlist-event"), "c1");
    await user.click(screen.getByTestId("button-join-waitlist"));

    expect(joinMutate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Ada Skater",
        email: "ada@example.com",
        eventId: "c1",
      }),
    });
    // No order was placed — the waitlist never creates one.
    expect(mutate).not.toHaveBeenCalled();
  });
});
