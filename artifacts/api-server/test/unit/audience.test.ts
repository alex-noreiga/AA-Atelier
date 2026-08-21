import { describe, it, expect, vi } from "vitest";
import {
  audienceConfigured,
  listAudienceContacts,
  membershipIn,
  upsertAudienceContact,
  upsertAudienceContactBestEffort,
} from "../../src/lib/resend/audience.js";

// A fake `fetch` that records calls and returns a scripted sequence of Responses.
function fakeFetch(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const impl = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responses[i++] ?? new Response(null, { status: 500 });
  };
  return { impl, calls };
}

const ok = () => new Response(JSON.stringify({ id: "c1" }), { status: 200 });
const conflict = () => new Response("already exists", { status: 422 });
const config = { apiKey: "re_test", audienceId: "aud_123" };

describe("upsertAudienceContact", () => {
  it("self-gates (no fetch) when the API key is unset", async () => {
    const { impl, calls } = fakeFetch([ok()]);
    await upsertAudienceContact("grace@example.com", {
      apiKey: "",
      audienceId: "aud_123",
      fetchImpl: impl,
    });
    expect(calls).toHaveLength(0);
  });

  it("self-gates (no fetch) when the audience id is unset", async () => {
    const { impl, calls } = fakeFetch([ok()]);
    await upsertAudienceContact("grace@example.com", {
      apiKey: "re_test",
      audienceId: "",
      fetchImpl: impl,
    });
    expect(calls).toHaveLength(0);
  });

  it("self-gates (no fetch) when the email is blank", async () => {
    const { impl, calls } = fakeFetch([ok()]);
    await upsertAudienceContact("   ", { ...config, fetchImpl: impl });
    expect(calls).toHaveLength(0);
  });

  it("creates the contact (subscribed) on the happy path — one call", async () => {
    const { impl, calls } = fakeFetch([ok()]);
    await upsertAudienceContact("grace@example.com", {
      ...config,
      fetchImpl: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://api.resend.com/audiences/aud_123/contacts",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({
      email: "grace@example.com",
      unsubscribed: false,
    });
    expect(
      (calls[0].init!.headers as Record<string, string>).Authorization,
    ).toBe("Bearer re_test");
  });

  it("re-subscribes via PATCH when the contact already exists", async () => {
    const { impl, calls } = fakeFetch([conflict(), ok()]);
    await upsertAudienceContact("grace@example.com", {
      ...config,
      fetchImpl: impl,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(
      "https://api.resend.com/audiences/aud_123/contacts/grace%40example.com",
    );
    expect(calls[1].init?.method).toBe("PATCH");
    expect(JSON.parse(calls[1].init!.body as string)).toEqual({
      unsubscribed: false,
    });
  });

  it("throws when both the create and the re-subscribe fail", async () => {
    const { impl } = fakeFetch([
      conflict(),
      new Response("nope", { status: 500 }),
    ]);
    await expect(
      upsertAudienceContact("grace@example.com", {
        ...config,
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/Resend audience upsert failed/);
  });
});

describe("upsertAudienceContactBestEffort", () => {
  it("swallows a thrown error (opt-in must not fail on an audience hiccup)", async () => {
    const { impl } = fakeFetch([
      conflict(),
      new Response("nope", { status: 500 }),
    ]);
    await expect(
      upsertAudienceContactBestEffort("grace@example.com", {
        ...config,
        fetchImpl: impl,
      }),
    ).resolves.toBeUndefined();
  });

  it("is a no-op (swallowed) when unconfigured", async () => {
    const spy = vi.fn();
    await upsertAudienceContactBestEffort("grace@example.com", {
      apiKey: "",
      audienceId: "",
      fetchImpl: spy,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

// The read side is what the studio's newsletter panel answers "did this person
// reach the mailing list?" with. It must never be able to say "no" when what it
// means is "I couldn't ask" — that is what puts an Add button in front of
// someone already on the list.
describe("listAudienceContacts", () => {
  it("returns null (no opinion) rather than an empty list when unconfigured", async () => {
    const { impl, calls } = fakeFetch([ok()]);
    await expect(
      listAudienceContacts({
        audienceId: "",
        apiKey: "re_test",
        fetchImpl: impl,
      }),
    ).resolves.toBeNull();
    await expect(
      listAudienceContacts({ ...config, apiKey: "", fetchImpl: impl }),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("keys the audience by lowercased email", async () => {
    const { impl, calls } = fakeFetch([
      new Response(
        JSON.stringify({
          data: [
            { email: "Grace@Example.com" },
            // Resend reports an opt-out; we deliberately don't read it — Resend
            // owns unsubscribes, so an opted-out contact is simply on the list
            // as far as this panel is concerned, and offered no action.
            { email: "ada@example.com", unsubscribed: true },
          ],
        }),
        { status: 200 },
      ),
    ]);

    const snapshot = await listAudienceContacts({ ...config, fetchImpl: impl });

    expect(calls[0].url).toBe(
      "https://api.resend.com/audiences/aud_123/contacts",
    );
    expect(snapshot?.total).toBe(2);
    expect(membershipIn(snapshot, "grace@example.com")).toBe("subscribed");
    expect(membershipIn(snapshot, "ADA@example.com")).toBe("subscribed");
    expect(membershipIn(snapshot, "nobody@example.com")).toBe("absent");
  });

  it("skips malformed rows rather than failing the whole read", async () => {
    const { impl } = fakeFetch([
      new Response(
        JSON.stringify({ data: [{ email: 42 }, { email: "   " }, {}] }),
        { status: 200 },
      ),
    ]);

    const snapshot = await listAudienceContacts({ ...config, fetchImpl: impl });
    expect(snapshot?.total).toBe(0);
  });

  it("throws on a Resend error, so the caller can report it as unknown", async () => {
    const { impl } = fakeFetch([new Response("nope", { status: 401 })]);
    await expect(
      listAudienceContacts({ ...config, fetchImpl: impl }),
    ).rejects.toThrow(/status 401/);
  });
});

describe("membershipIn", () => {
  it("has no opinion about a null snapshot", () => {
    expect(membershipIn(null, "grace@example.com")).toBeNull();
  });
});

describe("audienceConfigured", () => {
  it("needs both the key and the audience id", () => {
    expect(audienceConfigured(config)).toBe(true);
    expect(audienceConfigured({ ...config, apiKey: "" })).toBe(false);
    expect(audienceConfigured({ ...config, audienceId: "" })).toBe(false);
  });
});
