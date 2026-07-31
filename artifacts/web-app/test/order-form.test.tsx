import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createOrderInput, fabricList } from "@workspace/test-fixtures";

// Capture what the create-order mutation is called with, without hitting the
// network. `vi.hoisted` makes the spy available inside the hoisted vi.mock.
const { mutate, subscribeMutate, fabricsResult } = vi.hoisted(() => ({
  mutate: vi.fn(),
  subscribeMutate: vi.fn(),
  // Mutable so a test can swap in an empty/errored fabrics result.
  fabricsResult: { current: { data: undefined as unknown } },
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateOrder: () => ({ mutate, isPending: false }),
  useSubscribeNewsletter: () => ({ mutate: subscribeMutate, isPending: false }),
  useGetFabrics: () => fabricsResult.current,
}));

import OrderForm from "@/pages/order-form";

// Default the fabrics query to a populated palette; a test can override
// `fabricsResult.current` to exercise the empty/degraded path.
beforeEach(() => {
  fabricsResult.current = { data: fabricList() };
});

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

/**
 * Type the shared valid-order fixture into the form. The assertions below are
 * written out by hand rather than derived from the fixture: this is a
 * round-trip test (type a value, expect it in the payload), so the expectation
 * has to be able to disagree with the input.
 */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  const order = createOrderInput();
  await user.type(byId("fullName"), order.fullName);
  await user.type(byId("email"), order.email);
  await user.type(byId("phone"), order.phone);
  await user.click(screen.getByRole("button", { name: "Email" }));
  await user.type(byId("waist"), String(order.waist));
  await user.type(byId("bust"), String(order.bust));
  await user.type(byId("hips"), String(order.hips));
  await user.type(byId("height"), String(order.height));
  await user.type(byId("bodyGirth"), String(order.bodyGirth));
}

describe("OrderForm submission mapping", () => {
  it("omits empty optional fields (description, neededBy) from the payload", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("description");
    expect(data).not.toHaveProperty("neededBy");
    // Required values are coerced/typed as the contract expects.
    expect(data).toMatchObject({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      preferredContact: "email",
      measurementUnit: "inches",
      waist: 28,
      bodyGirth: 32,
    });
  });

  it("omits measurements and flags an appointment when that mode is chosen", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);

    const order = createOrderInput();
    await user.type(byId("fullName"), order.fullName);
    await user.type(byId("email"), order.email);
    await user.type(byId("phone"), order.phone);
    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.click(
      screen.getByRole("button", { name: "Take them at an appointment" }),
    );
    // The measurement inputs are gone in appointment mode.
    expect(document.getElementById("waist")).toBeNull();

    // The appointment panel offers a direct link to book the fitting.
    expect(screen.getByTestId("link-book-fitting")).toHaveAttribute(
      "href",
      "/appointments?type=fitting",
    );

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.measurementAppointment).toBe(true);
    expect(data).not.toHaveProperty("waist");
    expect(data).not.toHaveProperty("bodyGirth");
    expect(data).not.toHaveProperty("measurementUnit");
    expect(data).toMatchObject({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      preferredContact: "email",
    });
  });

  it("includes description and neededBy when they are provided", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await user.type(byId("description"), "Ivory chiffon, A-line");
    // Date inputs don't play well with per-character typing; set directly.
    fireEvent.change(byId("neededBy"), { target: { value: "2026-09-01" } });

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.description).toBe("Ivory chiffon, A-line");
    expect(data.neededBy).toBe("2026-09-01");
  });
});

/** An ISO yyyy-mm-dd date `days` from now, for exercising the rush window. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

describe("OrderForm rush order", () => {
  it("shows the rush notice and blocks submission until the surcharge is acknowledged", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    // A date well inside the rush window (5 days out).
    fireEvent.change(byId("neededBy"), {
      target: { value: isoDaysFromNow(5) },
    });

    expect(screen.getByTestId("rush-notice")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    expect(
      await screen.findByText(/acknowledge the rush surcharge/i),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("sends rush: true once the surcharge is acknowledged", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    fireEvent.change(byId("neededBy"), {
      target: { value: isoDaysFromNow(5) },
    });
    await user.click(screen.getByTestId("rush-acknowledge"));
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.rush).toBe(true);
  });

  it("does not flag a standard-timeline date as a rush order", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    // Comfortably outside the rush window.
    fireEvent.change(byId("neededBy"), {
      target: { value: isoDaysFromNow(90) },
    });

    expect(screen.queryByTestId("rush-notice")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("rush");
  });
});

describe("OrderForm newsletter opt-in", () => {
  it("does not subscribe when the box is left unticked", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(subscribeMutate).not.toHaveBeenCalled();
  });

  it("subscribes with the order email and 'order form' source when ticked", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await user.click(screen.getByTestId("subscribe-newsletter"));
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(subscribeMutate).toHaveBeenCalledWith({
      data: { email: "ada@example.com", source: "order form" },
    });
  });
});

describe("OrderForm validation", () => {
  it("blocks submission and shows messages when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    expect(
      await screen.findByText("Full name is required"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("rejects a needed-by date in the past", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    fireEvent.change(byId("neededBy"), { target: { value: "2020-01-01" } });

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    expect(
      await screen.findByText("Please choose a date in the future"),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("OrderForm deposit expectation", () => {
  it("sets the expectation that a deposit follows the quote", () => {
    render(<OrderForm />);
    expect(screen.getByTestId("deposit-note")).toHaveTextContent(
      /deposit to reserve your place/i,
    );
  });
});

describe("OrderForm fabric selector", () => {
  it("renders both the bodice and skirt pickers", () => {
    render(<OrderForm />);
    expect(screen.getByTestId("fabric-picker-bodice")).toBeInTheDocument();
    expect(screen.getByTestId("fabric-picker-skirt")).toBeInTheDocument();
  });

  it("sends the chosen bodice swatch under fabricSelections", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    // "Ivory" has placement "both", so it appears in the bodice picker.
    await user.click(screen.getByTestId("fabric-bodice-ivory"));
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.fabricSelections).toEqual({
      bodice: {
        fabricId: "fab-solid",
        fabricName: "Ivory",
        fabricType: "solid",
      },
    });
    // The untouched skirt picker sends nothing.
    expect(data.fabricSelections).not.toHaveProperty("skirt");
  });

  it("omits fabricSelections entirely when no swatch is chosen", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("fabricSelections");
  });

  it("still submits when the fabrics query returns no data (degraded)", async () => {
    fabricsResult.current = { data: undefined };
    const user = userEvent.setup();
    render(<OrderForm />);
    // The escape hatch is still available even with no swatches.
    expect(
      screen.getByTestId("fabric-bodice-escape-hatch"),
    ).toBeInTheDocument();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("fabricSelections");
  });
});
