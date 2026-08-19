import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStudioAccess } from "@/lib/studio-access";

// Mutable auth state the mocked useAuth reads (set per test).
const h = vi.hoisted(() => ({
  session: null as unknown,
  loading: false,
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    session: h.session,
    user: null,
    loading: h.loading,
    configured: true,
    signOut: vi.fn(),
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetStudioAccess: vi.fn(),
  getGetStudioAccessQueryKey: () => ["/studio/access"],
}));

const { useGetStudioAccess } = await import("@workspace/api-client-react");
const mockAccess = vi.mocked(useGetStudioAccess);

/** The subset of the query result the hook reads. */
function stub(state: { data?: unknown }) {
  mockAccess.mockReturnValue({ data: state.data } as never);
}

/** The options the hook passed to the generated query hook. */
function queryOptions() {
  const options = mockAccess.mock.calls[0]?.[0]?.query;
  if (!options) throw new Error("useStudioAccess passed no query options");
  return options;
}

beforeEach(() => {
  h.session = null;
  h.loading = false;
  stub({ data: undefined });
});

describe("useStudioAccess", () => {
  it("doesn't ask while signed out — an anonymous probe can only be a 401", () => {
    renderHook(() => useStudioAccess());

    expect(queryOptions().enabled).toBe(false);
  });

  it("doesn't ask before the session has resolved", () => {
    h.loading = true;
    h.session = { access_token: "jwt" };

    renderHook(() => useStudioAccess());

    expect(queryOptions().enabled).toBe(false);
  });

  it("asks once a session exists, and never retries a refusal", () => {
    h.session = { access_token: "jwt" };

    renderHook(() => useStudioAccess());

    const options = queryOptions();
    expect(options.enabled).toBe(true);
    // A 403 is an answer, not a failure — retrying it just burns the shared
    // account rate limit.
    expect(options.retry).toBe(false);
    expect(options.staleTime).toBe(Infinity);
  });

  it("is true only when the server confirms it", () => {
    h.session = { access_token: "jwt" };
    stub({ data: { staff: true } });

    const { result } = renderHook(() => useStudioAccess());

    expect(result.current).toBe(true);
  });

  it("fails closed on a refusal, an outage, or an unanswered probe", () => {
    h.session = { access_token: "jwt" };

    for (const data of [undefined, null, {}, { staff: false }]) {
      stub({ data });
      const { result } = renderHook(() => useStudioAccess());
      expect(result.current).toBe(false);
    }
  });
});
