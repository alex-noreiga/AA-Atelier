import { Router } from "express";
import { GetProductsResponse } from "@workspace/api-zod";
import { getProducts } from "../services/products.service.js";

const router = Router();

router.get("/products", async (_req, res) => {
  const { products, categories } = await getProducts();
  res.json(GetProductsResponse.parse({ products, categories }));
});

export default router;
