import { Router } from "express";
import { GetServicesResponse } from "@workspace/api-zod";
import { getServiceOptions } from "../lib/service-catalog.js";

const router = Router();

router.get("/services", (_req, res) => {
  // A code catalog with no Notion or env read behind it, so this is a constant
  // in memory. It is served rather than duplicated in the frontend so the form
  // and the `POST /orders` gate work off one definition — the same reason
  // `/appointments/options` surfaces each booking type's gates. The edge cache
  // is long for that reason: the value changes only on deploy.
  res.set(
    "Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=86400",
  );
  res.json(GetServicesResponse.parse(getServiceOptions()));
});

export default router;
