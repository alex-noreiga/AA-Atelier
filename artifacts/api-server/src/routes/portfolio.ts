import { Router } from "express";
import { GetPortfolioResponse } from "@workspace/api-zod";
import { getPortfolio } from "../services/portfolio.service.js";

const router = Router();

router.get("/portfolio", async (_req, res) => {
  const { items, categories } = await getPortfolio();
  // Same edge-caching rationale as /products: a short shared CDN window keeps
  // Notion hits down while staying well under Notion's ~1h signed photo-URL
  // expiry so gallery images can't go stale. Set only after the promise
  // resolves so a thrown error's response is never cached.
  res.set("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  res.json(GetPortfolioResponse.parse({ items, categories }));
});

export default router;
