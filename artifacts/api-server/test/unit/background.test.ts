import { afterEach, describe, expect, it, vi } from "vitest";
import { deferBestEffort } from "../../src/lib/background.js";

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

type Holder = {
  get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined;
};

/** Install a fake platform request context, as Vercel's Node runtime does. */
function withRequestContext(holder: Holder | undefined): void {
  (globalThis as unknown as Record<symbol, Holder | undefined>)[
    REQUEST_CONTEXT
  ] = holder;
}

afterEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT];
});

describe("deferBestEffort", () => {
  describe("with no platform waitUntil (local dev, tests)", () => {
    it("awaits the task inline, preserving the pre-deferral contract", async () => {
      let settled = false;
      await deferBestEffort("emails", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        settled = true;
      });
      // The whole point of the fallback: a missing hook must never turn a slow
      // side effect into a skipped one.
      expect(settled).toBe(true);
    });

    it("swallows a throwing task rather than failing the caller", async () => {
      await expect(
        deferBestEffort("emails", async () => {
          throw new Error("Resend is down");
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("with a platform waitUntil", () => {
    it("returns before the task settles, and hands it over", async () => {
      const handed: Promise<unknown>[] = [];
      withRequestContext({
        get: () => ({ waitUntil: (p) => void handed.push(p) }),
      });

      let settled = false;
      await deferBestEffort("emails", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        settled = true;
      });

      expect(settled).toBe(false);
      expect(handed).toHaveLength(1);

      await handed[0];
      expect(settled).toBe(true);
    });

    it("hands over a promise that never rejects", async () => {
      const handed: Promise<unknown>[] = [];
      withRequestContext({
        get: () => ({ waitUntil: (p) => void handed.push(p) }),
      });

      await deferBestEffort("emails", async () => {
        throw new Error("Resend is down");
      });

      // An unhandled rejection here would land after the response has gone out.
      await expect(handed[0]).resolves.toBeUndefined();
    });

    it("runs inline when the handoff itself throws", async () => {
      withRequestContext({
        get: () => ({
          waitUntil: () => {
            throw new Error("no active request context");
          },
        }),
      });

      let settled = false;
      await deferBestEffort("emails", async () => {
        settled = true;
      });
      expect(settled).toBe(true);
    });
  });

  describe("falls back when the context is unusable", () => {
    it.each([
      ["absent", undefined],
      ["empty holder", {} as Holder],
      ["get() returns nothing", { get: () => undefined } as Holder],
      ["context has no waitUntil", { get: () => ({}) } as Holder],
      [
        "get() throws",
        {
          get: () => {
            throw new Error("boom");
          },
        } as Holder,
      ],
    ])("%s", async (_label, holder) => {
      withRequestContext(holder);
      let settled = false;
      await deferBestEffort("emails", async () => {
        settled = true;
      });
      expect(settled).toBe(true);
    });
  });

  it("starts the task exactly once", async () => {
    const task = vi.fn(async () => {});
    await deferBestEffort("emails", task);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
