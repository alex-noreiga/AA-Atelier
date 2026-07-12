import { describe, it, expect, vi } from "vitest";
import { z, ZodError } from "zod";
import type { Request, Response } from "express";
import { errorHandler } from "../../src/middlewares/error.js";
import { NotFoundError } from "../../src/lib/errors.js";

// Minimal Express `res` double that records the status/json it was given.
function makeRes(headersSent = false) {
  const res = {
    headersSent,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    body: unknown;
  };
}

const req = {} as Request;

describe("errorHandler", () => {
  it("maps a ZodError to a 400 error envelope", () => {
    const res = makeRes();
    const next = vi.fn();
    let zodErr: ZodError;
    try {
      z.object({ n: z.number() }).parse({ n: "nope" });
      throw new Error("expected parse to throw");
    } catch (e) {
      zodErr = e as ZodError;
    }

    errorHandler(zodErr, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(next).not.toHaveBeenCalled();
  });

  it("maps a NotFoundError to a 404 with its message", () => {
    const res = makeRes();
    errorHandler(new NotFoundError("no such order"), req, res, vi.fn());
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ message: "no such order" });
  });

  it("maps an unknown error to a 500 with a generic message (no leak)", () => {
    const res = makeRes();
    errorHandler(new Error("secret db string"), req, res, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: "Something went wrong. Please try again later.",
    });
    expect(JSON.stringify(res.body)).not.toContain("secret db string");
  });

  it("delegates to next when headers were already sent", () => {
    const res = makeRes(true);
    const next = vi.fn();
    const err = new Error("boom");
    errorHandler(err, req, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.statusCode).toBe(0);
  });
});
