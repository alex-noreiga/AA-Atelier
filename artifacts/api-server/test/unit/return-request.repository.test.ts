import { describe, it, expect } from "vitest";
import { returnRequestInput } from "@workspace/test-fixtures";
import { createReturnRequest } from "../../src/lib/notion/return-request.repository.js";
import type { ReturnRequestRow } from "../../src/lib/notion/return-request.blocks.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

function row(overrides: Partial<ReturnRequestRow> = {}): ReturnRequestRow {
  return {
    orderNumber: "SHP-ABC-1234",
    emailVerified: true,
    request: returnRequestInput(),
    ...overrides,
  };
}

// Return/exchange requests share the contact database, so this repository reuses
// the contact client. The route tests mock it out, so this is the only place its
// Notion request shape and error handling are covered.
describe("createReturnRequest", () => {
  it("throws when the contact database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(createReturnRequest(row(), client)).rejects.toThrow(
      /NOTION_CONTACT_DATABASE_ID is not configured/,
    );
  });

  it("POSTs a page parented to the contact database with the built properties", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "new-page" }, 200);
      throw new Error(`unexpected path ${path}`);
    });

    await createReturnRequest(row(), client);

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages");
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(call.init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties).toBeDefined();
  });

  it("throws with the status and Notion error text on a non-ok response", async () => {
    const client = makeFakeClient(() =>
      errorResponse(400, "validation_error: bad property"),
    );
    await expect(createReturnRequest(row(), client)).rejects.toThrow(
      /Notion return request creation failed with status 400: validation_error: bad property/,
    );
  });
});
