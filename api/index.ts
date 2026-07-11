// On Vercel, environment variables (NOTION_API_KEY, NOTION_ORDERS_DATABASE_ID)
// are injected into process.env by the platform, so there is nothing for dotenv
// to load here — `.env` is gitignored and never deployed. Importing
// "dotenv/config" only added a runtime dependency that isn't installed for this
// serverless function (dotenv lives in @workspace/api-server, not the root
// package that @vercel/node resolves against), which crashed every /api/* route
// with FUNCTION_INVOCATION_FAILED. Local dev loads .env via the api-server dev
// script, not this file.
//
// The Express app is pre-bundled to plain JS by `@workspace/api-server`'s
// esbuild build (run in `build:vercel`). Importing the built artifact keeps
// @vercel/node from type-checking/resolving the workspace TypeScript source
// graph, which it compiles under nodenext with an incompatible type setup.
// @ts-ignore -- built artifact, no type declarations
import app from "../artifacts/api-server/dist/app.mjs";

export default app;
