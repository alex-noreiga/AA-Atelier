import { Router } from "express";
import {
  ListReviewsResponse,
  CreateReviewBody,
  CreateReviewResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { listReviews, submitReview } from "../services/reviews.service.js";
import type { CreateReviewInput } from "../lib/notion/reviews.blocks.js";

const router = Router();

router.get("/reviews", async (_req, res) => {
  const { reviews } = await listReviews();
  // Same edge-cache strategy as /products: let Vercel's CDN serve the list so
  // Notion is hit at most ~once/s-maxage globally. Set only after the service
  // resolves so a thrown error's response is never cached.
  res.set("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  res.json(ListReviewsResponse.parse({ reviews }));
});

router.post(
  "/reviews",
  validate({ body: CreateReviewBody }),
  async (_req, res) => {
    const body = res.locals.body as CreateReviewInput;
    const result = await submitReview(body);
    res.status(201).json(CreateReviewResponse.parse(result));
  },
);

export default router;
