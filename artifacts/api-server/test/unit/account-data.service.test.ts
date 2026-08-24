import { describe, it, expect, vi, afterEach } from "vitest";

// Mock every source the export reads and every side effect the deletion request
// has. The service's own logic — degrade-and-name, the dedupe, the order the
// erasure steps run in — runs for real between them.
vi.mock("../../src/services/account.service.js", () => ({
  listCustomOrders: vi.fn().mockResolvedValue([]),
  listShopOrders: vi.fn().mockResolvedValue([]),
  upcomingAppointments: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  findClientProfileByEmail: vi.fn().mockResolvedValue(null),
  upsertClientByEmail: vi.fn().mockResolvedValue("client-page"),
}));
vi.mock("../../src/lib/notion/requests.repository.js", () => ({
  listRequestsByEmail: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  listReviewsByEmail: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/lib/notion/data-deletion.repository.js", () => ({
  createDataDeletionRequest: vi.fn(),
  hasOpenDataDeletionRequest: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../src/lib/resend/audience.js", () => ({
  listAudienceContacts: vi.fn().mockResolvedValue(null),
  membershipIn: vi.fn().mockReturnValue(null),
  unsubscribeAudienceContact: vi.fn().mockResolvedValue("unsubscribed"),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import {
  exportAccountData,
  submitAccountDeletionRequest,
} from "../../src/services/account-data.service.js";
import {
  listCustomOrders,
  listShopOrders,
  upcomingAppointments,
} from "../../src/services/account.service.js";
import {
  findClientProfileByEmail,
  upsertClientByEmail,
} from "../../src/lib/notion/clients.repository.js";
import { listRequestsByEmail } from "../../src/lib/notion/requests.repository.js";
import { listReviewsByEmail } from "../../src/lib/notion/reviews.repository.js";
import {
  createDataDeletionRequest,
  hasOpenDataDeletionRequest,
} from "../../src/lib/notion/data-deletion.repository.js";
import {
  listAudienceContacts,
  membershipIn,
  unsubscribeAudienceContact,
} from "../../src/lib/resend/audience.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";

const mockCustomOrders = vi.mocked(listCustomOrders);
const mockShopOrders = vi.mocked(listShopOrders);
const mockAppointments = vi.mocked(upcomingAppointments);
const mockClient = vi.mocked(findClientProfileByEmail);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockRequests = vi.mocked(listRequestsByEmail);
const mockReviews = vi.mocked(listReviewsByEmail);
const mockCreateDeletion = vi.mocked(createDataDeletionRequest);
const mockHasOpen = vi.mocked(hasOpenDataDeletionRequest);
const mockAudience = vi.mocked(listAudienceContacts);
const mockMembership = vi.mocked(membershipIn);
const mockUnsubscribe = vi.mocked(unsubscribeAudienceContact);
const mockSend = vi.mocked(sendEmailBestEffort);

const EMAIL = "ada@example.com";

afterEach(() => {
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.ATELIER_INBOX_EMAIL;
});

describe("exportAccountData", () => {
  it("gathers every source and reports nothing unavailable when all succeed", async () => {
    const result = await exportAccountData(EMAIL, "user-1");

    expect(result.email).toBe(EMAIL);
    expect(result.userId).toBe("user-1");
    expect(result.unavailable).toEqual([]);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const source of [
      mockCustomOrders,
      mockShopOrders,
      mockAppointments,
      mockClient,
      mockRequests,
      mockReviews,
    ]) {
      expect(source).toHaveBeenCalledWith(EMAIL);
    }
  });

  it("names a source it could not read instead of silently omitting it", async () => {
    mockReviews.mockRejectedValueOnce(new Error("Notion 503"));

    const result = await exportAccountData(EMAIL);

    expect(result.unavailable).toEqual(["Reviews you've written"]);
    expect(result.reviews).toEqual([]);
    // The rest of the export still arrives — one failed source must not cost a
    // customer the answer to the whole request.
    expect(result.customOrders).toEqual([]);
    expect(mockCustomOrders).toHaveBeenCalled();
  });

  it("still returns an export when the orders themselves can't be read", async () => {
    mockCustomOrders.mockRejectedValueOnce(new Error("Notion down"));
    mockShopOrders.mockRejectedValueOnce(new Error("Notion down"));

    const result = await exportAccountData(EMAIL);

    expect(result.unavailable).toEqual(["Custom orders", "Shop orders"]);
  });

  it("strips the signed manage token from an exported appointment", async () => {
    mockAppointments.mockResolvedValueOnce([
      {
        status: "confirmed",
        confirmationCode: "AA-1234",
        typeId: "fitting",
        typeName: "Fitting",
        staff: "Alayna",
        location: "in-person",
        locationLabel: "The studio",
        start: "2026-09-01T15:00:00.000Z",
        end: "2026-09-01T16:00:00.000Z",
        timezone: "America/Chicago",
        canModify: true,
        manageToken: "a-signed-credential",
      },
    ] as unknown as Awaited<ReturnType<typeof upcomingAppointments>>);

    const result = await exportAccountData(EMAIL);

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).not.toHaveProperty("manageToken");
    expect(result.appointments[0].confirmationCode).toBe("AA-1234");
  });

  it("keeps the studio's own bookkeeping out of an exported request", async () => {
    mockRequests.mockResolvedValueOnce([
      {
        id: "page-1",
        kind: "cancellation",
        subject: "Cancellation: ORD-000002",
        message: "Cancellation requested…",
        orderNumber: "ORD-000002",
        state: "new",
        submittedAt: "2026-08-01T10:00:00.000Z",
        notionUrl: "https://notion.so/page-1",
        action: { tool: "cancellation-refund", orderNumber: "ORD-000002" },
      },
    ]);

    const [exported] = (await exportAccountData(EMAIL)).requests;

    expect(exported).toEqual({
      kind: "cancellation",
      subject: "Cancellation: ORD-000002",
      state: "new",
      message: "Cancellation requested…",
      orderNumber: "ORD-000002",
      submittedAt: "2026-08-01T10:00:00.000Z",
    });
  });

  it("exports an unpublished review as readily as a published one", async () => {
    mockReviews.mockResolvedValueOnce([
      {
        id: "review-1",
        rating: 5,
        comment: "The dress was perfect.",
        emailVerified: true,
        consentToPublish: false,
        status: "pending",
        submittedAt: "2026-07-01T10:00:00.000Z",
        notionUrl: "https://notion.so/review-1",
      },
    ]);

    const [exported] = (await exportAccountData(EMAIL)).reviews;

    expect(exported).toEqual({
      rating: 5,
      comment: "The dress was perfect.",
      consentToPublish: false,
      status: "pending",
      submittedAt: "2026-07-01T10:00:00.000Z",
    });
  });

  it("omits the blank fields a Notion read returns for an absent property", async () => {
    mockClient.mockResolvedValueOnce({
      name: "Ada",
      email: EMAIL,
      phone: "",
      status: "Active",
      lastContact: "",
      referralCode: "ADA-1234",
      referredByEmail: "",
      firstPaidOrder: "",
    });

    const result = await exportAccountData(EMAIL);

    expect(result.client).toEqual({
      name: "Ada",
      email: EMAIL,
      status: "Active",
      referralCode: "ADA-1234",
    });
  });

  it("reports the marketing list as unknown — not absent — when it can't be read", async () => {
    mockAudience.mockRejectedValueOnce(new Error("Resend 500"));

    const result = await exportAccountData(EMAIL);

    expect(result.marketing.status).toBe("unknown");
    // Its own field already says so where the customer is reading, so it does
    // not also appear in the unavailable list.
    expect(result.unavailable).toEqual([]);
  });

  it("reports the marketing list membership Resend gives", async () => {
    mockMembership.mockReturnValueOnce("subscribed");
    const result = await exportAccountData(EMAIL);
    expect(result.marketing.status).toBe("subscribed");
  });
});

describe("submitAccountDeletionRequest", () => {
  it("unsubscribes, files the request, and reports what it did", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <hello@example.com>";

    const result = await submitAccountDeletionRequest(
      EMAIL,
      { note: "  Please finish ORD-1 first.  " },
      "user-1",
    );

    expect(result).toEqual({
      received: true,
      alreadyRequested: false,
      marketing: "unsubscribed",
    });
    expect(mockUnsubscribe).toHaveBeenCalledWith(EMAIL);
    expect(mockCreateDeletion).toHaveBeenCalledWith(
      {
        email: EMAIL,
        marketing: "unsubscribed",
        userId: "user-1",
        note: "Please finish ORD-1 first.",
      },
      undefined,
      "client-page",
    );
    // Customer acknowledgement only — no atelier inbox configured.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("files nothing a second time while a request is already open", async () => {
    mockHasOpen.mockResolvedValueOnce(true);

    const result = await submitAccountDeletionRequest(EMAIL, {});

    expect(result.alreadyRequested).toBe(true);
    expect(mockCreateDeletion).not.toHaveBeenCalled();
    // …but the opt-out still runs, so a first attempt that couldn't reach
    // Resend gets another go.
    expect(mockUnsubscribe).toHaveBeenCalledWith(EMAIL);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("records that the mailing list still needs doing by hand", async () => {
    mockUnsubscribe.mockResolvedValueOnce("unavailable");

    const result = await submitAccountDeletionRequest(EMAIL, {});

    expect(result.marketing).toBe("unavailable");
    expect(mockCreateDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ marketing: "unavailable" }),
      undefined,
      "client-page",
    );
  });

  it("files the request even when the CRM link can't be resolved", async () => {
    mockUpsertClient.mockRejectedValueOnce(new Error("CRM down"));

    const result = await submitAccountDeletionRequest(EMAIL, {});

    expect(result.received).toBe(true);
    expect(mockCreateDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL }),
      undefined,
      undefined,
    );
  });

  it("notifies the atelier inbox when one is configured", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <hello@example.com>";
    process.env.ATELIER_INBOX_EMAIL = "studio@example.com";

    await submitAccountDeletionRequest(EMAIL, {}, "user-1");

    expect(mockSend).toHaveBeenCalledTimes(2);
    const notification = mockSend.mock.calls[1][0];
    expect(notification.to).toBe("studio@example.com");
    expect(notification.replyTo).toBe(EMAIL);
    expect(notification.subject).toContain(EMAIL);
  });

  it("propagates a Notion failure rather than reporting a request nobody has", async () => {
    mockCreateDeletion.mockRejectedValueOnce(new Error("Notion 500"));

    await expect(submitAccountDeletionRequest(EMAIL, {})).rejects.toThrow(
      "Notion 500",
    );
  });
});
