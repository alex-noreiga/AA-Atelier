import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/requests.repository.js", () => ({
  listPendingNewsletterSignups: vi.fn(),
  listHandledNewsletterSignups: vi.fn(),
  findRequestById: vi.fn(),
  setRequestStage: vi.fn(),
}));

vi.mock("../../src/lib/resend/audience.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/lib/resend/audience.js")>();
  return {
    ...actual,
    audienceConfigured: vi.fn(),
    listAudienceContacts: vi.fn(),
    upsertAudienceContact: vi.fn(),
  };
});

import {
  getNewsletterPanel,
  subscribeNewsletterSignup,
} from "../../src/services/studio-newsletter.service.js";
import {
  listPendingNewsletterSignups,
  listHandledNewsletterSignups,
  findRequestById,
  setRequestStage,
} from "../../src/lib/notion/requests.repository.js";
import {
  audienceConfigured,
  listAudienceContacts,
  upsertAudienceContact,
} from "../../src/lib/resend/audience.js";
import type {
  NewsletterSignupRecord,
  StudioRequestRecord,
} from "../../src/lib/notion/requests.schema.js";
import { ConflictError, NotFoundError } from "../../src/lib/errors.js";

const mockPending = vi.mocked(listPendingNewsletterSignups);
const mockHandled = vi.mocked(listHandledNewsletterSignups);
const mockFind = vi.mocked(findRequestById);
const mockSetStage = vi.mocked(setRequestStage);
const mockConfigured = vi.mocked(audienceConfigured);
const mockAudience = vi.mocked(listAudienceContacts);
const mockUpsert = vi.mocked(upsertAudienceContact);

