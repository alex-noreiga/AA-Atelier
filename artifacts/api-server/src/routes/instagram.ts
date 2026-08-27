import { Router } from "express";
import { GetInstagramFeedResponse } from "@workspace/api-zod";
import { getInstagramFeed } from "../services/instagram.service.js";
import { setEdgeCache } from "../lib/edge-cache.js";

const router = Router();

router.get("/instagram", async (_req, res) => {
  const feed = await getInstagramFeed();
  // Longer than the portfolio's, and for the opposite reason. There the ceiling
  // is how long Notion's signed image URLs live; here the FLOOR is Instagram's
  // published quota (200 calls per hour per user), which the strip sitting on
  // the two busiest pages could plausibly approach. Ten minutes at the edge
  // plus the repository's own five-minute cache keeps the origin comfortably
  // clear of it, and posts appear a few times a week — nobody is waiting on a
  // fresher answer. Set only after the read resolves, so an error is never
  // cached.
  setEdgeCache(res, "public, s-maxage=600, stale-while-revalidate=1800");
  res.json(GetInstagramFeedResponse.parse(feed));
});

export default router;
