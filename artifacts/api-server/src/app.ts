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
import { uploadReferenceImageHandler } from "./routes/order-images.js";
import { errorHandler } from "./middlewares/error.js";
import { logger } from "./lib/logger.js";

const app = express();

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Milestone reconciliation, two triggers for the same job (both outside the
// OpenAPI contract / generated client, mounted directly like the Stripe webhook):
//   - Vercel Cron, on a schedule (Bearer CRON_SECRET, JSON response).
//   - a Notion "Open link" button, on demand (?secret= query token, HTML page).
// See routes/cron.ts.
app.get("/api/cron/generate-milestones", generateMilestonesHandler);
app.get("/api/cron/generate-milestones/run", generateMilestonesButtonHandler);

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
