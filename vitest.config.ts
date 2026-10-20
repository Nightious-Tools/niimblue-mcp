import { defineConfig } from "vitest/config";
import { alias, buildPage } from "./build.mjs";

// tests run the real page bundle, as dist does
export default defineConfig(async () => ({
  define: { __PAGE_JS__: JSON.stringify(await buildPage()) },
  resolve: { alias },
  test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 30000 },
}));
