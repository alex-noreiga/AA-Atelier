import { describe, it, expect } from "vitest";
import { reviewInput } from "@workspace/test-fixtures";
import { createReview } from "../../src/lib/notion/reviews.repository.js";
import type { ReviewRow } from "../../src/lib/notion/reviews.blocks.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    orderNumber: "000002",
    emailVerified: true,
    request: reviewInput(),
    ...overrides,
  };
}

// Reviews live in their own database. The route/service tests mock this out, so
// this is the only place its Notion request shape and error handling are covered.
describe("createReview", () => {
  it("throws when the reviews database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(createReview(row(), client)).rejects.toThrow(
      /NOTION_REVIEWS_DATABASE_ID is not configured/,
    );
  });

  it("POSTs a page parented to the reviews database with properties and body", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "new-page" }, 200);
      throw new Error(`unexpected path ${path}`);
    });

    await createReview(
      row({ request: reviewInput({ photoIds: ["up-1"] }) }),
      client,
      "client-3",
    );

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages");
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(call.init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties.Client).toEqual({ relation: [{ id: "client-3" }] });
    // The photo rides along as an image block in the page body.
    expect(body.children.some((b: any) => b.type === "image")).toBe(true);
  });

  it("throws with the status and Notion error text on a non-ok response", async () => {
    const client = makeFakeClient(() =>
      errorResponse(400, "validation_error: bad property"),
    );
    await expect(createReview(row(), client)).rejects.toThrow(
      /Notion review creation failed with status 400: validation_error: bad property/,
    );
  });
});
