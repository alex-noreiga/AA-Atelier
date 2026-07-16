import { describe, it, expect } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  crmClientPage,
} from "../support/fake-notion.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";

const isQuery = (path: string) => path.endsWith("/query");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("upsertClientByEmail", () => {
  it("returns null without touching Notion when the CRM db id is unset", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    }, "");
    expect(
      await upsertClientByEmail(
        { fullName: "Ada", email: "ada@example.com" },
        client,
      ),
    ).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("returns null for a blank email without touching Notion", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    });
    expect(
      await upsertClientByEmail({ fullName: "Ada", email: "   " }, client),
    ).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("reuses an existing client (dedupe by trimmed email) and refreshes Last Contact", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return jsonResponse({ results: [crmClientPage({ id: "client-7" })] });
      }
      if (path === "/v1/pages/client-7")
        return jsonResponse({ id: "client-7" });
      throw new Error(`unexpected ${path}`);
    });

    const id = await upsertClientByEmail(
      { fullName: "Ada", email: "  ada@example.com  " },
      client,
    );

    expect(id).toBe("client-7");

    const queryCall = client.calls.find((c) => isQuery(c.path))!;
    expect(JSON.parse(queryCall.init!.body as string).filter).toEqual({
      property: "Email",
      email: { equals: "ada@example.com" },
    });

    const patch = client.calls.find((c) => c.path === "/v1/pages/client-7")!;
    expect(patch.init?.method).toBe("PATCH");
    const body = JSON.parse(patch.init!.body as string);
    expect(body.properties["Last Contact"].date.start).toMatch(ISO_DATE);
    // A matched client is never re-created.
    expect(client.calls.some((c) => c.path === "/v1/pages")).toBe(false);
  });

  it("creates a new Active client with name/email/phone when none matches", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      if (path === "/v1/pages") return jsonResponse({ id: "client-new" });
      throw new Error(`unexpected ${path}`);
    });

    const id = await upsertClientByEmail(
      { fullName: "Ada Lovelace", email: "ada@example.com", phone: "555-0100" },
      client,
    );

    expect(id).toBe("client-new");
    const create = client.calls.find((c) => c.path === "/v1/pages")!;
    expect(create.init?.method).toBe("POST");
    const body = JSON.parse(create.init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties["Client Name"].title[0].text.content).toBe(
      "Ada Lovelace",
    );
    expect(body.properties["Email"].email).toBe("ada@example.com");
    expect(body.properties["Phone"].phone_number).toBe("555-0100");
    expect(body.properties["Status"].status.name).toBe("Active");
    expect(body.properties["Last Contact"].date.start).toMatch(ISO_DATE);
  });

  it("omits Phone when no phone number is provided", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      if (path === "/v1/pages") return jsonResponse({ id: "client-new" });
      throw new Error(`unexpected ${path}`);
    });

    await upsertClientByEmail(
      { fullName: "Ada", email: "ada@example.com" },
      client,
    );

    const create = client.calls.find((c) => c.path === "/v1/pages")!;
    const body = JSON.parse(create.init!.body as string);
    expect(body.properties).not.toHaveProperty("Phone");
  });

  it("throws when the lookup query fails", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    await expect(
      upsertClientByEmail(
        { fullName: "Ada", email: "ada@example.com" },
        client,
      ),
    ).rejects.toThrow(/status 500/);
  });
});
