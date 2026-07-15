import { Router } from "express";
import { GetProductsResponse } from "@workspace/api-zod";
import { getProducts } from "../services/products.service.js";

const router = Router();

router.get("/products", async (_req, res) => {
  const { products, categories } = await getProducts();
  // Let Vercel's edge CDN serve the shop list: unlike the per-instance
  // in-memory cache (which cold serverless starts lose), the edge is shared
  // across all instances and users, so Notion is hit at most ~once/s-maxage
  // globally. Set only after getProducts() resolves so a thrown error's
  // response is never cached. Total lifetime (s-maxage + SWR ≈ 12 min) stays
  // well under Notion's ~1h signed photo-URL expiry so images can't go stale.
  res.set("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  res.json(GetProductsResponse.parse({ products, categories }));
});

export default router;
