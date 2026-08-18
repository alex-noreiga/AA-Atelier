import { Router, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router = Router();

// `BUILD_TIME` is injected by esbuild's `define` at build (an ISO timestamp);
// it resolves to `undefined` when running unbundled (tests/dev). The commit is
// read live from Vercel's runtime env. Both are optional in the contract, so
// omitting them when unknown keeps the response valid.
declare const BUILD_TIME: string | undefined;
const buildTime = typeof BUILD_TIME === "string" ? BUILD_TIME : undefined;

router.get("/health", (_req: Request, res: Response) => {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12);
  const data = HealthCheckResponse.parse({
    status: "ok",
    ...(commit ? { commit } : {}),
    ...(buildTime ? { buildTime } : {}),
  });
  res.json(data);
});

export default router;
