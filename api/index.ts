// The Express app is pre-bundled to plain JS by `@workspace/api-server`'s
// esbuild build (run in `build:vercel`). Importing the built artifact keeps
// @vercel/node from type-checking/resolving the workspace TypeScript source
// graph, which it compiles under nodenext with an incompatible type setup.
// @ts-ignore -- built artifact, no type declarations
import app from "../artifacts/api-server/dist/app.mjs";

export default app;
