import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createOrderInput } from "@workspace/test-fixtures";

// Drive the confirmation screen: this mock's `mutate` fires the mutation's
// `onSuccess` synchronously with a canned order number, so submitting the form
// renders the post-submit success state (the plain mock in order-form.test.tsx
// only captures the payload and never reaches it).
vi.mock("@workspace/api-client-react", () => ({
  useCreateOrder: (opts?: {
    mutation?: { onSuccess?: (data: unknown, variables: unknown) => void };
  }) => ({
    isPending: false,
    mutate: (variables: unknown) =>
      opts?.mutation?.onSuccess?.({ orderNumber: "000042" }, variables),
  }),
}));

import OrderForm from "@/pages/order-form";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

async function fillContact(user: ReturnType<typeof userEvent.setup>) {
  const order = createOrderInput();
  await user.type(byId("fullName"), order.fullName);
  await user.type(byId("email"), order.email);
  await user.type(byId("phone"), order.phone);
  await user.click(screen.getByRole("button", { name: "Email" }));
}

async function fillMeasurements(user: ReturnType<typeof userEvent.setup>) {
  const order = createOrderInput();
  await user.type(byId("waist"), String(order.waist));
  await user.type(byId("bust"), String(order.bust));
  await user.type(byId("hips"), String(order.hips));
  await user.type(byId("height"), String(order.height));
  await user.type(byId("bodyGirth"), String(order.bodyGirth));
}

describe("OrderForm confirmation screen", () => {
  it("offers a consultation booking on every order confirmation", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillContact(user);
    await fillMeasurements(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() =>
      expect(screen.getByTestId("order-number")).toHaveTextContent("000042"),
    );

    // The consultation link is present and deep-links into the booking flow.
    expect(
      screen.getByTestId("link-book-consultation-success"),
    ).toHaveAttribute("href", "/appointments?type=consultation");
    // No measurement appointment was requested, so no fitting CTA appears.
    expect(
      screen.queryByTestId("link-book-fitting-success"),
    ).not.toBeInTheDocument();
  });

  it("offers both the fitting and the consultation when measurements are taken at an appointment", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillContact(user);
    await user.click(
      screen.getByRole("button", { name: "Take them at an appointment" }),
    );
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() =>
      expect(screen.getByTestId("order-number")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("link-book-fitting-success")).toHaveAttribute(
      "href",
      "/appointments?type=fitting",
    );
    expect(
      screen.getByTestId("link-book-consultation-success"),
    ).toHaveAttribute("href", "/appointments?type=consultation");
  });
});
