import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { stripeWebhookHandler } from "./routes/stripe-webhook.js";
import {
  generateMilestonesHandler,
  generateMilestonesButtonHandler,
} from "./routes/cron.js";
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

// Central error handler — must be registered after the routes.
app.use(errorHandler);

export default app;
