import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { stripeWebhookHandler } from "./routes/stripe-webhook.js";
import {
  generateMilestonesHandler,
  generateMilestonesButtonHandler,
} from "./routes/cron.js";
import {
  generateLineItemsHandler,
  generateLineItemsButtonHandler,
} from "./routes/invoice-generator.js";
import {
  processCancellationHandler,
  processCancellationButtonHandler,
} from "./routes/order-cancellation.js";
import { uploadReferenceImageHandler } from "./routes/order-images.js";
import {
  notionStageChangeHandler,
  notionStageChangeButtonHandler,
} from "./routes/order-notification.js";
import { errorHandler } from "./middlewares/error.js";
import { primeSettings } from "./lib/settings/store.js";
import { logger } from "./lib/logger.js";

const app = express();

// Behind Vercel's proxy, the socket peer is always the platform's internal IP,
// so `req.ip` (and the account rate limiter that keys on it) would collapse to a
// single value for every visitor — turning a per-IP brake into a global one.
// Trust one proxy hop so `req.ip` is derived from X-Forwarded-For (the client IP
// Vercel records). A numeric hop count is deliberate: `true` would trust a
// client-spoofed X-Forwarded-For (and express-rate-limit rejects it as
// permissive). Adjust the count if the deployment ever sits behind more hops.
app.set("trust proxy", 1);

app.use(
  (pinoHttp as any)({
    logger,
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

// Refresh the live "Studio Settings" snapshot (Notion, 60s-cached) at the start
// of every request, so the sync config getters — rush rate, measurement-lock
// stage, appointment policy, atelier inboxes — can read the atelier's live values
// with an env-var fallback. Body-agnostic, so it sits ahead of the raw-body
// webhook routes safely. Best-effort: a settings hiccup never blocks a request
// (the getters just fall back to env/defaults). See lib/settings/store.ts.
app.use(async (_req, _res, next) => {
  try {
    await primeSettings();
  } catch (err) {
    logger.warn(
      { err },
      "Failed to refresh studio settings; using env/default fallback",
    );
  }
  next();
});

// Stripe verifies the webhook signature against the exact raw bytes, so this
// route must read the body as a Buffer BEFORE the global JSON parser consumes
// it. It's mounted directly (not on the /api router) and outside the zod-
// validate flow — see routes/stripe-webhook.ts.
app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);

// Order reference-image upload. Like the Stripe webhook, this reads a raw body
// (the image bytes) and so is mounted BEFORE the JSON parser and directly on the
// app (not the /api router) — it's a binary endpoint outside the OpenAPI
// contract. `type: () => true` buffers whatever content type the browser sends;
// the handler validates it's an accepted image and enforces the size cap.
app.post(
  "/api/orders/reference-images",
  express.raw({ type: () => true, limit: "4.5mb" }),
  uploadReferenceImageHandler,
);

// Order status-change webhook (Notion automation, POST). Buffered as a raw body
// BEFORE the JSON parser so it's read regardless of the Content-Type Notion
// sends — its "Send webhook" action sets the Content-Type itself and won't let
// you override it, so we can't rely on it being application/json. The handler
// JSON-parses the buffer itself. Outside the OpenAPI contract, like the Stripe
// webhook. The on-demand …/run link (GET, below) carries no body and stays after
// the JSON parser. See routes/order-notification.ts.
app.post(
  "/api/webhooks/notion-stage-change",
  express.raw({ type: () => true }),
  notionStageChangeHandler,
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Order cancellation + Stripe refund, on demand from Notion (outside the OpenAPI
// contract, mounted directly like the invoice-generator button). Takes ?order=
// (custom ORD-… or shop SHP-…) and reuses CRON_SECRET as its token. The atelier
// reviews the customer's cancellation request, then clicks this to refund the
// order's paid payments and mark it cancelled. Registered BEFORE the /api router
// so `/api/orders/process-cancellation` isn't captured by its `/orders/:orderNumber`
// status-lookup route. See routes/order-cancellation.ts.
app.get("/api/orders/process-cancellation", processCancellationHandler);
app.get(
  "/api/orders/process-cancellation/run",
  processCancellationButtonHandler,
);

app.use("/api", router);

// Milestone reconciliation, two triggers for the same job (both outside the
// OpenAPI contract / generated client, mounted directly like the Stripe webhook):
//   - Vercel Cron, on a schedule (Bearer CRON_SECRET, JSON response).
//   - a Notion "Open link" button, on demand (?secret= query token, HTML page).
// See routes/cron.ts.
app.get("/api/cron/generate-milestones", generateMilestonesHandler);
app.get("/api/cron/generate-milestones/run", generateMilestonesButtonHandler);

// Order status-change on-demand link (the POST automation webhook is mounted
// above, before the JSON parser). A link the atelier opens to send/test one
// order (GET, HTML). See routes/order-notification.ts.
app.get(
  "/api/webhooks/notion-stage-change/run",
  notionStageChangeButtonHandler,
);

// Invoice line-item generation, on demand from Notion (outside the OpenAPI
// contract, mounted directly like the milestone button). Takes ?order= and
// reuses CRON_SECRET as its token. See routes/invoice-generator.ts.
app.get("/api/invoices/generate-line-items", generateLineItemsHandler);
app.get(
  "/api/invoices/generate-line-items/run",
  generateLineItemsButtonHandler,
);

// Central error handler — must be registered after the routes.
app.use(errorHandler);

export default app;
