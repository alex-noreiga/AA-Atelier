import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(byId("fullName"), "Ada Lovelace");
  await user.type(byId("email"), "ada@example.com");
  await user.type(byId("phone"), "+1 555 000 1234");
  await user.click(screen.getByRole("button", { name: "Email" }));
  await user.type(byId("waist"), "28");
  await user.type(byId("bust"), "36");
  await user.type(byId("hips"), "38");
  await user.type(byId("height"), "65");
  await user.type(byId("bodyGirth"), "32");
}

beforeEach(() => {
  vi.clearAllMocks();
});

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
