// Test double for the injectable Postgres client. Repository functions take a
// `DbClient` as their last argument (the seam this suite exercises), so tests can
// drive them with a controlled `query` impl instead of a real database — the same
// pattern as fake-notion.ts. Every call is recorded so tests can assert the SQL /
// params shape.

import type { DbClient } from "../../src/lib/db/client.js";

export interface FakeDbCall {
  text: string;
  params?: unknown[];
}

export interface FakeDbClient extends DbClient {
  /** Every query made through this client, in order. */
  readonly calls: FakeDbCall[];
}

type QueryImpl = (
  text: string,
  params?: unknown[],
) => unknown[] | Promise<unknown[]>;

/**
 * Build a fake db whose `query` delegates to `impl` (which decides the rows for a
 * given SQL statement) and records every `{ text, params }`.
 */
export function makeFakeDb(impl: QueryImpl): FakeDbClient {
  const calls: FakeDbCall[] = [];
  return {
    calls,
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      calls.push({ text, params });
      return (await impl(text, params)) as T[];
    },
    async end(): Promise<void> {},
  };
}
