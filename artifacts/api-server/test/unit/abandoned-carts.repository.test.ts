import { describe, it, expect } from "vitest";
import {
  claimAbandonedCart,
  clearAbandonedCart,
  deleteExpiredAbandonedCarts,
  findDueAbandonedCarts,
  saveAbandonedCart,
} from "../../src/lib/db/abandoned-carts.repository.js";
import { makeFakeDb } from "../support/fake-db.js";

const ITEMS = [
  {
    variantId: "v1",
    name: "Bow Fleece Soaker",
    size: "S",
    quantity: 2,
    price: 24,
  },
];

describe("saveAbandonedCart", () => {
  it("upserts by email, replacing the snapshot and restarting the clock", async () => {
    const db = makeFakeDb(() => []);

    await saveAbandonedCart("skater@example.com", ITEMS, db);

    const call = db.calls[0];
    expect(call.text).toContain("insert into abandoned_carts");
    expect(call.text).toContain("on conflict (email) do update");
    expect(call.text).toContain("updated_at = now()");
    expect(call.params?.[0]).toBe("skater@example.com");
    expect(JSON.parse(call.params?.[1] as string)).toEqual(ITEMS);
  });
});

describe("findDueAbandonedCarts", () => {
  it("reads back rows with parsed items, oldest first", async () => {
    const db = makeFakeDb(() => [
      {
        email: "skater@example.com",
        // A driver (or a fake) may hand jsonb back as a string — both parse.
        items: JSON.stringify(ITEMS),
        updated_at: "2026-08-25T10:00:00.000Z",
      },
      {
        email: "dancer@example.com",
        items: ITEMS,
        updated_at: new Date("2026-08-26T10:00:00.000Z"),
      },
    ]);

    const due = await findDueAbandonedCarts(
      new Date("2026-08-26T12:00:00Z"),
      db,
    );

    expect(due).toHaveLength(2);
    expect(due[0].email).toBe("skater@example.com");
    expect(due[0].items).toEqual(ITEMS);
    expect(due[1].items).toEqual(ITEMS);
    expect(due[0].updatedAt).toBeInstanceOf(Date);
    expect(db.calls[0].text).toContain("order by updated_at asc");
  });
});

describe("claimAbandonedCart", () => {
  it("wins the claim when the row is still due", async () => {
    const db = makeFakeDb(() => [{ email: "skater@example.com" }]);

    await expect(
      claimAbandonedCart(
        "skater@example.com",
        new Date("2026-08-26T12:00:00Z"),
        db,
      ),
    ).resolves.toBe(true);

    const call = db.calls[0];
    expect(call.text).toContain("delete from abandoned_carts");
    // The cutoff re-check is what leaves a freshly re-saved cart alone (and
    // sidesteps timestamp-equality precision entirely).
    expect(call.text).toContain("updated_at <= $2");
    expect(call.text).toContain("returning email");
  });

  // The delete IS the marker: a row someone else resolved (another run, a paid
  // checkout, a re-save) no longer matches, and losing means "don't send".
  it("loses the claim when the row is gone or re-saved", async () => {
    const db = makeFakeDb(() => []);

    await expect(
      claimAbandonedCart(
        "skater@example.com",
        new Date("2026-08-26T12:00:00Z"),
        db,
      ),
    ).resolves.toBe(false);
  });
});

describe("clearAbandonedCart", () => {
  it("deletes the pending row for a completed checkout", async () => {
    const db = makeFakeDb(() => []);

    await clearAbandonedCart("skater@example.com", db);

    expect(db.calls[0].text).toContain("delete from abandoned_carts");
    expect(db.calls[0].params).toEqual(["skater@example.com"]);
  });
});

describe("deleteExpiredAbandonedCarts", () => {
  it("reports how many aged-out carts were dropped", async () => {
    const db = makeFakeDb(() => [
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]);

    await expect(
      deleteExpiredAbandonedCarts(new Date("2026-08-12T00:00:00Z"), db),
    ).resolves.toBe(2);
  });
});
