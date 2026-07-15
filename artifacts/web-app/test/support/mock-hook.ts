// The pages consume the generated react-query hooks (`useGetOrderStatus`,
// `useGetProducts`, …). Each test file mocks the hook it needs and drives the
// page through its render states by controlling what that hook returns.
//
// Faking a react-query result means producing an object with the handful of
// fields the page actually reads, and casting past the full `UseQueryResult`
// type. That cast is the only genuinely shared part — the domain shaping (what
// goes in `data`) stays in each test file, where it is readable.

import type { Mock } from "vitest";

export interface QueryState {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}

/** Make `mockFn` (a mocked react-query hook) return the given query state. */
export function stubHook(mockFn: Mock, state: QueryState): void {
  mockFn.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.error ?? null,
  } as never);
}
