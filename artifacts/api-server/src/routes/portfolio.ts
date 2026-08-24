import { Router } from "express";
import { GetPortfolioResponse } from "@workspace/api-zod";
import { getPortfolio } from "../services/portfolio.service.js";

const router = Router();

router.get("/portfolio", async (_req, res) => {
  const portfolio = await getPortfolio();
  // Same edge-cache reasoning as /products, and the same hard ceiling on the
  // number: the image URLs in this payload are Notion-signed and expire in
  // about an hour, so the total cached lifetime (s-maxage + SWR ≈ 12 min) has
  // to stay well under that or the gallery starts serving dead images. Set only
  // after the read resolves, so a thrown error's response is never cached.
  res.set("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  res.json(GetPortfolioResponse.parse(portfolio));
});

export default router;
