import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Its own file (and so its own module registry) because it mocks
// `orders.repository` differently from `orders.routes.test.ts`: here the
// capacity count is the thing under test, so `listOpenOrderServices` is a spy
// rather than the real scan.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  createOrder: vi.fn(),
  findOrderByNumber: vi.fn(),
  listOpenOrderServices: vi.fn(),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn().mockResolvedValue(null),
}));

import request from "supertest";
import { createOrderInput } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import {
  createOrder,
  listOpenOrderServices,
} from "../../src/lib/notion/orders.repository.js";
import { __resetCapacityCache } from "../../src/services/capacity.service.js";
import { DEFAULT_CLOSED_MESSAGE } from "../../src/services/capacity.js";

const mockCreate = vi.mocked(createOrder);
const mockOpenOrders = vi.mocked(listOpenOrderServices);

const ENV_KEYS = ["COMMISSION_CAPACITY", "COMMISSION_INTAKE"];
const savedEnv = new Map<string, string | undefined>();

let ip = 0;
function postOrder(body: object) {
  ip += 1;
  return request(app)
    .post("/api/orders")
    .set("X-Forwarded-For", `198.51.100.${ip}`)
    .send(body);
}

beforeEach(() => {
  __resetCapacityCache();
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  mockCreate.mockResolvedValue({ orderNumber: "ORD-1", pageId: "page-1" });
});

afterEach(() => {
  __resetCapacityCache();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/orders — the seasonal capacity gate", () => {
  it("refuses a commission with 409 when the books are closed", async () => {
    // The form asks `GET /capacity` before it renders, so in practice this
    // fires on a stale tab or a direct POST. It exists because a rule the
    // browser is trusted to apply is not a rule.
    process.env.COMMISSION_INTAKE = "closed";

    const res = await postOrder(createOrderInput({ service: "bespoke" }));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(DEFAULT_CLOSED_MESSAGE);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("still takes a repair while the commission book is closed", async () => {
    process.env.COMMISSION_INTAKE = "closed";

    const res = await postOrder(
      createOrderInput({
        service: "repairs",
        description: "Torn seam at the left shoulder.",
      }),
    );

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledOnce();
    // A non-gated service must not even pay for the count.
    expect(mockOpenOrders).not.toHaveBeenCalled();
  });

  it("takes a commission when the books are open", async () => {
    process.env.COMMISSION_CAPACITY = "5";
    mockOpenOrders.mockResolvedValue(["Bespoke Commission"]);

    const res = await postOrder(createOrderInput({ service: "bespoke" }));

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("refuses a commission once the counted book is full", async () => {
    process.env.COMMISSION_CAPACITY = "2";
    mockOpenOrders.mockResolvedValue([
      "Bespoke Commission",
      "Bespoke Commission",
    ]);

    const res = await postOrder(createOrderInput({ service: "bespoke" }));

    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("takes an order whose service is omitted when the books are open", async () => {
    // An omitted service resolves to the bespoke commission, so it IS gated —
    // this asserts the ordinary path still works, not that the gate is skipped.
    const res = await postOrder(createOrderInput({ service: undefined }));

    expect(res.status).toBe(201);
  });

  it("refuses an order whose service is omitted when the books are closed", async () => {
    process.env.COMMISSION_INTAKE = "closed";

    const res = await postOrder(createOrderInput({ service: undefined }));

    expect(res.status).toBe(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
