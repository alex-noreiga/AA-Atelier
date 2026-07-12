import { defineConfig } from "vitest/config";

// The server source uses explicit `.js` extensions on relative imports (needed
// so Node's ESM resolver can load the compiled output). Vite/Vitest resolve
// against the on-disk `.ts` sources, so map those `.js` specifiers back to
// `.ts` at resolve time. This keeps the source honest to Node while letting the
// tests run straight off TypeScript with no build step.
const resolveJsToTs = {
  name: "resolve-js-to-ts",
  enforce: "pre" as const,
  async resolveId(source: string, importer: string | undefined, options: any) {
    if (importer && source.startsWith(".") && source.endsWith(".js")) {
      const tsSource = `${source.slice(0, -3)}.ts`;
      const resolved = await (this as any).resolve(tsSource, importer, {
        ...options,
        skipSelf: true,
      });
      if (resolved) return resolved;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [resolveJsToTs],
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/support/setup.ts"],
  },
});
