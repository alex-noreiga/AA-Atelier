import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { stubHook } from "./support/mock-hook.js";

// Render <Redirect> as a marker so the unauthenticated bounce is assertable.
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    Redirect: ({ to }: { to: string }) => (
      <div data-testid="redirect">{to}</div>
    ),
    useLocation: () => ["/account", vi.fn()],
  };
});

// Mutable auth state the mocked useAuth reads (set per test).
const h = vi.hoisted(() => ({
  session: null as unknown,
  loading: false,
  signOut: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: h.session,
    user: null,
    loading: h.loading,
    configured: true,
    signOut: h.signOut,
  }),
}));

// Whether this session is studio staff is the server's answer (covered in
// studio-access.test.tsx); here it's stated outright, because the portal routes
// on it — staff are handed to the dashboard rather than shown an empty account.
const staffState = vi.hoisted(() => ({
  staff: false,
  refused: false,
  loading: false,
}));
vi.mock("@/lib/studio-access", () => ({
  useStudioAccess: () => staffState,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAccountOverview: vi.fn(),
  getGetAccountOverviewQueryKey: () => ["account-overview"],
  // The appointment card mounts the shared manage panel, which calls these.
  useGetAppointmentAvailability: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
  }),
  getGetAppointmentAvailabilityQueryKey: () => ["availability"],
  useRescheduleAppointment: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelAppointment: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { useGetAccountOverview } from "@workspace/api-client-react";
import Account from "@/pages/account";

const mockOverview = vi.mocked(useGetAccountOverview);

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Account />
    </QueryClientProvider>,
  );
}

const overview = {
  email: "skater@example.com",
  customOrders: [
    {
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      currentStage: "Sewing",
      stages: ["Consultation", "Sewing", "Delivery"],
      state: "active",
      estimatedCompletion: "2026-08-01",
      measurements: {
        unit: "inches",
        waist: 28,
        bust: 36,
        hips: 38,
        height: 65,
        bodyGirth: 32,
      },
    },
  ],
  shopOrders: [
    {
      orderNumber: "SHP-ABC-1234",
      status: "Payment Confirmed",
      total: 42,
      state: "active",
    },
  ],
  appointments: [
    {
      status: "confirmed",
      confirmationCode: "APT-Z9",
      typeId: "consultation",
      typeName: "Consultation",
      staff: "Alayna",
      location: "in-person",
      locationLabel: "In person",
      start: new Date("2099-07-20T15:00:00.000Z"),
      end: new Date("2099-07-20T15:30:00.000Z"),
      timezone: "UTC",
      canModify: true,
      manageToken: "tok-abc",
    },
  ],
};

beforeEach(() => {
  // Default: a signed-in customer. Individual tests override.
  h.session = { user: { email: "skater@example.com" } };
  h.loading = false;
  h.signOut.mockReset();
  h.signOut.mockResolvedValue(undefined);
  staffState.staff = false;
  staffState.refused = false;
  staffState.loading = false;
});

