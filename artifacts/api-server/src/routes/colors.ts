import { Router } from "express";
import { GetColorsResponse } from "@workspace/api-zod";
import { intakeColorPalette } from "../services/colors.js";

const router = Router();

router.get("/colors", (_req, res) => {
  // The palette is read from the primed Studio Settings snapshot (or the built-in
  // default), so this is a cheap in-memory read. A short edge cache still keeps
  // Vercel from invoking the function on every intake-form load; the total
  // lifetime stays under the 60s settings cache so an atelier edit shows quickly.
  res.set("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  res.json(GetColorsResponse.parse({ colors: intakeColorPalette() }));
});

export default router;
