import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createOrderInput, colorList } from "@workspace/test-fixtures";

// Capture what the create-order mutation is called with, without hitting the
// network. `vi.hoisted` makes the spy available inside the hoisted vi.mock.
const { mutate, subscribeMutate, colorsResult } = vi.hoisted(() => ({
  mutate: vi.fn(),
  subscribeMutate: vi.fn(),
  // Mutable so a test can swap in an empty/errored colors result.
  colorsResult: { current: { data: undefined as unknown } },
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateOrder: () => ({ mutate, isPending: false }),
  useSubscribeNewsletter: () => ({ mutate: subscribeMutate, isPending: false }),
  useGetColors: () => colorsResult.current,
}));

import OrderForm from "@/pages/order-form";

// Default the colors query to a populated palette; a test can override
// `colorsResult.current` to exercise the empty/degraded path.
beforeEach(() => {
  colorsResult.current = { data: colorList() };
});

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

/**
 * Type the shared valid-order fixture into step 0 (contact + measurements). The
 * assertions below are written out by hand rather than derived from the fixture:
 * this is a round-trip test (type a value, expect it in the payload), so the
 * expectation has to be able to disagree with the input.
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

/**
 * The intake is a two-step flow: step 0 holds every required field, step 1 is
 * the optional color selector + the final "Submit Order". Advance from step 0
 * to step 1, waiting for the colors step (its Submit button) to render.
 */
async function continueToColors(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /continue to colors/i }));
  await screen.findByRole("button", { name: "Submit Order" });
}

describe("OrderForm submission mapping", () => {
  it("omits empty optional fields (description, neededBy) from the payload", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToColors(user);
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

    await continueToColors(user);
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
    // A standard-timeline date, well outside the rush window, so the rush-
    // surcharge acknowledgement gate doesn't block submit. Kept relative to
    // today (not a fixed date) so it can't drift into the window over time.
    // Date inputs don't play well with per-character typing; set directly.
    const neededBy = isoDaysFromNow(90);
    fireEvent.change(byId("neededBy"), { target: { value: neededBy } });

    await continueToColors(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.description).toBe("Ivory chiffon, A-line");
    expect(data.neededBy).toBe(neededBy);
  });

  it("omits referralCode when left blank", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToColors(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].data).not.toHaveProperty("referralCode");
  });

  it("includes a trimmed referralCode when provided", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    // The referral field is on the details step, alongside the contact fields.
    await user.type(byId("referralCode"), "  AA-ABC123  ");
    await continueToColors(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].data.referralCode).toBe("AA-ABC123");
  });
});

/** An ISO yyyy-mm-dd date `days` from now, for exercising the rush window. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

describe("OrderForm rush order", () => {
  it("shows the rush notice and blocks advancing until the surcharge is acknowledged", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    // A date well inside the rush window (5 days out). Needed-by lives on step 0.
    fireEvent.change(byId("neededBy"), {
      target: { value: isoDaysFromNow(5) },
    });

    expect(screen.getByTestId("rush-notice")).toBeInTheDocument();

    // Advancing runs validation; an unacknowledged rush blocks it on step 0.
    await user.click(
      screen.getByRole("button", { name: /continue to colors/i }),
    );

    expect(
      await screen.findByText(/acknowledge the rush surcharge/i),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    // Still on step 0 — the colors step (its Submit) never rendered.
    expect(
      screen.queryByRole("button", { name: "Submit Order" }),
    ).not.toBeInTheDocument();
  });

  it("sends rush: true once the surcharge is acknowledged", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    fireEvent.change(byId("neededBy"), {
      target: { value: isoDaysFromNow(5) },
    });
    await user.click(screen.getByTestId("rush-acknowledge"));
    await continueToColors(user);
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

    await continueToColors(user);
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
    await continueToColors(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(subscribeMutate).not.toHaveBeenCalled();
  });

  it("subscribes with the order email and 'order form' source when ticked", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToColors(user);
    // The opt-in sits on the final (colors) step, next to Submit.
    await user.click(screen.getByTestId("subscribe-newsletter"));
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(subscribeMutate).toHaveBeenCalledTimes(1);
    const { data } = subscribeMutate.mock.calls[0][0];
    expect(data).toMatchObject({
      email: "ada@example.com",
      source: "order form",
    });
    expect(typeof data.elapsedMs).toBe("number");
  });
});

describe("OrderForm validation", () => {
  it("blocks advancing and shows messages when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await user.click(
      screen.getByRole("button", { name: /continue to colors/i }),
    );

    expect(
      await screen.findByText("Full name is required"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    // Validation kept us on step 0.
    expect(
      screen.queryByRole("button", { name: "Submit Order" }),
    ).not.toBeInTheDocument();
  });

  it("rejects a needed-by date in the past", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    fireEvent.change(byId("neededBy"), { target: { value: "2020-01-01" } });

    await user.click(
      screen.getByRole("button", { name: /continue to colors/i }),
    );

    expect(
      await screen.findByText("Please choose a date in the future"),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("OrderForm deposit expectation", () => {
  it("sets the expectation that a deposit follows the quote", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToColors(user);
    // The deposit note sits by the final Submit on the colors step.
    expect(screen.getByTestId("deposit-note")).toHaveTextContent(
      /deposit to reserve your place/i,
    );
  });
});

describe("OrderForm color selector", () => {
  it("renders the palette chips on the colors step", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    // The palette lives on step 1, not the initial page.
    expect(screen.queryByTestId("color-picker")).not.toBeInTheDocument();
    await fillRequired(user);
    await continueToColors(user);
    expect(screen.getByTestId("color-picker")).toBeInTheDocument();
    expect(screen.getByTestId("color-ivory")).toBeInTheDocument();
  });

  it("sends the picked colors and the usage note", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToColors(user);
    await user.click(screen.getByTestId("color-ivory"));
    await user.click(screen.getByTestId("color-emerald"));
    await user.type(byId("colorUsage"), "Ivory bodice, emerald skirt");
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    // Colors are sent as the picked names, in selection order.
    expect(data.colors).toEqual(["Ivory", "Emerald"]);
    expect(data.colorUsage).toBe("Ivory bodice, emerald skirt");
  });

  it("omits colors and colorUsage when none are provided", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToColors(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("colors");
    expect(data).not.toHaveProperty("colorUsage");
  });

  it("deselecting a chip removes it from the sent colors", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToColors(user);
    await user.click(screen.getByTestId("color-ivory"));
    await user.click(screen.getByTestId("color-ivory")); // toggle back off
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("colors");
  });

  it("still submits when the palette is empty (degraded), usage note only", async () => {
    colorsResult.current = { data: undefined };
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToColors(user);
    // No chips render, but the customer can still describe what they want.
    expect(screen.queryByTestId("color-picker")).not.toBeInTheDocument();
    await user.type(byId("colorUsage"), "Deep teal, please");
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("colors");
    expect(data.colorUsage).toBe("Deep teal, please");
  });
});
