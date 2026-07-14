import { describe, it, expect, vi, afterEach } from "vitest";
import { createResendClient } from "../../src/lib/resend/client.js";

// The real client builds the HTTP request to Resend; stub global fetch to
// assert on the request shape (endpoint, auth header, JSON body) without a
// network call. The fake-resend double bypasses this layer, so it's covered
// here directly.
afterEach(() => vi.unstubAllGlobals());

function stubFetchOk() {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createResendClient.send", () => {
  it("POSTs from/to/subject/html/text to the Resend /emails endpoint with bearer auth", async () => {
    const fetchMock = stubFetchOk();
    const client = createResendClient({
      apiKey: "re_test",
      from: "A.A Atelier <orders@a3iceanddance.com>",
    });

    await client.send({
      to: "customer@example.com",
      subject: "Hi",
      html: "<p>h</p>",
      text: "h",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test");

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      from: "A.A Atelier <orders@a3iceanddance.com>",
      to: "customer@example.com",
      subject: "Hi",
      html: "<p>h</p>",
      text: "h",
    });
    expect(body).not.toHaveProperty("reply_to");
  });

  it("includes reply_to only when replyTo is set", async () => {
    const fetchMock = stubFetchOk();
    const client = createResendClient({
      apiKey: "re_test",
      from: "from@x.com",
    });

    await client.send({
      to: "orders@a3iceanddance.com",
      subject: "New contact message",
      html: "<p>x</p>",
      text: "x",
      replyTo: "customer@example.com",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reply_to).toBe("customer@example.com");
  });

  it("throws when the API key is empty, without calling fetch", async () => {
    const fetchMock = stubFetchOk();
    const client = createResendClient({ apiKey: "", from: "from@x.com" });

    await expect(
      client.send({ to: "a@b.com", subject: "s", html: "h", text: "t" }),
    ).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports configured only when both key and from are present", () => {
    expect(
      createResendClient({ apiKey: "k", from: "f@x.com" }).configured,
    ).toBe(true);
    expect(createResendClient({ apiKey: "", from: "f@x.com" }).configured).toBe(
      false,
    );
    expect(createResendClient({ apiKey: "k", from: "" }).configured).toBe(
      false,
    );
  });
});
