import { Router } from "express";
import { GetCapacityResponse } from "@workspace/api-zod";
import { getCapacityStatus } from "../services/capacity.service.js";

const router = Router();

router.get("/capacity", async (_req, res) => {
  const status = await getCapacityStatus();
  // A short edge cache, set only after the read resolves so a failure is never
  // cached. Deliberately shorter than the settings and count caches behind it:
  // reopening the books is the one moment the atelier will refresh the page to
  // check, and a stale "closed" then reads as the switch not working.
  res.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.json(GetCapacityResponse.parse(status));
});

export default router;
