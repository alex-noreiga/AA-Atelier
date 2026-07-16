import { describe, it, expect, vi } from "vitest";
import { z, ZodError } from "zod";
import type { Request, Response } from "express";

// The 500 branch now logs AND emails an alert via reportError; mock it so the
// unit test stays offline and can assert the wiring (alert on 500, not on 4xx).
vi.mock("../../src/services/alert.service.js", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import { errorHandler } from "../../src/middlewares/error.js";
import { reportError } from "../../src/services/alert.service.js";
import {
  NotFoundError,
  ValidationError,
  BadRequestError,
  ForbiddenError,
  MeasurementsLockedError,
} from "../../src/lib/errors.js";

const mockReportError = vi.mocked(reportError);

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

  // The domain errors below each carry a customer-safe message and map to a
  // distinct status the API contract exposes; a NotFoundError is the only
  // one that uses the { message } envelope, the rest use { error }.
  it("maps a ValidationError to a 400 error envelope with its message", () => {
    const res = makeRes();
    errorHandler(
      new ValidationError("Enter all measurements or request an appointment."),
      req,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "Enter all measurements or request an appointment.",
    });
  });

  it("maps a BadRequestError to a 400 error envelope with its message", () => {
    const res = makeRes();
    errorHandler(
      new BadRequestError('"Keyhole Dress" is sold out.'),
      req,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: '"Keyhole Dress" is sold out.' });
  });

  it("maps a ForbiddenError to a 403 error envelope with its message", () => {
    const res = makeRes();
    errorHandler(
      new ForbiddenError("That email doesn't match the one on this order."),
      req,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: "That email doesn't match the one on this order.",
    });
  });

  it("maps a MeasurementsLockedError to a 409 error envelope with its message", () => {
    const res = makeRes();
    errorHandler(
      new MeasurementsLockedError(
        "This order is already in production; measurements are locked.",
      ),
      req,
      res,
      vi.fn(),
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: "This order is already in production; measurements are locked.",
    });
  });

  it("maps an unknown error to a 500 with a generic message (no leak) and alerts", async () => {
    const res = makeRes();
    const err = new Error("secret db string");
    // Awaited: the 500 branch awaits reportError before sending the response, so
    // the alert flushes on serverless.
    await errorHandler(err, req, res, vi.fn());
    expect(res.statusCode).toBe(500);
    // Deliberately spelled out rather than imported from
    // @workspace/test-fixtures' GENERIC_ERROR: this test owns the user-facing
    // copy. Asserting against the shared constant would let someone change the
    // string in both places and keep every suite green.
    expect(res.body).toEqual({
      error: "Something went wrong. Please try again later.",
    });
    expect(JSON.stringify(res.body)).not.toContain("secret db string");
    // The unhandled failure is escalated to an alert.
    expect(mockReportError).toHaveBeenCalledOnce();
    expect(mockReportError.mock.calls[0][0]).toMatchObject({ err });
    expect(mockReportError.mock.calls[0][1]).toBe("Unhandled error");
  });

  it("does not alert on a client (4xx) error", async () => {
    const res = makeRes();
    await errorHandler(new NotFoundError("no such order"), req, res, vi.fn());
    expect(res.statusCode).toBe(404);
    expect(mockReportError).not.toHaveBeenCalled();
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