function signup(
  overrides: Partial<NewsletterSignupRecord> = {},
): NewsletterSignupRecord {
  return {
    id: "sign-1",
    email: "skater@example.com",
    subject: "Newsletter opt-in — footer",
    source: "footer",
    state: "new",
    submittedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function row(
  overrides: Partial<StudioRequestRecord> = {},
): StudioRequestRecord {
  return {
    id: "sign-1",
    kind: "newsletter",
    subject: "Newsletter opt-in — footer",
    email: "skater@example.com",
    state: "new",
    ...overrides,
  };
}

/** A Resend audience snapshot: the emails it holds. Whether any of them have
 * since unsubscribed is deliberately not modelled — Resend owns that. */
function audience(emails: string[] = []) {
  return { contacts: new Set(emails), total: emails.length };
}

beforeEach(() => {
  mockPending.mockResolvedValue({ records: [], truncated: false });
  mockHandled.mockResolvedValue([]);
  mockConfigured.mockReturnValue(true);
  mockAudience.mockResolvedValue(audience());
  mockUpsert.mockResolvedValue(undefined);
  mockFind.mockResolvedValue(row());
  mockSetStage.mockResolvedValue(row({ state: "closed" }));
});

// The whole reason the panel exists: the capture-time sync is best-effort and
// self-gates off, so an opt-in can be in Notion and not on the list.
describe("getNewsletterPanel", () => {
  it("reports each opt-in's live membership, not a stored marker", async () => {
    mockPending.mockResolvedValue({
      records: [
        signup({ id: "on", email: "on@example.com" }),
        signup({ id: "off", email: "off@example.com" }),
      ],
      truncated: false,
    });
    mockAudience.mockResolvedValue(audience(["on@example.com"]));

    const panel = await getNewsletterPanel();

    expect(panel.pending.map((s) => [s.id, s.subscription])).toEqual([
      ["on", "subscribed"],
      ["off", "absent"],
    ]);
    expect(panel.audience).toEqual({ configured: true, contactCount: 1 });
  });

  it("matches an address whatever its casing", async () => {
    mockPending.mockResolvedValue({
      records: [signup({ email: "Skater@Example.com" })],
      truncated: false,
    });
    mockAudience.mockResolvedValue(audience(["skater@example.com"]));

    const panel = await getNewsletterPanel();
    expect(panel.pending[0].subscription).toBe("subscribed");
  });

  // "We couldn't ask" must never render as "not subscribed" — that is what puts
  // an Add button in front of someone who is already on the list.
  it("reports unknown, not absent, when Resend can't be read", async () => {
    mockPending.mockResolvedValue({ records: [signup()], truncated: false });
    mockAudience.mockRejectedValue(new Error("Resend is down"));

    const panel = await getNewsletterPanel();

    expect(panel.pending[0].subscription).toBe("unknown");
    expect(panel.audience).toEqual({ configured: true, unreachable: true });
  });

  it("tells an unconfigured audience apart from an unreachable one", async () => {
    mockConfigured.mockReturnValue(false);
    mockAudience.mockResolvedValue(null);
    mockPending.mockResolvedValue({ records: [signup()], truncated: false });

    const panel = await getNewsletterPanel();

    expect(panel.audience).toEqual({ configured: false });
    expect(panel.pending[0].subscription).toBe("unknown");
  });

  it("reports a row with no address as unknown rather than absent", async () => {
    mockPending.mockResolvedValue({
      records: [signup({ email: undefined })],
      truncated: false,
    });

    const panel = await getNewsletterPanel();
    expect(panel.pending[0].subscription).toBe("unknown");
  });

  it("still lists the pending opt-ins when the filed ones can't be read", async () => {
    mockPending.mockResolvedValue({ records: [signup()], truncated: false });
    mockHandled.mockRejectedValue(new Error("Notion is having a moment"));

    const panel = await getNewsletterPanel();

    expect(panel.pending).toHaveLength(1);
    expect(panel.handled).toEqual([]);
  });

  it("checks the already-filed rows against the list too", async () => {
    mockHandled.mockResolvedValue([signup({ id: "filed" })]);
    mockAudience.mockResolvedValue(audience());

    const panel = await getNewsletterPanel();

    // Filed away, but never actually added — visible rather than assumed done.
    expect(panel.handled[0].subscription).toBe("absent");
  });
});

describe("subscribeNewsletterSignup", () => {
  it("adds to Resend first, then files the row away", async () => {
    const order: string[] = [];
    mockUpsert.mockImplementation(async () => {
      order.push("resend");
    });
    mockSetStage.mockImplementation(async () => {
      order.push("notion");
      return row({ state: "closed" });
    });

    const result = await subscribeNewsletterSignup("sign-1");

    expect(order).toEqual(["resend", "notion"]);
    expect(mockUpsert).toHaveBeenCalledWith("skater@example.com");
    expect(mockSetStage).toHaveBeenCalledWith("sign-1", "closed");
    expect(result).toMatchObject({
      email: "skater@example.com",
      state: "closed",
      subscription: "subscribed",
      source: "footer",
    });
  });

  // Filing a row away having never reached the list costs a subscriber
  // silently; leaving it costs one more press.
  it("leaves the row open when Resend refuses", async () => {
    mockUpsert.mockRejectedValue(new Error("Resend said no"));

    await expect(subscribeNewsletterSignup("sign-1")).rejects.toThrow(
      "Resend said no",
    );
    expect(mockSetStage).not.toHaveBeenCalled();
  });

  // Leaving an address Resend already holds alone is what keeps the studio out
  // of anyone's unsubscribe: an opted-out contact is on the audience, so the
  // upsert — whose PATCH would clear their opt-out — is never reached for them.
  it("writes nothing to Resend for an address already on the list, and still files the row", async () => {
    mockAudience.mockResolvedValue(audience(["skater@example.com"]));

    const result = await subscribeNewsletterSignup("sign-1");

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockSetStage).toHaveBeenCalledWith("sign-1", "closed");
    expect(result.subscription).toBe("subscribed");
  });

  it("refuses when no audience is configured, rather than closing the row", async () => {
    mockConfigured.mockReturnValue(false);

    await expect(subscribeNewsletterSignup("sign-1")).rejects.toThrow(
      ConflictError,
    );
    expect(mockSetStage).not.toHaveBeenCalled();
  });

  it("refuses a row with no address", async () => {
    mockFind.mockResolvedValue(row({ email: undefined }));

    await expect(subscribeNewsletterSignup("sign-1")).rejects.toThrow(
      ConflictError,
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("404s for a sign-up deleted in Notion since the panel loaded", async () => {
    mockFind.mockResolvedValue(null);

    await expect(subscribeNewsletterSignup("gone")).rejects.toThrow(
      NotFoundError,
    );
  });
});
