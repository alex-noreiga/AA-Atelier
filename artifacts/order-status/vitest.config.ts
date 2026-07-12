import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Component/unit tests for the SPA. jsdom + Testing Library, with the same `@`
// alias the app uses so tests import components exactly as the source does.
// Tests live in `test/` (outside `src/`) so they stay out of the *build*
// typecheck graph; `tsconfig.test.json` type-checks them separately.
// `test/support/` holds the setup file and package-local helpers, matching the
// api-server suite; shared domain fixtures come from `@workspace/test-fixtures`.
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
    setupFiles: ["./test/support/setup.ts"],
    // Equivalent to a `beforeEach(() => vi.clearAllMocks())` in every file.
    // Clears calls/results but keeps implementations and return values, which
    // is what the suites relied on when they each did this by hand.
    clearMocks: true,
  },
});
