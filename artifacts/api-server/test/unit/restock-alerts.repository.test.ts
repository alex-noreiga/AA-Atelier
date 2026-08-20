import { describe, it, expect } from "vitest";
import { claimRestockAlert } from "../../src/lib/db/restock-alerts.repository.js";
import { makeFakeDb } from "../support/fake-db.js";

const CLAIM = {
  requestPageId: "req-1",
  item: "Bow Fleece Soaker — Black",
  size: "M",
  email: "skater@example.com",
};

describe("claimRestockAlert", () => {
  it("claims a request nobody has answered yet", async () => {
    const db = makeFakeDb(() => [{ request_page_id: "req-1" }]);

    await expect(claimRestockAlert(CLAIM, db)).resolves.toBe(true);

    const call = db.calls[0];
    expect(call.text).toContain("insert into restock_alerts");
    expect(call.text).toContain("on conflict (request_page_id) do nothing");
    expect(call.params).toEqual([
      "req-1",
      "Bow Fleece Soaker — Black",
      "M",
      "skater@example.com",
    ]);
  });

  // The conflict is the whole idempotency story: the nightly sweep and a
  // dashboard press can both reach the same request, and only one may send.
  it("loses the claim when the request was already answered", async () => {
    const db = makeFakeDb(() => []);

    await expect(claimRestockAlert(CLAIM, db)).resolves.toBe(false);
  });

  it("records a whole-piece request with an empty size", async () => {
    const db = makeFakeDb(() => [{ request_page_id: "req-2" }]);

    await claimRestockAlert({ ...CLAIM, requestPageId: "req-2", size: "" }, db);

    expect(db.calls[0].params?.[2]).toBe("");
  });
});
