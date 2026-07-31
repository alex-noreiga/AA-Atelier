import { Router } from "express";
import { GetFabricsResponse } from "@workspace/api-zod";
import { getFabrics } from "../services/fabrics.service.js";

const router = Router();

router.get("/fabrics", async (_req, res) => {
  const { fabrics } = await getFabrics();
  // Let Vercel's edge CDN serve the swatch list: unlike the per-instance
  // in-memory cache (which cold serverless starts lose), the edge is shared
  // across all instances and users, so Notion is hit at most ~once/s-maxage
  // globally. Set only after getFabrics() resolves so a thrown error's response
  // is never cached. Total lifetime (s-maxage + SWR ≈ 12 min) stays well under
  // Notion's ~1h signed swatch-URL expiry so images can't go stale.
  res.set("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  res.json(GetFabricsResponse.parse({ fabrics }));
});

export default router;
