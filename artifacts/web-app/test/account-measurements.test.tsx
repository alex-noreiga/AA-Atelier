import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Capture the mutation call and its handlers, so we can assert the payload and
// drive both outcomes without the network.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  handlers: { onSuccess: undefined as undefined | ((d: unknown) => void) },
}));
vi.mock("@workspace/api-client-react", () => ({
  useUpdateOrderMeasurements: (opts: {
    mutation?: { onSuccess?: (d: unknown) => void };
  }) => {
    hoisted.handlers.onSuccess = opts?.mutation?.onSuccess;
    return { mutate: hoisted.mutate, isPending: false };
  },
  getGetAccountOverviewQueryKey: () => ["account-overview"],
}));

import { AccountMeasurementsBlock } from "@/components/account-measurements";

const measurements = {
  unit: "inches" as const,
  waist: 26,
  bust: 34,
  hips: 36,
  height: 64,
  bodyGirth: 55,
};

function renderBlock(
  props: Partial<{
    locked: boolean;
    lockedInProduction: boolean;
    measurements: any;
  }> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AccountMeasurementsBlock
        orderNumber="000002"
        email="ada@example.com"
        measurements={props.measurements ?? measurements}
        locked={props.locked ?? false}
        lockedInProduction={props.lockedInProduction ?? props.locked ?? false}
      />
    </QueryClientProvider>,
  );
}

describe("AccountMeasurementsBlock", () => {
  it("shows the values read-only until the edit is asked for", () => {
    renderBlock();

    expect(screen.getByText("Waist")).toBeInTheDocument();
    expect(screen.getByText("26")).toBeInTheDocument();
    expect(screen.queryByTestId("measurements-form-000002")).toBeNull();
  });

  it("seeds the form from what is on file rather than starting blank", async () => {
    const user = userEvent.setup();
    renderBlock();
    await user.click(screen.getByTestId("measurements-edit-000002"));

    // The whole point of editing in place: correcting one measurement must not
    // mean retyping the other four, which is how the other four get retyped
    // wrong.
    expect(screen.getByTestId("acct-measurements-000002-waist")).toHaveValue(
      26,
    );
    expect(screen.getByTestId("acct-measurements-000002-bust")).toHaveValue(34);
  });

  it("sends the whole set, with the signed-in email, on save", async () => {
    const user = userEvent.setup();
    renderBlock();
    await user.click(screen.getByTestId("measurements-edit-000002"));

    const waist = screen.getByTestId("acct-measurements-000002-waist");
    await user.clear(waist);
    await user.type(waist, "27");
    await user.click(screen.getByTestId("measurements-save-000002"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const arg = hoisted.mutate.mock.calls[0][0];
    expect(arg.orderNumber).toBe("000002");
    // Every value goes, not just the changed one — a partial write would leave
    // the atelier cutting to a mix of old and new numbers.
    expect(arg.data).toEqual({
      email: "ada@example.com",
      measurementUnit: "inches",
      waist: 27,
      bust: 34,
      hips: 36,
      height: 64,
      bodyGirth: 55,
    });
  });

  it("refuses a cleared field rather than saving it as zero", async () => {
    const user = userEvent.setup();
    renderBlock();
    await user.click(screen.getByTestId("measurements-edit-000002"));

    await user.clear(screen.getByTestId("acct-measurements-000002-waist"));
    await user.click(screen.getByTestId("measurements-save-000002"));

    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("discards an abandoned edit, so reopening starts from what is stored", async () => {
    const user = userEvent.setup();
    renderBlock();
    await user.click(screen.getByTestId("measurements-edit-000002"));

    const waist = screen.getByTestId("acct-measurements-000002-waist");
    await user.clear(waist);
    await user.type(waist, "99");
    await user.click(screen.getByTestId("measurements-cancel-000002"));
    await user.click(screen.getByTestId("measurements-edit-000002"));

    expect(screen.getByTestId("acct-measurements-000002-waist")).toHaveValue(
      26,
    );
  });

  it("closes the form and confirms once the server applied the edit", async () => {
    const user = userEvent.setup();
    renderBlock();
    await user.click(screen.getByTestId("measurements-edit-000002"));

    hoisted.handlers.onSuccess?.({ outcome: "applied" });

    await waitFor(() =>
      expect(
        screen.getByTestId("measurements-saved-000002"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("measurements-form-000002")).toBeNull();
  });

  it("offers no edit once the garment is in production", () => {
    renderBlock({ locked: true, lockedInProduction: true });

    expect(screen.queryByTestId("measurements-edit-000002")).toBeNull();
    expect(
      screen.getByTestId("measurements-locked-000002"),
    ).toBeInTheDocument();
    // The values stay visible: a locked order is one the customer most wants
    // to check what it is being made to.
    expect(screen.getByText("26")).toBeInTheDocument();
  });

  it("says nothing about production for an order that is simply finished", () => {
    renderBlock({ locked: true, lockedInProduction: false });

    // A delivered or cancelled order is uneditable too, but "in production"
    // would be plainly untrue — and its card already carries a badge saying
    // why. The values stay readable.
    expect(screen.queryByTestId("measurements-edit-000002")).toBeNull();
    expect(screen.queryByTestId("measurements-locked-000002")).toBeNull();
    expect(screen.getByText("26")).toBeInTheDocument();
  });

  it("offers to add measurements to an order that has none yet", async () => {
    const user = userEvent.setup();
    renderBlock({ measurements: { unit: "inches" } });

    // A measure-at-fitting order carries none; adding them is the same write.
    const add = screen.getByTestId("measurements-edit-000002");
    expect(add).toHaveTextContent("Add");
    await user.click(add);
    expect(screen.getByTestId("acct-measurements-000002-waist")).toHaveValue(
      null,
    );
  });

  it("renders nothing for a past order with no measurements on file", () => {
    const { container } = renderBlock({
      measurements: { unit: "inches" },
      locked: true,
    });

    // Nothing to show and nothing to offer — an empty grid would say less
    // than saying nothing.
    expect(container).toBeEmptyDOMElement();
  });
});
