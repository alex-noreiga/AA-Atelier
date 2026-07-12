import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Component/unit tests for the SPA. jsdom + Testing Library, with the same `@`
// alias the app uses so tests import components exactly as the source does.
// Tests live in `test/` (outside `src/`) so they stay out of the build
// typecheck graph.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
  },
});
