import { describe, it, expect } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  crmClientPage,
  crmRewardPage,
} from "../support/fake-notion.js";
import {
  upsertClientByEmail,
  findClientByReferralCode,
  getClientRewardRowByEmail,
  patchClientProperties,
} from "../../src/lib/notion/clients.repository.js";

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

  it("lowercases a mixed-case email so dedupe and storage stay case-insensitive", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      if (path === "/v1/pages") return jsonResponse({ id: "client-new" });
      throw new Error(`unexpected ${path}`);
    });

    await upsertClientByEmail(
      { fullName: "Ada", email: "  Ada@Example.COM " },
      client,
    );

    const queryCall = client.calls.find((c) => isQuery(c.path))!;
    expect(JSON.parse(queryCall.init!.body as string).filter.email).toEqual({
      equals: "ada@example.com",
    });
    const create = client.calls.find((c) => c.path === "/v1/pages")!;
    expect(
      JSON.parse(create.init!.body as string).properties["Email"].email,
    ).toBe("ada@example.com");
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

  it("creates a new client with the given status (e.g. a contact-form Lead)", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      if (path === "/v1/pages") return jsonResponse({ id: "client-new" });
      throw new Error(`unexpected ${path}`);
    });

    await upsertClientByEmail(
      { fullName: "Ada", email: "ada@example.com", status: "Lead" },
      client,
    );

    const create = client.calls.find((c) => c.path === "/v1/pages")!;
    const body = JSON.parse(create.init!.body as string);
    expect(body.properties["Status"].status.name).toBe("Lead");
  });

  it("names a new client by its email when no name is given (back-in-stock)", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      if (path === "/v1/pages") return jsonResponse({ id: "client-new" });
      throw new Error(`unexpected ${path}`);
    });

    await upsertClientByEmail(
      { fullName: "   ", email: "ada@example.com", status: "Lead" },
      client,
    );

    const create = client.calls.find((c) => c.path === "/v1/pages")!;
    const body = JSON.parse(create.init!.body as string);
    expect(body.properties["Client Name"].title[0].text.content).toBe(
      "ada@example.com",
    );
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

describe("findClientByReferralCode", () => {
  it("returns null (no fetch) when the CRM db id is unset", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    }, "");
    expect(await findClientByReferralCode("AA-ABC123", client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("returns null (no fetch) for a blank code", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    });
    expect(await findClientByReferralCode("  ", client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("filters on the Referral Code rich_text and returns page id + email", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path))
        return jsonResponse({
          results: [
            crmRewardPage({ id: "ref-9", email: "referrer@example.com" }),
          ],
        });
      throw new Error(`unexpected ${path}`);
    });

    const found = await findClientByReferralCode("  AA-ABC123 ", client);

    expect(found).toEqual({ pageId: "ref-9", email: "referrer@example.com" });
    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.filter).toEqual({
      property: "Referral Code",
      rich_text: { equals: "AA-ABC123" },
    });
  });

  it("returns null when no client has the code", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return jsonResponse({ results: [] });
      throw new Error(`unexpected ${path}`);
    });
    expect(await findClientByReferralCode("AA-NOPE00", client)).toBeNull();
  });
});

describe("getClientRewardRowByEmail", () => {
  it("returns null (no fetch) when the CRM db id is unset", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    }, "");
    expect(
      await getClientRewardRowByEmail("ada@example.com", client),
    ).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("parses the reward properties and normalizes the lookup email", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path))
        return jsonResponse({
          results: [
            crmRewardPage({
              id: "client-3",
              email: "ada@example.com",
              referralCode: "AA-ABC123",
              referredByEmail: "referrer@example.com",
              referralRewarded: true,
              firstPaidOrder: "ORD-000001",
              returningRewardIssued: false,
              returningDiscountCode: "AA-AGAIN-XYZ",
            }),
          ],
        });
      throw new Error(`unexpected ${path}`);
    });

    const row = await getClientRewardRowByEmail("  Ada@Example.COM ", client);

    expect(row).toEqual({
      pageId: "client-3",
      email: "ada@example.com",
      referralCode: "AA-ABC123",
      referredByEmail: "referrer@example.com",
      referralRewarded: true,
      firstPaidOrder: "ORD-000001",
      returningRewardIssued: false,
      returningDiscountCode: "AA-AGAIN-XYZ",
    });
    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.filter.email).toEqual({ equals: "ada@example.com" });
  });

  it("returns empty defaults for an unpopulated row", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path))
        return jsonResponse({ results: [crmRewardPage({ id: "c1" })] });
      throw new Error(`unexpected ${path}`);
    });

    const row = await getClientRewardRowByEmail("ada@example.com", client);
    expect(row).toMatchObject({
      referralCode: "",
      referredByEmail: "",
      referralRewarded: false,
      firstPaidOrder: "",
      returningRewardIssued: false,
    });
  });
});

describe("patchClientProperties", () => {
  it("PATCHes the page with the given properties", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/client-5")
        return jsonResponse({ id: "client-5" });
      throw new Error(`unexpected ${path}`);
    });

    await patchClientProperties(
      "client-5",
      { "Referral Rewarded": { checkbox: true } },
      client,
    );

    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages/client-5");
    expect(call.init?.method).toBe("PATCH");
    expect(JSON.parse(call.init!.body as string)).toEqual({
      properties: { "Referral Rewarded": { checkbox: true } },
    });
  });

  it("no-ops (no fetch) when the CRM db id is unset", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    }, "");
    await patchClientProperties("client-5", { x: 1 }, client);
    expect(client.calls).toHaveLength(0);
  });

  it("throws with the error body when the PATCH fails", async () => {
    const client = makeFakeClient(() => errorResponse(400, "bad prop"));
    await expect(
      patchClientProperties("client-5", { x: 1 }, client),
    ).rejects.toThrow(/status 400: bad prop/);
  });
});
