import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// The page reads the `?item=` prefill via wouter's useSearch and links home
// with <Link>; mock both so the test controls the query string and needs no
// Router. The generated mutation is mocked to capture the submit payload and
// the success handler without touching the network.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  handlers: { onSuccess: undefined as undefined | (() => void) },
  search: "",
}));
vi.mock("wouter", () => ({
  useSearch: () => hoisted.search,
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateContactMessage: (opts: {
    mutation?: { onSuccess?: () => void };
  }) => {
    hoisted.handlers.onSuccess = opts?.mutation?.onSuccess;
    return { mutate: hoisted.mutate, isPending: false };
  },
}));

import Contact from "@/pages/contact";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

beforeEach(() => {
  hoisted.search = "";
  hoisted.handlers.onSuccess = undefined;
});

describe("Contact page prefill", () => {
  it("prefills the message when arriving from the shop with ?item=", () => {
    hoisted.search = "item=Keyhole%20Dress";
    render(<Contact />);
    expect(byId("message")).toHaveValue(
      "I'd like to inquire about: Keyhole Dress.",
    );
  });

  it("leaves the message empty when there is no item param", () => {
    render(<Contact />);
    expect(byId("message")).toHaveValue("");
  });
});

describe("Contact page submission mapping", () => {
  it("omits an empty optional phone from the payload", async () => {
    const user = userEvent.setup();
    render(<Contact />);
    await user.type(byId("name"), "Grace Hopper");
    await user.type(byId("email"), "grace@example.com");
    await user.type(byId("message"), "Do you ship internationally?");
    await user.click(screen.getByRole("button", { name: "Send Message" }));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const { data } = hoisted.mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("phone");
    expect(data).toEqual({
      name: "Grace Hopper",
      email: "grace@example.com",
      message: "Do you ship internationally?",
    });
  });

  it("includes the phone when it is provided", async () => {
    const user = userEvent.setup();
    render(<Contact />);
    await user.type(byId("name"), "Grace Hopper");
    await user.type(byId("email"), "grace@example.com");
    await user.type(byId("phone"), "+1 555 000 0000");
    await user.type(byId("message"), "Question about sizing");
    await user.click(screen.getByRole("button", { name: "Send Message" }));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    expect(hoisted.mutate.mock.calls[0][0].data.phone).toBe("+1 555 000 0000");
  });
});

describe("Contact page validation & success", () => {
  it("blocks submission and shows messages when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<Contact />);
    await user.click(screen.getByRole("button", { name: "Send Message" }));

    expect(
      await screen.findByText("Your name is required"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("shows the confirmation view after a successful send", async () => {
    render(<Contact />);
    act(() => hoisted.handlers.onSuccess?.());
    expect(await screen.findByText("Message Sent")).toBeInTheDocument();
  });
});
