import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Capture the mutation call and the onError handler the dialog wires up, so we
// can assert the submit payload and drive the error-render path — all without
// the network. `vi.hoisted` makes these available inside the hoisted vi.mock.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  handlers: { onError: undefined as undefined | ((e: unknown) => void) },
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateReturnRequest: (opts: {
    mutation?: { onError?: (e: unknown) => void };
  }) => {
    hoisted.handlers.onError = opts?.mutation?.onError;
    return { mutate: hoisted.mutate, isPending: false };
  },
}));

import { ReturnExchangeDialog } from "@/components/return-exchange-dialog";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  render(<ReturnExchangeDialog orderNumber="SHP-ABC-1234" />);
  await user.click(screen.getByTestId("button-request-return"));
  await screen.findByTestId("return-exchange-dialog");
}

afterEach(() => {
  hoisted.handlers.onError = undefined;
});

describe("ReturnExchangeDialog submission mapping", () => {
  it("sends the orderNumber, kind, and reason, omitting empty optional fields", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(byId("re-email"), "grace@example.com");
    await user.click(screen.getByTestId("return-exchange-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const arg = hoisted.mutate.mock.calls[0][0];
    expect(arg.orderNumber).toBe("SHP-ABC-1234");
    expect(arg.data).toEqual({
      email: "grace@example.com",
      kind: "return",
      reason: "wrong_size",
    });
    expect(arg.data).not.toHaveProperty("items");
    expect(arg.data).not.toHaveProperty("note");
    expect(arg.data).not.toHaveProperty("exchangeFor");
  });

  it("includes items and note when provided", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(byId("re-email"), "grace@example.com");
    await user.type(byId("re-items"), "Bow Fleece Soaker — Black");
    await user.type(byId("re-note"), "Too small.");
    await user.click(screen.getByTestId("return-exchange-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const { data } = hoisted.mutate.mock.calls[0][0];
    expect(data.items).toBe("Bow Fleece Soaker — Black");
    expect(data.note).toBe("Too small.");
  });

  it("reveals the exchange-for field and sends it only in exchange mode", async () => {
    const user = userEvent.setup();
    await open(user);
    // Hidden for a plain return.
    expect(document.getElementById("re-exchange-for")).toBeNull();

    await user.click(screen.getByTestId("return-exchange-kind-exchange"));
    await user.type(byId("re-email"), "grace@example.com");
    await user.type(byId("re-exchange-for"), "size L");
    await user.click(screen.getByTestId("return-exchange-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const { data } = hoisted.mutate.mock.calls[0][0];
    expect(data.kind).toBe("exchange");
    expect(data.exchangeFor).toBe("size L");
  });

  it("maps a chosen reason to its enum value", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(byId("re-email"), "grace@example.com");
    await user.selectOptions(
      screen.getByTestId("return-exchange-reason"),
      "damaged",
    );
    await user.click(screen.getByTestId("return-exchange-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    expect(hoisted.mutate.mock.calls[0][0].data.reason).toBe("damaged");
  });
});

describe("ReturnExchangeDialog validation & errors", () => {
  it("blocks submission and shows a message for an invalid email", async () => {
    const user = userEvent.setup();
    await open(user);
    fireEvent.change(byId("re-email"), { target: { value: "nope" } });
    await user.click(screen.getByTestId("return-exchange-submit"));

    expect(
      await screen.findByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("surfaces a 403 error inline in the form", async () => {
    const user = userEvent.setup();
    await open(user);

    act(() => {
      hoisted.handlers.onError?.({
        status: 403,
        data: { error: "That email doesn't match the one on this order." },
      });
    });

    expect(
      await screen.findByTestId("return-exchange-error"),
    ).toHaveTextContent("That email doesn't match the one on this order.");
  });
});
