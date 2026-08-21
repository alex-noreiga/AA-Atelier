import { Router } from "express";
import {
  CreateStaffAvailabilityBody,
  CreateStaffAvailabilityResponse,
  DeleteStaffAvailabilityParams,
  DeleteStaffAvailabilityResponse,
  GetStudioAccessResponse,
  GetStudioAnalyticsResponse,
  GetStudioMaterialsResponse,
  GetStudioSettingsResponse,
  ListStaffAvailabilityResponse,
  ListStudioReviewsResponse,
  RunStudioToolBody,
  RunStudioToolParams,
  RunStudioToolResponse,
  SetStudioReviewStatusBody,
  SetStudioReviewStatusParams,
  SetStudioReviewStatusResponse,
  SetStudioSettingBody,
  SetStudioSettingParams,
  SetStudioSettingResponse,
  UpdateStaffAvailabilityBody,
  UpdateStaffAvailabilityParams,
  UpdateStaffAvailabilityResponse,
} from "@workspace/api-zod";
import { requireStaff } from "../middlewares/auth.js";
import { accountRateLimiter } from "../middlewares/rate-limit.js";
import { validate } from "../middlewares/validate.js";
import { getStudioAnalytics } from "../services/studio-analytics.service.js";
import { getMaterialsOverview } from "../services/materials.service.js";
import {
  runStudioTool,
  type StudioToolArgs,
  type StudioToolName,
} from "../services/studio-tools.service.js";
import {
  getReviewQueue,
  setReviewModeration,
} from "../services/studio-reviews.service.js";
import type { ReviewModeration } from "../lib/notion/reviews.schema.js";
import {
  getStudioSettings,
  saveStudioSetting,
} from "../services/studio-settings.service.js";
import {
  getStaffAvailability,
  addStaffAvailability,
  editStaffAvailability,
  removeStaffAvailability,
  type StaffAvailabilityInput,
} from "../services/staff-availability.service.js";

const router = Router();

// "May I use the studio dashboard?" — the probe behind the staff-only entry
// point in the navbar, so a way in exists without publishing the URL to every
// visitor (it was previously reachable only by typing `/studio`).
//
// It deliberately runs the SAME `requireStaff` gate as the two routes below
// rather than re-deriving the answer from the allowlist: one decision, so the
// link can never be offered to someone the figures would refuse. Reaching this
// handler IS the answer, which is why the body is a constant — there is nothing
// to read and nothing to compute, and a non-staff caller never gets here.
router.get("/studio/access", accountRateLimiter, requireStaff, (_req, res) => {
  res.json(GetStudioAccessResponse.parse({ staff: true }));
});

// The internal studio dashboard's figures. `requireStaff` verifies the same
// Supabase access token the customer portal uses and additionally requires the
// signed-in email to be on the studio allowlist — 401 when not signed in, 403
// when signed in as a customer. The account limiter is reused as a cheap brake
// on the authorization surface, exactly as on `/account/overview`.
router.get(
  "/studio/analytics",
  accountRateLimiter,
  requireStaff,
  async (_req, res) => {
    const analytics = await getStudioAnalytics();
    res.json(GetStudioAnalyticsResponse.parse(analytics));
  },
);

// The internal tools — the atelier actions that used to be links carrying
// `CRON_SECRET` in their query string (milestone reconciliation, invoice
// itemization, a status-change email, the two refunds). Same `requireStaff`
// gate as the figures above: the work is unchanged, only who may trigger it.
//
// Unlike those links this is contract-first, because it's an ordinary SPA JSON
// call from the dashboard rather than a browser tab the atelier opens by hand —
// so the tool name and its arguments are validated by the generated schemas
// before the service sees them, and an unknown tool is a 400 rather than a
// route that quietly doesn't exist.
router.post(
  "/studio/tools/:tool",
  accountRateLimiter,
  requireStaff,
  validate({ params: RunStudioToolParams, body: RunStudioToolBody }),
  async (_req, res) => {
    const { tool } = res.locals.params as { tool: StudioToolName };
    const result = await runStudioTool(tool, res.locals.body as StudioToolArgs);
    res.json(RunStudioToolResponse.parse(result));
  },
);

// The staff working-hours schedule — the positive availability grid booking is
// computed from, which the atelier used to edit in a Google Sheet. Same
// `requireStaff` gate as everything else here: these four operations are the
// only way the schedule is written, so the gate is also what replaced sharing a
// spreadsheet with a service account.
//
// The list carries the bookable staff names alongside the entries so the editor
// offers exactly the people the appointment catalog routes to, rather than a
// free-text field that has to match one of them exactly.
router.get(
  "/studio/availability",
  accountRateLimiter,
  requireStaff,
  async (_req, res) => {
    const schedule = await getStaffAvailability();
    res.json(ListStaffAvailabilityResponse.parse(schedule));
  },
);

