import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Notion adapter so the real service + route + auth stack runs without
// the network. The section resolution and the file handling are unit-tested.
vi.mock("../../src/lib/notion/guides.repository.js", () => ({
  guidesConfigured: vi.fn(),
  listGuides: vi.fn(),
  findGuideById: vi.fn(),
  fetchGuideDocument: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  guidesConfigured,
  listGuides,
  findGuideById,
  fetchGuideDocument,
} from "../../src/lib/notion/guides.repository.js";
import { NotionRequestError } from "../../src/lib/notion/errors.js";
import { __resetStudioGuidesCache } from "../../src/services/studio-guides.service.js";
import type { GuideRecord } from "../../src/lib/notion/guides.schema.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockConfigured = vi.mocked(guidesConfigured);
const mockList = vi.mocked(listGuides);
const mockFind = vi.mocked(findGuideById);
const mockFetch = vi.mocked(fetchGuideDocument);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

function guide(overrides: Partial<GuideRecord> = {}): GuideRecord {
  return {
    id: "guide-1",
    title: "Building an invoice",
    section: "Itemize an invoice",
    order: null,
    attachment: {
      kind: "upload",
      name: "invoicing-guide.html",
      url: "https://files/x.html",
    },
    notionUrl: "https://notion.so/guide-1",
    ...overrides,
  };
}

function acceptToken(validToken: string, claims: FakeClaims): void {
  __setSupabaseClientForTests(
    asSupabaseClient(
      makeFakeSupabaseClient((token) =>
        token === validToken
          ? { data: { claims }, error: null }
          : { data: null, error: { message: "invalid token" } },
      ),
    ),
  );
}

beforeEach(() => {
  __resetStudioGuidesCache();
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key";
  process.env.STUDIO_STAFF_EMAILS = STAFF;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  mockConfigured.mockReturnValue(true);
  mockList.mockResolvedValue({ records: [guide()], truncated: false });
  mockFind.mockResolvedValue(guide());
  mockFetch.mockResolvedValue({ ok: true, html: "<h1>How to</h1>" });
  acceptToken("staff-token", GOOGLE_STAFF);
});

afterEach(() => {
  __resetSupabaseClient();
  __resetStudioGuidesCache();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
});

describe("GET /api/studio/guides", () => {
  it("answers 401 without a Bearer token, and reads nothing", async () => {
    const response = await request(app).get("/api/studio/guides");

    expect(response.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  // Not-staff is answered as though the route doesn't exist — the same
  // indistinguishable-from-404 posture as the rest of the studio surface.
  it("answers 404 for a signed-in customer", async () => {
    acceptToken("customer-token", {
      email: "someone@example.com",
      sub: "user-2",
      amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
    });

    const response = await request(app)
      .get("/api/studio/guides")
      .set("Authorization", "Bearer customer-token");

    expect(response.status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("answers 403 for staff whose session wasn't established with Google", async () => {
    acceptToken("password-token", {
      email: STAFF,
      sub: "user-1",
      amr: [{ method: "password", timestamp: 1_700_000_000 }],
    });

    const response = await request(app)
      .get("/api/studio/guides")
      .set("Authorization", "Bearer password-token");

    expect(response.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("lists the guide and where it belongs, without its markup", async () => {
    const response = await request(app)
      .get("/api/studio/guides")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(true);
    expect(response.body.guides).toHaveLength(1);
    expect(response.body.guides[0]).toMatchObject({
      title: "Building an invoice",
      section: "invoice-lines",
      notionUrl: "https://notion.so/guide-1",
    });
    // The listing must stay small: inlining every guide's markup is what would
    // push a studio's whole manual past the serverless response limit.
    expect(response.body.guides[0].html).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The vocabulary rides along whether or not anything is filed against it —
  // it's the only place the accepted Section values are discoverable.
  it("serves the section vocabulary alongside the guides", async () => {
    const response = await request(app)
      .get("/api/studio/guides")
      .set("Authorization", "Bearer staff-token");

    const ids = response.body.sections.map((s: { id: string }) => s.id);
    expect(ids).toContain("invoice-lines");
    expect(ids).toContain("materials");
    expect(ids.at(-1)).toBe("general");
  });

  it("lists a guide whose file can't be shown, with the reason", async () => {
    mockList.mockResolvedValue({
      records: [guide({ attachment: undefined })],
      truncated: false,
    });

    const response = await request(app)
      .get("/api/studio/guides")
      .set("Authorization", "Bearer staff-token");

    expect(response.body.guides[0]).toMatchObject({ unavailable: "no-file" });
    expect(response.body.guides[0].html).toBeUndefined();
  });

  // An unconfigured database must not 500 the dashboard, and must not render as
  // an empty list that reads as "no guides have been written".
  it("reports configured:false rather than erroring when the database is unset", async () => {
    mockConfigured.mockReturnValue(false);

    const response = await request(app)
      .get("/api/studio/guides")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(false);
    expect(response.body.guides).toEqual([]);
    expect(response.body.sections.length).toBeGreaterThan(0);
    expect(mockList).not.toHaveBeenCalled();
  });

  // The id set but the integration never shared 404s every query. Left as a
  // throw that is a permanent 500 plus an alert email on every dashboard load,
  // for a misconfiguration the "not connected" copy already tells you to fix.
  it("reports an unreachable database rather than 500ing", async () => {
    mockList.mockRejectedValue(new NotionRequestError("404", 404));

    const response = await request(app)
      .get("/api/studio/guides")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      guides: [],
      configured: true,
      unreachable: true,
    });
  });
});

describe("GET /api/studio/guides/:guideId", () => {
  it("answers 401 without a Bearer token, and reads nothing", async () => {
    const response = await request(app).get("/api/studio/guides/guide-1");

    expect(response.status).toBe(401);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("answers 404 for a signed-in customer", async () => {
    acceptToken("customer-token", {
      email: "someone@example.com",
      sub: "user-2",
      amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
    });

    const response = await request(app)
      .get("/api/studio/guides/guide-1")
      .set("Authorization", "Bearer customer-token");

    expect(response.status).toBe(404);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("answers 403 for staff whose session wasn't established with Google", async () => {
    acceptToken("password-token", {
      email: STAFF,
      sub: "user-1",
      amr: [{ method: "password", timestamp: 1_700_000_000 }],
    });

    const response = await request(app)
      .get("/api/studio/guides/guide-1")
      .set("Authorization", "Bearer password-token");

    expect(response.status).toBe(403);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns the downloaded markup for a studio account", async () => {
    const response = await request(app)
      .get("/api/studio/guides/guide-1")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: "guide-1", html: "<h1>How to</h1>" });
  });

  it("404s a guide that no longer exists", async () => {
    mockFind.mockResolvedValue(null);

    const response = await request(app)
      .get("/api/studio/guides/gone")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(404);
  });

  // Never requested: the server returns what it downloads, and the URL comes
  // from a database whose editors are a Notion permission, not the allowlist.
  it("refuses a pasted link without fetching it", async () => {
    mockFind.mockResolvedValue(
      guide({ attachment: { kind: "external", name: "linked.html" } }),
    );

    const response = await request(app)
      .get("/api/studio/guides/guide-1")
      .set("Authorization", "Bearer staff-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: "guide-1",
      unavailable: "not-uploaded",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
