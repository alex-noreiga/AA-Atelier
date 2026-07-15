import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The dialog knows the item/size from the card it was opened on and asks only
// for an email. Mock the generated mutation to capture the submit payload and
// the success handler, no network involved.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  handlers: { onSuccess: undefined as undefined | (() => void) },
  isPending: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateBackInStockRequest: (opts: {
    mutation?: { onSuccess?: () => void };
  }) => {
    hoisted.handlers.onSuccess = opts?.mutation?.onSuccess;
    return { mutate: hoisted.mutate, isPending: hoisted.isPending };
  },
}));

import { NotifyDialog } from "@/components/notify-dialog";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

function renderDialog(props: { item: string; size?: string }) {
  return render(
    <NotifyDialog
      {...props}
      trigger={(open) => (
        <button type="button" onClick={open} data-testid="open-notify">
          Notify me
        </button>
      )}
    />,
  );
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("open-notify"));
  await screen.findByTestId("notify-dialog");
}

beforeEach(() => {
  hoisted.handlers.onSuccess = undefined;
  hoisted.isPending = false;
});

describe("NotifyDialog submission mapping", () => {
  it("submits the email with the known item and size", async () => {
    const user = userEvent.setup();
    renderDialog({ item: "Bow Fleece Soaker", size: "M" });
    await open(user);

    await user.type(byId("notify-email"), "grace@example.com");
    await user.click(screen.getByTestId("notify-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    expect(hoisted.mutate.mock.calls[0][0]).toEqual({
      data: {
        email: "grace@example.com",
        item: "Bow Fleece Soaker",
        size: "M",
      },
    });
  });

  it("omits size for a whole-variant (no size) request", async () => {
    const user = userEvent.setup();
    renderDialog({ item: "Bow Fleece Soaker" });
    await open(user);

    await user.type(byId("notify-email"), "grace@example.com");
    await user.click(screen.getByTestId("notify-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    expect(hoisted.mutate.mock.calls[0][0].data).not.toHaveProperty("size");
  });
});

describe("NotifyDialog validation & success", () => {
  it("blocks submission and shows a message for an invalid email", async () => {
    const user = userEvent.setup();
    renderDialog({ item: "Bow Fleece Soaker" });
    await open(user);

    await user.type(byId("notify-email"), "not-an-email");
    await user.click(screen.getByTestId("notify-submit"));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("shows the confirmation view after a successful request", async () => {
    const user = userEvent.setup();
    renderDialog({ item: "Bow Fleece Soaker" });
    await open(user);

    act(() => hoisted.handlers.onSuccess?.());

    expect(await screen.findByTestId("notify-success")).toBeInTheDocument();
  });

  it("disables the submit button while the request is pending", async () => {
    hoisted.isPending = true;
    const user = userEvent.setup();
    renderDialog({ item: "Bow Fleece Soaker" });
    await open(user);

    expect(screen.getByTestId("notify-submit")).toBeDisabled();
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("resets back to the form when reopened after a success", async () => {
    const user = userEvent.setup();
    renderDialog({ item: "Bow Fleece Soaker" });
    await open(user);
    act(() => hoisted.handlers.onSuccess?.());
    await screen.findByTestId("notify-success");

    // Closing discards the previous attempt (the reset-on-close path)...
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("notify-dialog")).not.toBeInTheDocument(),
    );

    // ...so reopening starts clean at the form with an empty email.
    await open(user);
    expect(screen.getByTestId("notify-email")).toHaveValue("");
  });
});
