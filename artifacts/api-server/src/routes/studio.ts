import { Router } from "express";
import {
  CreateStaffAvailabilityBody,
  CreateStaffAvailabilityResponse,
  DeleteStaffAvailabilityParams,
  DeleteStaffAvailabilityResponse,
  GetStudioAccessResponse,
  GetStudioAnalyticsResponse,
  GetStudioGuideContentParams,
  GetStudioGuideContentResponse,
  GetStudioGuidesResponse,
  GetStudioMaterialsResponse,
  GetStudioSettingsResponse,
  ListStaffAvailabilityResponse,
  ListNewsletterSignupsResponse,
  ListStudioRequestsResponse,
  ListStudioReviewsResponse,
  RunStudioToolBody,
  RunStudioToolParams,
  RunStudioToolResponse,
  SetStudioRequestStateBody,
  SetStudioRequestStateParams,
  SetStudioRequestStateResponse,
  SetStudioReviewStatusBody,
  SetStudioReviewStatusParams,
  SetStudioReviewStatusResponse,
  SetStudioSettingBody,
  SetStudioSettingParams,
  SetStudioSettingResponse,
  SubscribeNewsletterSignupParams,
  SubscribeNewsletterSignupResponse,
  UpdateStaffAvailabilityBody,
  UpdateStaffAvailabilityParams,
  UpdateStaffAvailabilityResponse,
} from "@workspace/api-zod";
import { requireStaff } from "../middlewares/auth.js";
import { studioRateLimiter } from "../middlewares/rate-limit.js";
import { validate } from "../middlewares/validate.js";
import { getStudioAnalytics } from "../services/studio-analytics.service.js";
import { getMaterialsOverview } from "../services/materials.service.js";
import {
  getStudioGuides,
  getStudioGuideContent,
} from "../services/studio-guides.service.js";
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
  getRequestQueue,
  setRequestQueueState,
} from "../services/studio-requests.service.js";
import type { RequestState } from "../lib/notion/requests.schema.js";
import {
  getNewsletterPanel,
  subscribeNewsletterSignup,
} from "../services/studio-newsletter.service.js";
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
router.get("/studio/access", studioRateLimiter, requireStaff, (_req, res) => {
  res.json(GetStudioAccessResponse.parse({ staff: true }));
});

// The internal studio dashboard's figures. `requireStaff` verifies the same
// Supabase access token the customer portal uses and additionally requires the
// signed-in email to be on the studio allowlist — 401 when not signed in, 403
// when signed in as a customer. Every route here carries `studioRateLimiter`
// rather than the account one: past `requireStaff` the caller is an allowlisted
// staff member, so the ceiling has to fit a few people USING the dashboard
// (six reads a load, one write per queue decision) rather than deter a stranger.
router.get(
  "/studio/analytics",
  studioRateLimiter,
  requireStaff,
  async (_req, res) => {
    const analytics = await getStudioAnalytics();
    res.json(GetStudioAnalyticsResponse.parse(analytics));
  },
);

// The internal tools — the atelier actions that used to be links carrying
// `CRON_SECRET` in their query string (milestone reconciliation, invoice
// itemization, a status-change email, the two refunds), plus the two that never
// had a link to retire: the back-in-stock sweep and the flat service quote. Same
// `requireStaff` gate as the figures above: for the retired links the work is
// unchanged and only who may trigger it moved.
//
// Unlike those links this is contract-first, because it's an ordinary SPA JSON
// call from the dashboard rather than a browser tab the atelier opens by hand —
// so the tool name and its arguments are validated by the generated schemas
// before the service sees them, and an unknown tool is a 400 rather than a
// route that quietly doesn't exist.
router.post(
  "/studio/tools/:tool",
  studioRateLimiter,
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
  studioRateLimiter,
  requireStaff,
  async (_req, res) => {
    const schedule = await getStaffAvailability();
    res.json(ListStaffAvailabilityResponse.parse(schedule));
  },
);

router.post(
  "/studio/availability",
  studioRateLimiter,
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
  studioRateLimiter,
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
  studioRateLimiter,
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
  studioRateLimiter,
  requireStaff,
  async (_req, res) => {
    const overview = await getMaterialsOverview();
    res.json(GetStudioMaterialsResponse.parse(overview));
  },
);

