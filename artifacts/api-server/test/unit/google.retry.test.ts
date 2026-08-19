import { describe, it, expect, vi } from "vitest";
import {
  fetchWithRetry,
  isRetryableStatus,
} from "../../src/lib/google/retry.js";

/** A sender returning the given statuses in order, recording how often it ran. */
function sender(statuses: number[]) {
  let calls = 0;
  return {
    calls: () => calls,
    send: async () => {
      const status = statuses[Math.min(calls, statuses.length - 1)]!;
      calls += 1;
      return new Response(null, { status });
    },
  };
}

// Retries sleep between attempts; zero the backoff so the suite stays fast.
const NO_DELAY = { baseDelayMs: 0 };

describe("isRetryableStatus", () => {
  it("treats rate limiting and transient 5xx as retryable", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it("treats success and client errors as final", () => {
    for (const status of [200, 400, 401, 403, 404]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

describe("fetchWithRetry", () => {
  it("returns the first successful response without retrying", async () => {
    const s = sender([200]);
    const response = await fetchWithRetry(s.send, NO_DELAY);
    expect(response.status).toBe(200);
    expect(s.calls()).toBe(1);
  });

  it("retries a 503 and returns the eventual success", async () => {
    const s = sender([503, 503, 200]);
    const response = await fetchWithRetry(s.send, NO_DELAY);
    expect(response.status).toBe(200);
    expect(s.calls()).toBe(3);
  });

  it("gives up after the attempt budget and returns the last response", async () => {
    const s = sender([503]);
    const response = await fetchWithRetry(s.send, NO_DELAY);
    expect(response.status).toBe(503);
    expect(s.calls()).toBe(3);
  });

  it("does not retry a non-retryable status", async () => {
    const s = sender([403, 200]);
    const response = await fetchWithRetry(s.send, NO_DELAY);
    expect(response.status).toBe(403);
    expect(s.calls()).toBe(1);
  });

  it("retries a thrown network error and rethrows the last one", async () => {
    const send = vi.fn().mockRejectedValue(new Error("socket hang up"));
    await expect(fetchWithRetry(send, NO_DELAY)).rejects.toThrow(
      "socket hang up",
    );
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("backs off between attempts", async () => {
    vi.useFakeTimers();
    try {
      const s = sender([503, 200]);
      const pending = fetchWithRetry(s.send, { baseDelayMs: 250 });
      await vi.advanceTimersByTimeAsync(0);
      expect(s.calls()).toBe(1); // still waiting out the backoff
      await vi.advanceTimersByTimeAsync(250);
      expect((await pending).status).toBe(200);
      expect(s.calls()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
