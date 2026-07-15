import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { stripeWebhookHandler } from "./routes/stripe-webhook.js";
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

// Central error handler — must be registered after the routes.
app.use(errorHandler);

export default app;
