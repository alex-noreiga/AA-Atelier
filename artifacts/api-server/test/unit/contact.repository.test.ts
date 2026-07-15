import { describe, it, expect } from "vitest";
import { contactInput } from "@workspace/test-fixtures";
import { createContactMessage } from "../../src/lib/notion/contact.repository.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

// Exercises the contact-message create path against the injected NotionClient.
// The route tests mock this repository out, so this is the only place its
// Notion request shape and error handling are covered.
describe("createContactMessage", () => {
  it("throws when the contact database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(createContactMessage(contactInput(), client)).rejects.toThrow(
      /NOTION_CONTACT_DATABASE_ID is not configured/,
    );
  });

  it("POSTs a page parented to the contact database with the built properties", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "new-page" }, 200);
      throw new Error(`unexpected path ${path}`);
    });

    await createContactMessage(
      contactInput({ name: "Grace Hopper", email: "grace@example.com" }),
      client,
    );

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
    await expect(createContactMessage(contactInput(), client)).rejects.toThrow(
      /Notion contact-message creation failed with status 400: validation_error: bad property/,
    );
  });
});
