import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Capture the mutation call + the onError handler the dialog wires up. Both
// generated hooks are mocked to share the same handle so we can assert either
// variant's submit payload and drive the error path — all without the network.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  handlers: {
    onError: undefined as undefined | ((e: unknown) => void),
    onSuccess: undefined as undefined | (() => void),
  },
}));
vi.mock("@workspace/api-client-react", () => {
  const hook = (opts: {
    mutation?: { onError?: (e: unknown) => void; onSuccess?: () => void };
  }) => {
    hoisted.handlers.onError = opts?.mutation?.onError;
    hoisted.handlers.onSuccess = opts?.mutation?.onSuccess;
    return { mutate: hoisted.mutate, isPending: false };
  };
  return {
    useCreateOrderCancellationRequest: hook,
    useCreateShopOrderCancellationRequest: hook,
  };
});

import { CancellationRequestDialog } from "@/components/cancellation-request-dialog";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

async function open(
  user: ReturnType<typeof userEvent.setup>,
  variant: "custom" | "shop" = "custom",
  orderNumber = "ORD-1",
) {
  render(
    <CancellationRequestDialog orderNumber={orderNumber} variant={variant} />,
  );
  await user.click(screen.getByTestId("button-request-cancellation"));
  await screen.findByTestId("cancellation-dialog");
}

afterEach(() => {
  hoisted.handlers.onError = undefined;
});

describe("CancellationRequestDialog submission", () => {
  it("sends the orderNumber and email, omitting an empty reason", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(byId("cancel-email"), "ada@example.com");
    await user.click(screen.getByTestId("cancellation-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const arg = hoisted.mutate.mock.calls[0][0];
    expect(arg.orderNumber).toBe("ORD-1");
    expect(arg.data).toEqual({ email: "ada@example.com" });
    expect(arg.data).not.toHaveProperty("reason");
  });

  it("includes the reason when provided", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(byId("cancel-email"), "ada@example.com");
    await user.type(byId("cancel-reason"), "Schedule changed");
    await user.click(screen.getByTestId("cancellation-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    expect(hoisted.mutate.mock.calls[0][0].data.reason).toBe(
      "Schedule changed",
    );
  });

  it("shows the success state after the request succeeds", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(byId("cancel-email"), "ada@example.com");
    await user.click(screen.getByTestId("cancellation-submit"));
    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));

    // Drive the hook's success callback the dialog wired up.
    act(() => hoisted.handlers.onSuccess?.());

    expect(await screen.findByTestId("cancellation-success")).toHaveTextContent(
      "Request received",
    );
  });

  it("submits the shop endpoint for the shop variant", async () => {
    const user = userEvent.setup();
    await open(user, "shop", "SHP-1");
    await user.type(byId("cancel-email"), "ada@example.com");
    await user.click(screen.getByTestId("cancellation-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    expect(hoisted.mutate.mock.calls[0][0].orderNumber).toBe("SHP-1");
  });
});

describe("CancellationRequestDialog validation & errors", () => {
  it("blocks submission and shows a message for an invalid email", async () => {
    const user = userEvent.setup();
    await open(user);
    fireEvent.change(byId("cancel-email"), { target: { value: "nope" } });
    await user.click(screen.getByTestId("cancellation-submit"));

    expect(
      await screen.findByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("surfaces a 403/409 error inline in the form", async () => {
    const user = userEvent.setup();
    await open(user);

    act(() => {
      hoisted.handlers.onError?.({
        status: 409,
        data: {
          error:
            "This order has already been delivered, so it can't be cancelled.",
        },
      });
    });

    expect(await screen.findByTestId("cancellation-error")).toHaveTextContent(
      "already been delivered",
    );
  });
});