// The atelier's how-to guides, rendered beside the tool each one describes.
// Read-only, and the app stores none of the content: a guide is an HTML file
// attached to a Notion row, so revising a procedure is replacing a file rather
// than a deploy — which is the whole reason this is a read at all.
//
// This lists what the guides are and where they go, WITHOUT their content. The
// markup comes one guide at a time from the operation below, because inlining
// every guide here would put the studio's whole manual in one response — past
// the serverless payload limit at a handful of screenshot-heavy guides, and
// downloaded in full by every dashboard load whether or not anyone reads one.
router.get(
  "/studio/guides",
  studioRateLimiter,
  requireStaff,
  async (_req, res) => {
    const guides = await getStudioGuides();
    res.json(GetStudioGuidesResponse.parse(guides));
  },
);

// One guide's markup, downloaded when it is opened.
//
// Served exactly as the atelier wrote it, and deliberately not sanitized. It is
// never executed here and never executed in the browser either: the dashboard
// renders it in a sandboxed frame granting neither scripts nor same-origin
// access, because this origin holds a signed-in staff session and the file is
// not code anybody reviewed.
router.get(
  "/studio/guides/:guideId",
  studioRateLimiter,
  requireStaff,
  validate({ params: GetStudioGuideContentParams }),
  async (_req, res) => {
    const { guideId } = res.locals.params as { guideId: string };
    const content = await getStudioGuideContent(guideId);
    res.json(GetStudioGuideContentResponse.parse(content));
  },
);

// The review moderation queue — the read half of a loop the app has only ever
// written to. A review is captured at delivery with `Status = New` and had to
// be promoted by hand in Notion for the site's testimonials to pick it up;
// these two operations are that decision, made behind the same staff gate as
// everything else here.
router.get(
  "/studio/reviews",
  studioRateLimiter,
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
  studioRateLimiter,
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

// The customer-request queue — the other half of a loop the app has only ever
// written to. Six kinds of request land in the shared contact inbox, and until
// now actioning one meant reading it in Notion and re-typing its order number
// into the tools above. Each row served here carries the tool that actions it
// and the argument that tool needs.
router.get(
  "/studio/requests",
  studioRateLimiter,
  requireStaff,
  async (_req, res) => {
    const queue = await getRequestQueue();
    res.json(ListStudioRequestsResponse.parse(queue));
  },
);

// Move one request through the inbox. A PUT for the same reason the review
// decision is one: the whole state is sent, and re-sending it changes nothing —
// closing a request twice is one closed request, and `new` is how a row closed
// in error is put back.
router.put(
  "/studio/requests/:requestId/state",
  studioRateLimiter,
  requireStaff,
  validate({
    params: SetStudioRequestStateParams,
    body: SetStudioRequestStateBody,
  }),
  async (_req, res) => {
    const { requestId } = res.locals.params as { requestId: string };
    const { state } = res.locals.body as { state: RequestState };
    const updated = await setRequestQueueState(requestId, state);
    res.json(SetStudioRequestStateResponse.parse(updated));
  },
);

// The newsletter opt-ins, which are kept out of the queue above on purpose: an
// opt-in is a consent record nobody answers, and the job it needs is getting
// the address onto the mailing list. Whether that happened is read live from
// Resend rather than stored — the capture-time sync is best-effort and
// self-gates off when no audience is configured, so a marker on the Notion row
// would be silent about the one case worth catching.
router.get(
  "/studio/newsletter",
  studioRateLimiter,
  requireStaff,
  async (_req, res) => {
    const panel = await getNewsletterPanel();
    res.json(ListNewsletterSignupsResponse.parse(panel));
  },
);

// Add one opt-in to the audience and file its row away. A POST rather than a
// PUT because it is not idempotent in the way the state writes are: it performs
// an action against another vendor, and "add this person to the list" reads as
// a thing done rather than a state set — even though the upsert underneath
// makes a repeat press harmless. Dismissing an opt-in without subscribing is
// the ordinary request-state operation above; there is no second way to do it.
router.post(
  "/studio/newsletter/:signupId/subscribe",
  studioRateLimiter,
  requireStaff,
  validate({ params: SubscribeNewsletterSignupParams }),
  async (_req, res) => {
    const { signupId } = res.locals.params as { signupId: string };
    const signup = await subscribeNewsletterSignup(signupId);
    res.json(SubscribeNewsletterSignupResponse.parse(signup));
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
  studioRateLimiter,
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
  studioRateLimiter,
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
