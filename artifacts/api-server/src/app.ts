import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { stripeWebhookHandler } from "./routes/stripe-webhook.js";
import { generateMilestonesHandler } from "./routes/cron.js";
import { uploadOrderRefsHandler } from "./routes/uploads.js";
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

// Vercel Cron reconciliation endpoint. Like the Stripe webhook it's deliberately
// outside the OpenAPI contract / generated client, so it's mounted here rather
// than on the /api router. Auth is a CRON_SECRET bearer token (see routes/cron.ts).
app.get("/api/cron/generate-milestones", generateMilestonesHandler);

// Vercel Blob client-upload token endpoint for the order form's reference
// images/videos. Also outside the OpenAPI contract — it speaks Vercel Blob's
// client-upload protocol, not the browser API (see routes/uploads.ts).
app.post("/api/uploads/order-refs", uploadOrderRefsHandler);

// Central error handler — must be registered after the routes.
app.use(errorHandler);

export default app;
