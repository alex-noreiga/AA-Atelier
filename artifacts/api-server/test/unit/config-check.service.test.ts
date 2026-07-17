import { describe, it, expect, vi, beforeEach } from "vitest";

// The service reads the live options through the repositories and dispatches the
// alert through the best-effort mailer — all mocked so this is pure logic.
vi.mock("../../src/lib/notion/products.repository.js", () => ({
  fetchInventoryOptionSets: vi.fn(),
}));
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  listOrderStages: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { runConfigCheck } from "../../src/services/config-check.service.js";
import { fetchInventoryOptionSets } from "../../src/lib/notion/products.repository.js";
import { listOrderStages } from "../../src/lib/notion/orders.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";

const mockOptions = vi.mocked(fetchInventoryOptionSets);
const mockStages = vi.mocked(listOrderStages);
const mockSend = vi.mocked(sendEmailBestEffort);

// A live config where every code-named value is present.
const HEALTHY_OPTIONS = {
  statusOptions: ["Planned", "In Stock", "Sold"],
};
const HEALTHY_STAGES = ["Sketching", "Cutting/Pinning", "Sewing/Construction"];

describe("runConfigCheck", () => {
  beforeEach(() => {
    delete process.env.ATELIER_INBOX_EMAIL;
    delete process.env.ATELIER_CONTACT_INBOX_EMAIL;
    delete process.env.MEASUREMENT_LOCK_FROM_STAGE;
  });

  it("finds no drift and sends nothing when every named value is present", async () => {
    mockOptions.mockResolvedValue(HEALTHY_OPTIONS);
    mockStages.mockResolvedValue(HEALTHY_STAGES);
    process.env.ATELIER_INBOX_EMAIL = "atelier@example.com";

    const { findings } = await runConfigCheck();

    expect(findings).toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("emails the atelier inbox when a named value has drifted", async () => {
    mockOptions.mockResolvedValue({
      ...HEALTHY_OPTIONS,
      statusOptions: ["Planned", "Sold"], // "In Stock" renamed away
    });
    mockStages.mockResolvedValue(HEALTHY_STAGES);
    process.env.ATELIER_INBOX_EMAIL = "atelier@example.com";

    const { findings } = await runConfigCheck();

    expect(findings.length).toBeGreaterThan(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("atelier@example.com");
    expect(message.subject).toMatch(/Notion option/i);
  });

  it("does not email when there is drift but no atelier inbox is configured", async () => {
    mockOptions.mockResolvedValue({
      ...HEALTHY_OPTIONS,
      statusOptions: ["Sold"],
    });
    mockStages.mockResolvedValue(HEALTHY_STAGES);
    // ATELIER_INBOX_EMAIL is unset → nowhere to send.

    const { findings } = await runConfigCheck();

    expect(findings.length).toBeGreaterThan(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