router.post(
  "/studio/availability",
  accountRateLimiter,
  requireStaff,
  validate({ body: CreateStaffAvailabilityBody }),
  async (_req, res) => {
    const entry = await addStaffAvailability(
      res.locals.body as StaffAvailabilityInput,
    );
    res.status(201).json(CreateStaffAvailabilityResponse.parse(entry));
  },
);

// An update replaces the whole entry rather than patching fields, so it and the
// create above validate identically — there is no way to edit a row into a shape
// the create path would have refused.
router.put(
  "/studio/availability/:entryId",
  accountRateLimiter,
  requireStaff,
  validate({
    params: UpdateStaffAvailabilityParams,
    body: UpdateStaffAvailabilityBody,
  }),
  async (_req, res) => {
    const { entryId } = res.locals.params as { entryId: string };
    const entry = await editStaffAvailability(
      entryId,
      res.locals.body as StaffAvailabilityInput,
    );
    res.json(UpdateStaffAvailabilityResponse.parse(entry));
  },
);

router.delete(
  "/studio/availability/:entryId",
  accountRateLimiter,
  requireStaff,
  validate({ params: DeleteStaffAvailabilityParams }),
  async (_req, res) => {
    const { entryId } = res.locals.params as { entryId: string };
    await removeStaffAvailability(entryId);
    res.json(
      DeleteStaffAvailabilityResponse.parse({
        message: "Those hours have been removed from the schedule.",
      }),
    );
  },
);

// The materials restock alerts. The reorder points and the stock formulas have
// been in Notion since before the app existed and were only ever visible to
// someone who went looking in that database; this puts them next to the rest of
// the studio work. Read-only — the app never writes materials stock.
router.get(
  "/studio/materials",
  accountRateLimiter,
  requireStaff,
  async (_req, res) => {
    const overview = await getMaterialsOverview();
    res.json(GetStudioMaterialsResponse.parse(overview));
  },
);

// The review moderation queue — the read half of a loop the app has only ever
// written to. A review is captured at delivery with `Status = New` and had to
// be promoted by hand in Notion for the site's testimonials to pick it up;
// these two operations are that decision, made behind the same staff gate as
// everything else here.
router.get(
  "/studio/reviews",
  accountRateLimiter,
  requireStaff,
  async (_req, res) => {
    const queue = await getReviewQueue();
    res.json(ListStudioReviewsResponse.parse(queue));
  },
);

// One decision. A PUT rather than a POST because the whole state is sent and
// re-sending it changes nothing — pressing Publish twice is one published
// review, and the same call is how a decision made in error is undone (send
// `pending` and the review is back in the queue).
router.put(
  "/studio/reviews/:reviewId/status",
  accountRateLimiter,
  requireStaff,
  validate({
    params: SetStudioReviewStatusParams,
    body: SetStudioReviewStatusBody,
  }),
  async (_req, res) => {
    const { reviewId } = res.locals.params as { reviewId: string };
    const { status } = res.locals.body as { status: ReviewModeration };
    const review = await setReviewModeration(reviewId, status);
    res.json(SetStudioReviewStatusResponse.parse(review));
  },
);

// The atelier-editable settings, and the write that changes one.
//
// The settings themselves have been live-editable in Notion for a while; what
// was missing is that a free-text key/value table can't tell you anything. A
// mistyped key is a row nothing reads, a mistyped value is parsed and quietly
// replaced by the built-in default, and Notion shows both as though they were in
// force. So the read below reports where each effective value actually came
// from, and the write validates against the setting before storing it — which is
// the whole difference between this and typing into the table.
router.get(
  "/studio/settings",
  accountRateLimiter,
  requireStaff,
  async (_req, res) => {
    const overview = await getStudioSettings();
    res.json(GetStudioSettingsResponse.parse(overview));
  },
);

// A PUT because the whole value is sent and re-sending it changes nothing, and
// because clearing a setting is the same operation with an empty value — there
// is deliberately no delete: the row documents the key, and a blank value is
// what "unset" means everywhere else in this system.
router.put(
  "/studio/settings/:key",
  accountRateLimiter,
  requireStaff,
  validate({ params: SetStudioSettingParams, body: SetStudioSettingBody }),
  async (_req, res) => {
    const { key } = res.locals.params as { key: string };
    const { value } = res.locals.body as { value: string };
    const setting = await saveStudioSetting(key, value);
    res.json(SetStudioSettingResponse.parse(setting));
  },
);

export default router;
