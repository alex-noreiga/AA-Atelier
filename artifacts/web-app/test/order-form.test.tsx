import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createOrderInput } from "@workspace/test-fixtures";

// Capture what the create-order mutation is called with, without hitting the
// network. `vi.hoisted` makes the spy available inside the hoisted vi.mock.
const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useCreateOrder: () => ({ mutate, isPending: false }),
}));

import OrderForm from "@/pages/order-form";

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
});
