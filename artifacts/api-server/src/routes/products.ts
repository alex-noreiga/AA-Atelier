import { Router } from "express";
import { GetProductsResponse } from "@workspace/api-zod";
import { getProducts } from "../services/products.service.js";

const router = Router();

router.get("/products", async (_req, res) => {
  const products = await getProducts();
  res.json(GetProductsResponse.parse({ products }));
});

export default router;
