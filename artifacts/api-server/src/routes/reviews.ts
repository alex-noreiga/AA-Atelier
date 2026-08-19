import { Router } from "express";
import type { z } from "zod";
import {
  GetPublishedReviewsQueryParams,
  GetPublishedReviewsResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { getPublishedReviews } from "../services/review.service.js";

const router = Router();

router.get(
  "/reviews",
  validate({ query: GetPublishedReviewsQueryParams }),
  async (_req, res) => {
    const { limit } = res.locals.query as z.infer<
      typeof GetPublishedReviewsQueryParams
    >;
    const reviews = await getPublishedReviews(limit);
    // Same edge-cache reasoning as /products: testimonials change when the
    // atelier curates one, which is far rarer than a page view, so let Vercel's
    // shared CDN absorb the traffic instead of every cold serverless instance
    // re-reading Notion. Set only after the read resolves, so a thrown error's
    // response is never cached.
    res.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=900",
    );
    res.json(GetPublishedReviewsResponse.parse({ reviews }));
  },
);

export default router;