describe("Account dashboard", () => {
  it("shows the loading state", () => {
    stubHook(mockOverview, { isLoading: true });
    renderPage();
    expect(screen.getByTestId("account-loading")).toBeInTheDocument();
  });

  it("redirects to sign-in when there is no session", () => {
    h.session = null;
    stubHook(mockOverview, {});
    renderPage();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/account/login");
  });

  it("redirects to sign-in on a 401 (token rejected server-side)", () => {
    stubHook(mockOverview, { isError: true, error: { status: 401 } });
    renderPage();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/account/login");
  });

  it("hands a studio staff account to the dashboard", () => {
    staffState.staff = true;
    stubHook(mockOverview, { data: overview });
    renderPage();

    expect(screen.getByTestId("redirect")).toHaveTextContent("/studio");
  });

  it("hands a staff account refused over its sign-in method there too", () => {
    // A staff address the dashboard turns away for signing in with a password
    // is not a customer: showing it an empty portal is a dead end, because the
    // reason and the Continue-with-Google button only exist on /studio.
    staffState.refused = true;
    stubHook(mockOverview, { data: overview });
    renderPage();

    expect(screen.getByTestId("redirect")).toHaveTextContent("/studio");
  });

  it("waits for the staff answer before showing a customer portal", () => {
    // Otherwise a staff member sees a flash of their (empty) account on the way
    // to the dashboard.
    staffState.loading = true;
    stubHook(mockOverview, { data: overview });
    renderPage();

    expect(screen.getByTestId("account-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("custom-order-000002")).not.toBeInTheDocument();
  });

  it("still sends a signed-out visitor to sign in, staff answer or not", () => {
    // Sign-in comes first: the probe is never made without a session, so a
    // pending staff answer must not hold the bounce.
    h.session = null;
    staffState.loading = true;
    stubHook(mockOverview, {});
    renderPage();

    expect(screen.getByTestId("redirect")).toHaveTextContent("/account/login");
  });

  it("shows an error state on a non-auth failure", () => {
    stubHook(mockOverview, { isError: true, error: { status: 500 } });
    renderPage();
    expect(screen.getByTestId("account-error")).toBeInTheDocument();
  });

  it("renders the customer's custom and shop orders", () => {
    stubHook(mockOverview, { data: overview });
    renderPage();

    expect(screen.getByText("skater@example.com")).toBeInTheDocument();
    const custom = screen.getByTestId("custom-order-000002");
    expect(custom).toHaveTextContent("Ada – Custom Dress");
    expect(custom).toHaveTextContent("Stage 2 of 3");
    const shop = screen.getByTestId("shop-order-SHP-ABC-1234");
    expect(shop).toHaveTextContent("SHP-ABC-1234");
    expect(shop).toHaveTextContent("$42");
  });

  it("renders the customer's measurements on the custom order, read-only", () => {
    stubHook(mockOverview, { data: overview });
    renderPage();

    const custom = screen.getByTestId("custom-order-000002");
    expect(custom).toHaveTextContent(/Measurements \(inches\)/);
    expect(custom).toHaveTextContent("Waist");
    expect(custom).toHaveTextContent("28");
    // "bust" is surfaced under the "Chest" label.
    expect(custom).toHaveTextContent("Chest");
  });

  it("renders upcoming appointments with inline manage actions", () => {
    stubHook(mockOverview, { data: overview });
    renderPage();

    const appt = screen.getByTestId("appointment-APT-Z9");
    expect(appt).toHaveTextContent("Consultation");
    expect(appt).toHaveTextContent("With Alayna");
    // The shared manage panel is mounted (reschedule/cancel available in place).
    expect(screen.getByTestId("button-reschedule")).toBeInTheDocument();
    expect(screen.getByTestId("button-cancel")).toBeInTheDocument();
  });

  it("shows an empty state when there are no orders", () => {
    stubHook(mockOverview, {
      data: {
        email: "new@example.com",
        customOrders: [],
        shopOrders: [],
        appointments: [],
      },
    });
    renderPage();
    expect(screen.getByTestId("account-empty")).toBeInTheDocument();
  });

  it("renders the referral card with the code when the overview carries one", () => {
    stubHook(mockOverview, {
      data: {
        ...overview,
        referral: { code: "AA-ABC123", creditAmount: 40 },
      },
    });
    renderPage();

    expect(screen.getByTestId("referral-card")).toBeInTheDocument();
    expect(screen.getByTestId("referral-code")).toHaveTextContent("AA-ABC123");
    // The concrete credit value appears in the share copy.
    expect(screen.getByTestId("referral-card")).toHaveTextContent("$40");
    // No standing returning code until earned.
    expect(screen.queryByTestId("returning-code")).not.toBeInTheDocument();
  });

  it("shows the standing returning-skater code when present", () => {
    stubHook(mockOverview, {
      data: {
        ...overview,
        referral: {
          code: "AA-ABC123",
          creditAmount: 40,
          returningCode: "AA-AGAIN-99",
        },
      },
    });
    renderPage();
    expect(screen.getByTestId("returning-code")).toHaveTextContent(
      "AA-AGAIN-99",
    );
  });

  it("omits the referral card when the overview has no referral block", () => {
    stubHook(mockOverview, { data: overview });
    renderPage();
    expect(screen.queryByTestId("referral-card")).not.toBeInTheDocument();
  });

  it("badges a completed custom order and files it under past orders", async () => {
    const user = userEvent.setup();
    stubHook(mockOverview, {
      data: {
        ...overview,
        customOrders: [
          {
            ...overview.customOrders[0],
            currentStage: "Delivery",
            state: "completed",
          },
        ],
      },
    });
    renderPage();

    // Collapsed by default (there's still an active shop order + appointment).
    expect(screen.getByTestId("past-orders")).toHaveTextContent("(1)");
    expect(screen.queryByTestId("custom-order-000002")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("button-toggle-past-orders"));

    const custom = screen.getByTestId("custom-order-000002");
    expect(screen.getByTestId("order-state-completed")).toHaveTextContent(
      "Delivered",
    );
    // The live stage name still shows alongside the badge.
    expect(custom).toHaveTextContent("Delivery");
    // A finished order shows no "stage N of N" fraction or target date.
    expect(custom).not.toHaveTextContent("Stage 3 of 3");
    expect(custom).not.toHaveTextContent("Target completion");
  });

  it("badges a cancelled order and drops its invoice link", async () => {
    const user = userEvent.setup();
    stubHook(mockOverview, {
      data: {
        ...overview,
        customOrders: [{ ...overview.customOrders[0], state: "cancelled" }],
      },
    });
    renderPage();
    await user.click(screen.getByTestId("button-toggle-past-orders"));

    const custom = screen.getByTestId("custom-order-000002");
    expect(custom).toHaveTextContent("Cancelled");
    expect(screen.queryByTestId("link-invoice-000002")).not.toBeInTheDocument();
  });

  it("badges a completed shop order under past orders", async () => {
    const user = userEvent.setup();
    stubHook(mockOverview, {
      data: {
        ...overview,
        shopOrders: [
          {
            ...overview.shopOrders[0],
            status: "Delivered",
            state: "completed",
          },
        ],
      },
    });
    renderPage();
    await user.click(screen.getByTestId("button-toggle-past-orders"));

    const shop = screen.getByTestId("shop-order-SHP-ABC-1234");
    expect(shop).toContainElement(screen.getByTestId("order-state-completed"));
    expect(screen.getByTestId("order-state-completed")).toHaveTextContent(
      "Delivered",
    );
  });

  it("opens past orders expanded when nothing is current", () => {
    stubHook(mockOverview, {
      data: {
        email: "skater@example.com",
        customOrders: [{ ...overview.customOrders[0], state: "completed" }],
        shopOrders: [],
        appointments: [],
      },
    });
    renderPage();

    // No active work to show, so the history is open rather than hidden behind
    // a toggle on an apparently empty account.
    expect(screen.getByTestId("custom-order-000002")).toBeInTheDocument();
    expect(screen.queryByTestId("account-empty")).not.toBeInTheDocument();
  });

  it("shows no past-orders section when every order is active", () => {
    stubHook(mockOverview, { data: overview });
    renderPage();
    expect(screen.queryByTestId("past-orders")).not.toBeInTheDocument();
  });

  it("signs out via the auth context", async () => {
    const user = userEvent.setup();
    stubHook(mockOverview, { data: overview });
    renderPage();

    await user.click(screen.getByTestId("button-sign-out"));
    expect(h.signOut).toHaveBeenCalled();
  });
});
