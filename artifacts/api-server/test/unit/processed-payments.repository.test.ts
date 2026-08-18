import { describe, it, expect } from "vitest";
import {
  claimPayment,
  confirmPayment,
  releasePayment,
} from "../../src/lib/db/processed-payments.repository.js";
import { makeFakeDb } from "../support/fake-db.js";

/** A fake db that answers the claim's insert + status-select statements. */
function dbFor(opts: { insertRows?: unknown[]; selectRows?: unknown[] }) {
  return makeFakeDb((text) => {
    if (text.includes("insert into processed_payments"))
      return opts.insertRows ?? [];
    if (text.includes("select status")) return opts.selectRows ?? [];
    return [];
  });
}

describe("claimPayment", () => {
  it("returns 'claimed' when the insert wins (no conflict)", async () => {
    const db = dbFor({ insertRows: [{ stripe_session_id: "cs_1" }] });
    expect(await claimPayment("cs_1", "shop", db)).toBe("claimed");
  });

  it("returns 'done' for an already-completed session", async () => {
    const db = dbFor({
      insertRows: [],
      selectRows: [{ status: "done", stale: false }],
    });
    expect(await claimPayment("cs_1", "shop", db)).toBe("done");
  });

  it("returns 'in_progress' for a fresh concurrent claim", async () => {
    const db = dbFor({
      insertRows: [],
      selectRows: [{ status: "processing", stale: false }],
    });
    expect(await claimPayment("cs_1", "shop", db)).toBe("in_progress");
  });

  it("reclaims a stale 'processing' row (crashed predecessor)", async () => {
    const db = dbFor({
      insertRows: [],
      selectRows: [{ status: "processing", stale: true }],
    });
    expect(await claimPayment("cs_1", "shop", db)).toBe("claimed");
    // It resets the clock on the reclaimed row.
    expect(db.calls.some((c) => /set created_at = now\(\)/.test(c.text))).toBe(
      true,
    );
  });

  it("forces a retry when the row vanished (concurrent release)", async () => {
    const db = dbFor({ insertRows: [], selectRows: [] });
    expect(await claimPayment("cs_1", "shop", db)).toBe("in_progress");
  });
});

describe("confirmPayment / releasePayment", () => {
  it("confirmPayment marks the row done", async () => {
    const db = makeFakeDb(() => []);
    await confirmPayment("cs_1", db);
    expect(db.calls[0].text).toMatch(/status = 'done'/);
    expect(db.calls[0].params).toEqual(["cs_1"]);
  });

  it("releasePayment deletes the claim", async () => {
    const db = makeFakeDb(() => []);
    await releasePayment("cs_1", db);
    expect(db.calls[0].text).toMatch(/delete from processed_payments/);
    expect(db.calls[0].params).toEqual(["cs_1"]);
  });
});
