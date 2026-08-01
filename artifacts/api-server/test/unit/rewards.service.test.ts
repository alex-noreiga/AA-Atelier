import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The CRM reads/writes, the Stripe promo creation, the Stripe client, and the
// mailer are all mocked so the tests exercise the reward STATE MACHINE purely —
// no Notion, no Stripe, no mail. The CRM module keeps its real property-name
// constants (via importOriginal) so the patch bodies assert against real names.
vi.mock(
  "../../src/lib/notion/clients.repository.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/lib/notion/clients.repository.js")
      >();
    return {
      ...actual,
      findClientByReferralCode: vi.fn(),
      getClientRewardRowByEmail: vi.fn(),
      patchClientProperties: vi.fn(),
    };
  },
);
vi.mock("../../src/lib/stripe/promotions.js", () => ({
  createDiscountCode: vi.fn(
    async (_stripe, spec: { code: string }) => spec.code,
  ),
}));
vi.mock("../../src/lib/stripe/client.js", () => ({
  getStripeClient: vi.fn(() => ({}) as never),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import {
  ensureReferralCode,
  captureReferralOnOrder,
  runPaidOrderRewards,
  referralCreditAmount,
  welcomeDiscountPercent,
  returningDiscountPercent,
  rewardCodeExpiresDays,
} from "../../src/services/rewards.service.js";
import {
  findClientByReferralCode,
  getClientRewardRowByEmail,
  patchClientProperties,
  type ClientRewardRow,
} from "../../src/lib/notion/clients.repository.js";
import { createDiscountCode } from "../../src/lib/stripe/promotions.js";
import { getStripeClient } from "../../src/lib/stripe/client.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";

const mockFindByCode = vi.mocked(findClientByReferralCode);
const mockGetRow = vi.mocked(getClientRewardRowByEmail);
const mockPatch = vi.mocked(patchClientProperties);
const mockCreateCode = vi.mocked(createDiscountCode);
const mockSend = vi.mocked(sendEmailBestEffort);

function row(overrides: Partial<ClientRewardRow> = {}): ClientRewardRow {
  return {
    pageId: "client-1",
    email: "ada@example.com",
    referralCode: "",
    referredByEmail: "",
    referralRewarded: false,
    firstPaidOrder: "",
    returningRewardIssued: false,
    returningDiscountCode: "",
    ...overrides,
  };
}

/** The reward-type of a createDiscountCode call, from its spec `name`. */
function codeCallNames(): string[] {
  return mockCreateCode.mock.calls.map((c) => (c[1] as { name: string }).name);
}

beforeEach(() => {
  // A truthy Stripe client so stripeOrNull() doesn't gate off.
  vi.mocked(getStripeClient).mockReturnValue({} as never);
});

afterEach(() => {
  delete process.env.REFERRAL_CREDIT_AMOUNT;
  delete process.env.REFERRAL_WELCOME_PERCENT;
  delete process.env.RETURNING_DISCOUNT_PERCENT;
});

describe("reward amount getters", () => {
  it("fall back to defaults when unset", () => {
    expect(referralCreditAmount()).toBe(40);
    expect(welcomeDiscountPercent()).toBe(10);
    expect(returningDiscountPercent()).toBe(10);
    expect(rewardCodeExpiresDays()).toBe(90);
  });

  it("read a valid env override", () => {
    process.env.REFERRAL_CREDIT_AMOUNT = "25";
    process.env.REFERRAL_WELCOME_PERCENT = "15";
    process.env.RETURNING_DISCOUNT_PERCENT = "5";
    expect(referralCreditAmount()).toBe(25);
    expect(welcomeDiscountPercent()).toBe(15);
    expect(returningDiscountPercent()).toBe(5);
  });

  it("reject an out-of-range percentage (>100) and fall back", () => {
    process.env.REFERRAL_WELCOME_PERCENT = "150";
    expect(welcomeDiscountPercent()).toBe(10);
  });

  it("reject a negative / unparseable amount and fall back", () => {
    process.env.REFERRAL_CREDIT_AMOUNT = "-5";
    expect(referralCreditAmount()).toBe(40);
    process.env.REFERRAL_CREDIT_AMOUNT = "lots";
    expect(referralCreditAmount()).toBe(40);
  });
});

describe("ensureReferralCode", () => {
  it("returns null when there is no client row (CRM off / not a customer)", async () => {
    mockGetRow.mockResolvedValue(null);
    expect(await ensureReferralCode("ada@example.com")).toBeNull();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("returns null (best-effort) when the CRM read throws", async () => {
    mockGetRow.mockRejectedValue(new Error("crm down"));
    expect(await ensureReferralCode("ada@example.com")).toBeNull();
  });

  it("returns the existing code without regenerating it", async () => {
    mockGetRow.mockResolvedValue(row({ referralCode: "AA-EXIST1" }));
    const info = await ensureReferralCode("ada@example.com");
    expect(info).toMatchObject({ code: "AA-EXIST1", creditAmount: 40 });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("generates + persists a deterministic code on first view", async () => {
    mockGetRow.mockResolvedValue(row({ pageId: "client-9" }));
    const a = await ensureReferralCode("ada@example.com");
    expect(a?.code).toMatch(/^AA-[A-Z0-9]{6}$/);
    expect(mockPatch).toHaveBeenCalledWith("client-9", {
      "Referral Code": { rich_text: [{ text: { content: a!.code } }] },
    });

    // Deterministic: a fresh row for the same email regenerates the same code.
    mockGetRow.mockResolvedValue(row({ pageId: "client-9" }));
    const b = await ensureReferralCode("ada@example.com");
    expect(b?.code).toBe(a?.code);
  });

  it("surfaces a standing returning-discount code when present", async () => {
    mockGetRow.mockResolvedValue(
      row({ referralCode: "AA-EXIST1", returningDiscountCode: "AA-AGAIN-1" }),
    );
    const info = await ensureReferralCode("ada@example.com");
    expect(info?.returningCode).toBe("AA-AGAIN-1");
  });
});

describe("captureReferralOnOrder", () => {
  it("no-ops when no code was entered", async () => {
    await captureReferralOnOrder({ email: "ada@example.com" });
    expect(mockGetRow).not.toHaveBeenCalled();
  });

  it("no-ops when the customer was already referred (no re-stamp / re-email)", async () => {
    mockGetRow.mockResolvedValue(row({ referredByEmail: "old@example.com" }));
    await captureReferralOnOrder({
      referralCode: "AA-ABC123",
      email: "ada@example.com",
    });
    expect(mockFindByCode).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("ignores an unknown code", async () => {
    mockGetRow.mockResolvedValue(row());
    mockFindByCode.mockResolvedValue(null);
    await captureReferralOnOrder({
      referralCode: "AA-NOPE",
      email: "ada@example.com",
    });
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockCreateCode).not.toHaveBeenCalled();
  });

  it("rejects a self-referral", async () => {
    mockGetRow.mockResolvedValue(row({ email: "ada@example.com" }));
    mockFindByCode.mockResolvedValue({
      pageId: "ref-1",
      email: "Ada@Example.com",
    });
    await captureReferralOnOrder({
      referralCode: "AA-SELF",
      email: "ada@example.com",
    });
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockCreateCode).not.toHaveBeenCalled();
  });

  it("stamps the referrer and issues + emails the welcome discount", async () => {
    mockGetRow.mockResolvedValue(
      row({ pageId: "client-2", email: "new@example.com" }),
    );
    mockFindByCode.mockResolvedValue({
      pageId: "ref-1",
      email: "referrer@example.com",
    });

    await captureReferralOnOrder({
      referralCode: "AA-ABC123",
      email: "new@example.com",
    });

    // Referrer link stamped on the new customer's row.
    expect(mockPatch).toHaveBeenCalledWith("client-2", {
      "Referred By Email": {
        rich_text: [{ text: { content: "referrer@example.com" } }],
      },
    });
    // Welcome code created (percentage, single-use) + emailed to the new skater.
    expect(codeCallNames()).toContain("Referral welcome");
    const spec = mockCreateCode.mock.calls[0][1] as {
      percentOff?: number;
      maxRedemptions?: number;
    };
    expect(spec.percentOff).toBe(10);
    expect(spec.maxRedemptions).toBe(1);
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("new@example.com");
  });
});

describe("runPaidOrderRewards — referrer credit", () => {
  it("credits the referrer once on a referred customer's paid order", async () => {
    mockGetRow.mockResolvedValue(
      row({
        pageId: "client-2",
        referredByEmail: "referrer@example.com",
        referralRewarded: false,
        firstPaidOrder: "ORD-1", // already had a first order → isolate the credit
        returningRewardIssued: true,
      }),
    );

    await runPaidOrderRewards("new@example.com", "ORD-1");

    expect(codeCallNames()).toContain("Referral credit");
    const spec = mockCreateCode.mock.calls.find(
      (c) => (c[1] as { name: string }).name === "Referral credit",
    )![1] as { amountOffDollars?: number; minimumAmountDollars?: number };
    expect(spec.amountOffDollars).toBe(40);
    expect(spec.minimumAmountDollars).toBe(40);
    // Guard flag + audit code written, and the referrer emailed.
    expect(mockPatch).toHaveBeenCalledWith(
      "client-2",
      expect.objectContaining({ "Referral Rewarded": { checkbox: true } }),
    );
    expect(
      mockSend.mock.calls.some((c) => c[0].to === "referrer@example.com"),
    ).toBe(true);
  });

  it("does not credit when already rewarded", async () => {
    mockGetRow.mockResolvedValue(
      row({
        referredByEmail: "referrer@example.com",
        referralRewarded: true,
        firstPaidOrder: "ORD-1",
        returningRewardIssued: true,
      }),
    );
    await runPaidOrderRewards("new@example.com", "ORD-1");
    expect(codeCallNames()).not.toContain("Referral credit");
  });

  it("does not credit when the customer was not referred", async () => {
    mockGetRow.mockResolvedValue(
      row({ firstPaidOrder: "ORD-1", returningRewardIssued: true }),
    );
    await runPaidOrderRewards("new@example.com", "ORD-1");
    expect(codeCallNames()).not.toContain("Referral credit");
  });
});

describe("runPaidOrderRewards — returning-skater standing discount", () => {
  it("records the first paid order without issuing a reward", async () => {
    mockGetRow.mockResolvedValue(
      row({ pageId: "client-2", firstPaidOrder: "" }),
    );

    await runPaidOrderRewards("ada@example.com", "ORD-100");

    expect(mockPatch).toHaveBeenCalledWith("client-2", {
      "First Paid Order": { rich_text: [{ text: { content: "ORD-100" } }] },
    });
    expect(codeCallNames()).not.toContain("Returning skater");
  });

  it("does nothing on a later payment / retry of the SAME first order", async () => {
    mockGetRow.mockResolvedValue(row({ firstPaidOrder: "ORD-100" }));
    await runPaidOrderRewards("ada@example.com", "ORD-100");
    expect(mockPatch).not.toHaveBeenCalled();
    expect(codeCallNames()).not.toContain("Returning skater");
  });

  it("issues a standing discount on a second, different paid order", async () => {
    mockGetRow.mockResolvedValue(
      row({
        pageId: "client-2",
        email: "ada@example.com",
        firstPaidOrder: "ORD-100",
      }),
    );

    await runPaidOrderRewards("ada@example.com", "ORD-200");

    expect(codeCallNames()).toContain("Returning skater");
    const spec = mockCreateCode.mock.calls.find(
      (c) => (c[1] as { name: string }).name === "Returning skater",
    )![1] as { percentOff?: number; maxRedemptions?: number };
    expect(spec.percentOff).toBe(10);
    expect(spec.maxRedemptions).toBeUndefined(); // standing = reusable
    expect(mockPatch).toHaveBeenCalledWith(
      "client-2",
      expect.objectContaining({
        "Returning Reward Issued": { checkbox: true },
      }),
    );
    expect(mockSend.mock.calls.some((c) => c[0].to === "ada@example.com")).toBe(
      true,
    );
  });

  it("does not re-issue when a standing discount already exists", async () => {
    mockGetRow.mockResolvedValue(
      row({ firstPaidOrder: "ORD-100", returningRewardIssued: true }),
    );
    await runPaidOrderRewards("ada@example.com", "ORD-200");
    expect(codeCallNames()).not.toContain("Returning skater");
  });

  it("no-ops entirely when there is no client row", async () => {
    mockGetRow.mockResolvedValue(null);
    await runPaidOrderRewards("ada@example.com", "ORD-200");
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockCreateCode).not.toHaveBeenCalled();
  });
});
